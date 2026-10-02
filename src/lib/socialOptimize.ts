/**
 * The daily social optimization loop, the rules (Chris 10-02: the
 * optimizing must be a job in the product, "should be daily"). Pure: no DB,
 * no fetch — tested in scripts/test-social-optimize.mjs. The job that feeds
 * it and acts on it is lib/server/socialOptimize.ts.
 *
 * What it can decide is small on purpose. Four kinds exist (set, movers,
 * games, dips), three post each day, and 1pm is always the movers video. So
 * one kind sits on the bench, and the only move is: the benched kind takes
 * the 7am or 7pm slot from the kind posting there.
 *
 * Scoring (optimize):
 * - Posts 2 to 28 days old only: views keep growing for two days, and a
 *   month-old result says little about now.
 * - Each post is scored against its own site's average (1.0 = an average
 *   post there), so TikTok's view counts cannot swamp the rest. A site that
 *   reports views is scored on views, one that does not (Bluesky, Facebook)
 *   on likes + comments + shares.
 * - One runaway post cannot carry a kind: a post counts for at most
 *   SCORE_CAP times its site's average.
 * - A kind needs MIN_POSTS posts over MIN_DAYS days or there is no opinion.
 * - The bench must beat the sitting kind by MARGIN.
 *
 * A finding is only a LEAD (measured on prod 10-02): a kind and its time of
 * day are tangled. Set has only ever posted at 7am, dips at 7pm, so "dips
 * beat set" may only mean "7pm beats 7am". So a finding starts a TRIAL
 * (step, judgeTrial; Chris approved the plan 10-02, and a trial may take
 * 7pm as well as 7am: "you pick the slot"):
 * - The benched kind takes the slot for TRIAL_DAYS, starting two days out
 *   (tomorrow's TikTok videos render tonight).
 * - Then it is judged against the old kind IN THAT SAME SLOT. It stays only
 *   if it did at least as well; otherwise the old kind goes back, and that
 *   kind-in-that-slot is not tried again for RETRY_DAYS.
 * - One trial at a time, and nothing new for COOLDOWN_DAYS after a verdict.
 * - With no finding for EXPLORE_DAYS the benched kind gets a trial anyway,
 *   in the slot whose kind scores lowest: a benched kind earns no numbers,
 *   so without this the loop would have nothing to compare.
 */
import { easternOf } from "./socialPosts.ts";

export type ScoredKind = "set" | "movers" | "games" | "dips";
export type OpenSlot = "morning" | "evening";
export const SCORED_KINDS: ScoredKind[] = ["set", "movers", "games", "dips"];
export const OPEN_SLOTS: OpenSlot[] = ["morning", "evening"];
export const KIND_NAME: Record<ScoredKind, string> = { set: "set spotlight", movers: "weekly gains", games: "all-games jumps", dips: "price drops" };
export const SLOT_NAME: Record<OpenSlot, string> = { morning: "7am", evening: "7pm" };

export const MIN_AGE_DAYS = 2;
export const MAX_AGE_DAYS = 28;
export const MIN_POSTS = 10;
export const MIN_DAYS = 5;
export const MARGIN = 1.2;
export const SCORE_CAP = 4;
export const COOLDOWN_DAYS = 7;
export const TRIAL_DAYS = 7;
/** A trial that cannot gather TRIAL_DAYS of posts by this many days after its start is ended (the kind had no draft most days). */
export const TRIAL_MAX_DAYS = 16;
/** A change takes effect this many days out: tomorrow's TikTok videos render tonight. */
export const LEAD_DAYS = 2;
export const EXPLORE_DAYS = 28;
export const RETRY_DAYS = 56;

const DAY_MS = 86_400_000;

export interface ScoredPost {
  site: string;
  kind: string;
  /** The slot it went out in (social_posts.slot); only the trial verdict reads it. */
  slot?: string;
  /** ISO timestamp of the post. */
  at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

export interface KindScore {
  kind: ScoredKind;
  posts: number;
  /** Distinct Eastern days the kind posted on. */
  days: number;
  /** Average post against its site's average (1.0 = average); null = too few posts to say. */
  score: number | null;
}

export type Sitting = { morning: ScoredKind; midday: ScoredKind; evening: ScoredKind };

export interface OptimizeInput {
  posts: ScoredPost[];
  now: number;
  /** The standing schedule: the kind each slot posts. */
  sitting: Sitting;
  /** Eastern day of the last change or verdict, if any. */
  lastChangeDay?: string | null;
  /** "slot:kind" pairs not to propose (a trial of that kind in that slot failed recently). */
  skip?: string[];
}

export interface OptimizeReport {
  /** Eastern day the report was made. */
  day: string;
  /** Posts that counted (in the age window, on a site with numbers). */
  counted: number;
  scores: KindScore[];
  /** The lead the numbers point at, or null. */
  change: { slot: OpenSlot; from: ScoredKind; to: ScoredKind } | null;
  /** One plain sentence: what it found and why it does or does not change anything. */
  why: string;
}

function isScored(kind: string): kind is ScoredKind {
  return (SCORED_KINDS as string[]).includes(kind);
}
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface Normed {
  post: ScoredPost;
  kind: ScoredKind;
  /** The post against its site's average, capped. */
  norm: number;
  /** Eastern day it posted. */
  day: string;
}

/** Every countable post with its score against its own site's average. */
function normalize(posts: ScoredPost[], now: number): Normed[] {
  const bySite = new Map<string, ScoredPost[]>();
  for (const p of posts) {
    const t = Date.parse(p.at.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (!isScored(p.kind) || Number.isNaN(t)) continue;
    const age = (now - t) / DAY_MS;
    if (age < MIN_AGE_DAYS || age > MAX_AGE_DAYS) continue;
    bySite.set(p.site, [...(bySite.get(p.site) ?? []), p]);
  }
  const out: Normed[] = [];
  for (const sitePosts of bySite.values()) {
    const hasViews = sitePosts.some((p) => (p.views ?? 0) > 0);
    const metric = (p: ScoredPost) => (hasViews ? (p.views ?? 0) : (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0));
    const mean = sitePosts.reduce((n, p) => n + metric(p), 0) / sitePosts.length;
    if (!(mean > 0)) continue; // a site with no numbers at all says nothing about any kind
    for (const p of sitePosts) out.push({ post: p, kind: p.kind as ScoredKind, norm: Math.min(metric(p) / mean, SCORE_CAP), day: easternOf(p.at)?.day ?? "" });
  }
  return out;
}

function average(list: Normed[]): { posts: number; days: number; score: number | null } {
  const days = new Set(list.map((n) => n.day).filter(Boolean)).size;
  return { posts: list.length, days, score: list.length ? round2(list.reduce((s, n) => s + n.norm, 0) / list.length) : null };
}

/** Score every kind and name at most one lead. */
export function optimize(input: OptimizeInput): OptimizeReport {
  const day = easternOf(input.now)?.day ?? "";
  const normed = normalize(input.posts, input.now);
  const scores: KindScore[] = SCORED_KINDS.map((kind) => {
    const a = average(normed.filter((n) => n.kind === kind));
    return { kind, posts: a.posts, days: a.days, score: a.posts >= MIN_POSTS && a.days >= MIN_DAYS ? a.score : null };
  });
  const scoreOf = (k: ScoredKind) => scores.find((s) => s.kind === k)?.score ?? null;
  const report = (change: OptimizeReport["change"], why: string): OptimizeReport => ({ day, counted: normed.length, scores, change, why });

  if (input.lastChangeDay && day) {
    const since = daysBetween(input.lastChangeDay, day);
    if (since >= 0 && since < COOLDOWN_DAYS) return report(null, `No change: the schedule changed ${since === 0 ? "today" : `${plural(since, "day")} ago`}, and the new post needs ${COOLDOWN_DAYS} days of numbers first.`);
  }
  const posting = [input.sitting.morning, input.sitting.midday, input.sitting.evening];
  const bench = SCORED_KINDS.filter((k) => !posting.includes(k));
  let best: { slot: OpenSlot; from: ScoredKind; to: ScoredKind; ratio: number } | null = null;
  const unsure: ScoredKind[] = [];
  for (const to of bench) {
    const challenger = scoreOf(to);
    if (challenger == null) {
      unsure.push(to);
      continue;
    }
    for (const slot of OPEN_SLOTS) {
      if (input.skip?.includes(`${slot}:${to}`)) continue;
      const from = input.sitting[slot];
      const sitting = scoreOf(from);
      if (sitting == null) {
        if (!unsure.includes(from)) unsure.push(from);
        continue;
      }
      // A sitting kind scoring nothing loses to any bench kind that scores at all.
      const ratio = sitting > 0 ? challenger / sitting : challenger > 0 ? Infinity : 0;
      if (ratio >= MARGIN && (!best || ratio > best.ratio)) best = { slot, from, to, ratio };
    }
  }
  if (best) {
    const pct = Number.isFinite(best.ratio) ? `${Math.round((best.ratio - 1) * 100)}% better than` : "where there was nothing for";
    return report(
      { slot: best.slot, from: best.from, to: best.to },
      `The ${KIND_NAME[best.to]} posts did ${pct} the ${KIND_NAME[best.from]} posts over the last ${MAX_AGE_DAYS} days (${scoreOf(best.to)} vs ${scoreOf(best.from)}, 1.0 = an average post), so ${KIND_NAME[best.to]} is worth a trial at ${SLOT_NAME[best.slot]}. The two posted at different times of day, so this is a lead, not proof.`,
    );
  }
  if (unsure.length) {
    const lines = unsure.map((k) => {
      const s = scores.find((x) => x.kind === k)!;
      return `${KIND_NAME[k]} (${plural(s.posts, "post")} over ${plural(s.days, "day")})`;
    });
    return report(null, `No change: not enough posts yet to judge ${lines.join(" and ")}; a kind needs ${MIN_POSTS} posts over ${MIN_DAYS} days.`);
  }
  return report(null, `No change: nothing on the bench beats what is posting by ${Math.round((MARGIN - 1) * 100)}%.`);
}

/** A kind on trial in a slot. */
export interface Trial {
  slot: OpenSlot;
  /** The kind that sat there, and goes back if the trial fails. */
  from: ScoredKind;
  /** The kind on trial. */
  to: ScoredKind;
  /** First Eastern day the trial kind posts. */
  start: string;
  /** True when nothing pointed at it: the bench's turn to earn numbers. */
  explore?: boolean;
}

export interface TrialVerdict {
  verdict: "running" | "keep" | "back";
  /** Days of trial posts old enough to count. */
  days: number;
  /** Same slot, 1.0 = an average post on its site; null = nothing to go on. */
  trialScore: number | null;
  oldScore: number | null;
  why: string;
}

/** Judge a trial against the old kind in the same slot, once it has TRIAL_DAYS of counted posts. */
export function judgeTrial(posts: ScoredPost[], now: number, trial: Trial): TrialVerdict {
  const today = easternOf(now)?.day ?? "";
  const inSlot = normalize(posts, now).filter((n) => n.post.slot === trial.slot);
  const mine = average(inSlot.filter((n) => n.kind === trial.to && n.day >= trial.start));
  const old = average(inSlot.filter((n) => n.kind === trial.from && n.day < trial.start));
  const what = `${KIND_NAME[trial.to]} at ${SLOT_NAME[trial.slot]}`;
  const base = { days: mine.days, trialScore: mine.score, oldScore: old.score };
  if (mine.days < TRIAL_DAYS) {
    if (today && daysBetween(trial.start, today) >= TRIAL_MAX_DAYS) {
      return { ...base, verdict: "back", why: `Trial ended: ${what} only had a post on ${plural(mine.days, "day")} in ${TRIAL_MAX_DAYS}, so ${KIND_NAME[trial.from]} goes back.` };
    }
    const wait = today && today < trial.start ? `starts ${trial.start}` : `${mine.days} of ${TRIAL_DAYS} days counted (a post counts once it is ${MIN_AGE_DAYS} days old)`;
    return { ...base, verdict: "running", why: `No change: trial running, ${what} in place of ${KIND_NAME[trial.from]}, ${wait}.` };
  }
  if (old.score == null || old.posts < MIN_POSTS) {
    return { ...base, verdict: "keep", why: `Trial over: ${what} scored ${mine.score}, and ${KIND_NAME[trial.from]} has too few posts left in that slot to compare, so ${KIND_NAME[trial.to]} stays.` };
  }
  const numbers = `${mine.score} vs ${old.score} for ${KIND_NAME[trial.from]} in the same slot, 1.0 = an average post`;
  if ((mine.score ?? 0) >= old.score) return { ...base, verdict: "keep", why: `Trial over: ${what} did at least as well (${numbers}), so it stays.` };
  return { ...base, verdict: "back", why: `Trial over: ${what} did worse (${numbers}), so ${KIND_NAME[trial.from]} goes back.` };
}

/** What the loop remembers between days (settings, lib/server/socialOptimize.ts). */
export interface LoopState {
  /** The Off switch on /admin/social: score and report, change nothing. */
  off: boolean;
  trial: Trial | null;
  /** Eastern day of the last start or verdict. */
  lastChangeDay: string | null;
  /** Eastern day the loop first ran: the exploration clock starts here when nothing has changed yet. */
  sinceDay: string | null;
  /** "slot:kind" → the Eastern day a trial of that kind in that slot failed. */
  failed: Record<string, string>;
}

export type LoopAction =
  | { type: "none" }
  /** The trial kind takes the slot from trial.start. */
  | { type: "start"; trial: Trial }
  /** The trial kind stays; the schedule is already right. */
  | { type: "keep"; trial: Trial }
  /** The old kind takes the slot back from `from`. */
  | { type: "back"; trial: Trial; from: string };

export interface LoopStep {
  report: OptimizeReport;
  action: LoopAction;
  /** The board line for a start or a verdict; null on a day nothing happens. */
  line: string | null;
}

/**
 * One day of the loop: the scores, and at most one thing to do. `sitting` is
 * the schedule as it stands for the day a change would start (today +
 * LEAD_DAYS), with a running trial's kind in its slot.
 */
export function step(input: { posts: ScoredPost[]; now: number; sitting: Sitting; state: LoopState }): LoopStep {
  const { posts, now, sitting, state } = input;
  const today = easternOf(now)?.day ?? "";
  const skip = Object.entries(state.failed)
    .filter(([, day]) => daysBetween(day, today) < RETRY_DAYS)
    .map(([pair]) => pair);
  const report = optimize({ posts, now, sitting, lastChangeDay: state.lastChangeDay, skip });
  const none = (why: string): LoopStep => ({ report: { ...report, change: null, why }, action: { type: "none" }, line: null });
  if (state.off) return none(`Switched off: nothing changes. ${report.why}`);

  if (state.trial) {
    const v = judgeTrial(posts, now, state.trial);
    if (v.verdict === "running") return none(v.why);
    const action: LoopAction = v.verdict === "keep" ? { type: "keep", trial: state.trial } : { type: "back", trial: state.trial, from: addDays(today, LEAD_DAYS) };
    const tail = v.verdict === "back" ? ` Back from ${addDays(today, LEAD_DAYS)}.` : "";
    return { report: { ...report, change: null, why: v.why }, action, line: `Social optimizer ${today} — ${v.why}${tail}` };
  }

  const start = addDays(today, LEAD_DAYS);
  if (report.change) {
    const trial: Trial = { ...report.change, start };
    return { report, action: { type: "start", trial }, line: `Social optimizer ${today} — trial: ${KIND_NAME[trial.to]} takes ${SLOT_NAME[trial.slot]} from ${KIND_NAME[trial.from]} for a week, starting ${start}. ${report.why}` };
  }
  // The bench's turn: nothing has changed for EXPLORE_DAYS, so the benched kind earns some numbers in the weaker slot.
  const clock = state.lastChangeDay ?? state.sinceDay;
  const cooling = state.lastChangeDay != null && daysBetween(state.lastChangeDay, today) < COOLDOWN_DAYS;
  if (clock && !cooling && daysBetween(clock, today) >= EXPLORE_DAYS) {
    const bench = SCORED_KINDS.find((k) => ![sitting.morning, sitting.midday, sitting.evening].includes(k));
    const scoreOf = (k: ScoredKind) => report.scores.find((s) => s.kind === k)?.score ?? null;
    const open = OPEN_SLOTS.filter((s) => bench && !skip.includes(`${s}:${bench}`) && scoreOf(sitting[s]) != null).sort((a, b) => scoreOf(sitting[a])! - scoreOf(sitting[b])!);
    if (bench && open.length) {
      const trial: Trial = { slot: open[0], from: sitting[open[0]], to: bench, start, explore: true };
      const why = `Nothing has changed for ${EXPLORE_DAYS} days and ${KIND_NAME[bench]} has not posted, so it gets a week at ${SLOT_NAME[trial.slot]} (the weaker slot: ${KIND_NAME[trial.from]} scores ${scoreOf(trial.from)}) to earn numbers.`;
      return { report: { ...report, change: { slot: trial.slot, from: trial.from, to: trial.to }, why }, action: { type: "start", trial }, line: `Social optimizer ${today} — trial: ${KIND_NAME[trial.to]} takes ${SLOT_NAME[trial.slot]} from ${KIND_NAME[trial.from]} for a week, starting ${start}. ${why}` };
    }
  }
  return { report, action: { type: "none" }, line: null };
}
