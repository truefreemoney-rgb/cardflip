/**
 * Hashtags as a lever of the daily optimization loop (Chris 10-02: hashtags
 * "should also be part of the optimizing process"). Pure: no DB, no fetch —
 * tested in scripts/test-social-tags.mjs. The settings row and the job are
 * lib/server/socialTags.ts.
 *
 * The tag lists in lib/socialPlan.ts and lib/server/social.ts stay the
 * starting point. This module changes them one tag at a time:
 * - A TRIAL swaps one sitting tag for a challenger on EVERY OTHER DAY for
 *   TAG_TRIAL_DAYS, starting two days out (tomorrow's TikTok captions are made
 *   tonight). Alternating days puts both tags on the same kinds, slots and
 *   weekdays' worth of posts, so the two arms differ only by the tag.
 * - The verdict compares the posts that carried the challenger with the posts
 *   that carried the sitting tag, each post against its own site's average
 *   (as lib/socialOptimize.ts does). A site that cut the tag off (X shows two,
 *   Threads one) has neither and counts for neither.
 * - The challenger must win by TAG_MARGIN to stay; then the swap is standing.
 *   Otherwise the sitting tag stays and that pair waits TAG_RETRY_DAYS.
 * - One tag trial at a time, TAG_COOLDOWN_DAYS between them, challengers in
 *   TAG_CANDIDATES order.
 *
 * tagsOn() is the one place a post's tags are resolved for a day; fitText
 * (lib/server/socialPublish.ts) calls it, and every site's text and the
 * TikTok caption go through fitText.
 */
import { easternOf } from "./socialPosts.ts";

export const TAG_TRIAL_DAYS = 14;
/** Posts each arm needs before a verdict means anything. */
export const TAG_MIN_POSTS = 12;
export const TAG_MARGIN = 1.1;
export const TAG_MIN_AGE_DAYS = 2;
export const TAG_LEAD_DAYS = 2;
export const TAG_COOLDOWN_DAYS = 3;
export const TAG_RETRY_DAYS = 56;
export const TAG_SCORE_CAP = 4;

/**
 * Challengers, in the order they get a trial. `out` is a tag posts carry
 * today, `in` the tag tried in its place. Letters and digits only, a letter
 * first (Bluesky makes a facet of nothing else). The first pair is the tag
 * the most sites show (X and Facebook keep two tags, Bluesky three).
 */
export const TAG_CANDIDATES: { out: string; in: string }[] = [
  { out: "PokemonCards", in: "Pokemon" },
  { out: "CardCollector", in: "CardCollecting" },
  { out: "TradingCards", in: "Collectibles" },
  { out: "MagicTheGathering", in: "MTGCommunity" },
  { out: "TCG", in: "TCGCommunity" },
  { out: "PokemonCards", in: "PokemonCommunity" },
  { out: "CardCollector", in: "CardTok" },
];

/** From this Eastern day on, `in` posts where `out` did. */
export interface TagSwap {
  out: string;
  in: string;
  from: string;
}
/** `in` posts in place of `out` on every other day from `start`, for TAG_TRIAL_DAYS. */
export interface TagTrial {
  out: string;
  in: string;
  start: string;
}
export interface TagPlan {
  swaps: TagSwap[];
  trial: TagTrial | null;
}

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseTagPlan(raw: string | null | undefined): TagPlan {
  const empty: TagPlan = { swaps: [], trial: null };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as { swaps?: unknown; trial?: unknown } | null;
    if (!v || typeof v !== "object") return empty;
    const ok = (e: unknown, dayKey: "from" | "start"): boolean => {
      const r = e as Record<string, unknown> | null;
      return Boolean(r) && typeof r === "object" && TAG_RE.test(String(r!.out)) && TAG_RE.test(String(r!.in)) && DAY_RE.test(String(r![dayKey]));
    };
    const swaps = Array.isArray(v.swaps) ? (v.swaps.filter((e) => ok(e, "from")) as TagSwap[]).map((s) => ({ out: s.out, in: s.in, from: s.from })) : [];
    const t = v.trial as TagTrial | null;
    return { swaps, trial: ok(t, "start") ? { out: t!.out, in: t!.in, start: t!.start } : null };
  } catch {
    return empty;
  }
}

let plan: TagPlan = { swaps: [], trial: null };
/** Replace the tag plan this process reads (lib/server/socialSchedule.ts loads it with the schedule). */
export function setTagPlan(p: TagPlan): void {
  plan = { swaps: [...p.swaps].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)), trial: p.trial };
}

/** True on a trial's challenger days: the start day and every second day after it, inside the trial. */
export function challengerDay(trial: TagTrial, day: string): boolean {
  const n = daysBetween(trial.start, day);
  return n >= 0 && n < TAG_TRIAL_DAYS && n % 2 === 0;
}

/** A post's tags on a day: the standing swaps that have started, then the trial's on its challenger days. Order is kept. */
export function tagsOn(tags: string[], day: string | undefined, p: TagPlan = plan): string[] {
  if (!day || !DAY_RE.test(day) || (!p.swaps.length && !p.trial)) return tags;
  const out = [...tags];
  const swap = (from: string, to: string) => {
    const at = out.findIndex((t) => same(t, from));
    if (at >= 0 && !out.some((t) => same(t, to))) out[at] = to;
  };
  for (const s of p.swaps) if (s.from <= day) swap(s.out, s.in);
  if (p.trial && challengerDay(p.trial, day)) swap(p.trial.out, p.trial.in);
  return out;
}

/** The hashtags in a stored post's text, without the "#". */
export function tagsOfText(text: string): string[] {
  return [...text.matchAll(/(?<![\w#])#([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]);
}

export interface TagPost {
  site: string;
  /** ISO timestamp of the post. */
  at: string;
  /** The text as the platform returned it. */
  text: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

export interface TagVerdict {
  verdict: "running" | "keep" | "back";
  inPosts: number;
  outPosts: number;
  inScore: number | null;
  outScore: number | null;
  why: string;
}

/** Compare the two arms of a trial. "running" until every trial post is TAG_MIN_AGE_DAYS old. */
export function judgeTagTrial(posts: TagPost[], now: number, trial: TagTrial): TagVerdict {
  const today = easternOf(now)?.day ?? "";
  const end = addDays(trial.start, TAG_TRIAL_DAYS); // first day after the trial
  const none = { inPosts: 0, outPosts: 0, inScore: null, outScore: null };
  if (today < addDays(end, TAG_MIN_AGE_DAYS)) return { verdict: "running", ...none, why: `Hashtag trial running: #${trial.in} against #${trial.out} on alternate days until ${addDays(end, -1)}.` };

  const bySite = new Map<string, { p: TagPost; arm: "in" | "out" }[]>();
  for (const p of posts) {
    const day = easternOf(p.at)?.day ?? "";
    if (day < trial.start || day >= end) continue;
    const tags = tagsOfText(p.text);
    const arm = tags.some((t) => same(t, trial.in)) ? "in" : tags.some((t) => same(t, trial.out)) ? "out" : null;
    if (!arm) continue;
    bySite.set(p.site, [...(bySite.get(p.site) ?? []), { p, arm }]);
  }
  const norms: Record<"in" | "out", number[]> = { in: [], out: [] };
  for (const list of bySite.values()) {
    const hasViews = list.some((e) => (e.p.views ?? 0) > 0);
    const metric = (p: TagPost) => (hasViews ? (p.views ?? 0) : (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0));
    const mean = list.reduce((n, e) => n + metric(e.p), 0) / list.length;
    if (!(mean > 0)) continue; // a site with no numbers says nothing about either tag
    for (const e of list) norms[e.arm].push(Math.min(metric(e.p) / mean, TAG_SCORE_CAP));
  }
  const avg = (l: number[]) => (l.length ? round2(l.reduce((s, n) => s + n, 0) / l.length) : null);
  const inScore = avg(norms.in);
  const outScore = avg(norms.out);
  const counts = { inPosts: norms.in.length, outPosts: norms.out.length, inScore, outScore };
  if (norms.in.length < TAG_MIN_POSTS || norms.out.length < TAG_MIN_POSTS || inScore == null || outScore == null) {
    return { verdict: "back", ...counts, why: `Hashtag trial over: too few posts to judge #${trial.in} against #${trial.out} (${norms.in.length} and ${norms.out.length}, ${TAG_MIN_POSTS} each needed), so #${trial.out} stays.` };
  }
  const numbers = `${inScore} against ${outScore} over ${norms.in.length} and ${norms.out.length} posts, 1.0 = an average post on its site`;
  if (inScore >= outScore * TAG_MARGIN) return { verdict: "keep", ...counts, why: `Hashtag trial over: #${trial.in} beat #${trial.out} (${numbers}), so #${trial.in} replaces it.` };
  return { verdict: "back", ...counts, why: `Hashtag trial over: #${trial.in} did not beat #${trial.out} by ${Math.round((TAG_MARGIN - 1) * 100)}% (${numbers}), so #${trial.out} stays.` };
}

export interface TagLoopState {
  /** The optimizer's Off switch. */
  off: boolean;
  plan: TagPlan;
  /** Eastern day of the last tag trial start or verdict. */
  lastChangeDay: string | null;
  /** "out:in" -> Eastern day that pair lost a trial. */
  failed: Record<string, string>;
}

export type TagAction = { type: "none" } | { type: "start"; trial: TagTrial } | { type: "keep"; trial: TagTrial; swap: TagSwap } | { type: "back"; trial: TagTrial };

export interface TagStep {
  action: TagAction;
  /** One plain sentence on where the hashtags stand today. */
  why: string;
  /** A line for the board, only on a start or a verdict. */
  line: string | null;
}

/** The board line, in the kind loop's shape ("Social optimizer <day> — ..."). */
const boardLine = (day: string, why: string) => `Social optimizer ${day} — ${why[0].toLowerCase()}${why.slice(1)}`;

/** The tag a post carries today where the code's lists say `tag` (standing swaps applied in order). */
function sittingTag(tag: string, swaps: TagSwap[], day: string): string {
  return tagsOn([tag], day, { swaps, trial: null })[0];
}

/** The day's move for hashtags: judge a running trial, or start the next challenger's. At most one thing. */
export function tagStep(input: { posts: TagPost[]; now: number; state: TagLoopState }): TagStep {
  const { posts, now, state } = input;
  const today = easternOf(now)?.day ?? "";
  if (state.off) return { action: { type: "none" }, why: "Hashtags: the optimizer is switched off.", line: null };

  const trial = state.plan.trial;
  if (trial) {
    const v = judgeTagTrial(posts, now, trial);
    if (v.verdict === "running") return { action: { type: "none" }, why: v.why, line: null };
    if (v.verdict === "keep") return { action: { type: "keep", trial, swap: { out: trial.out, in: trial.in, from: addDays(today, TAG_LEAD_DAYS) } }, why: v.why, line: boardLine(today, v.why) };
    return { action: { type: "back", trial }, why: v.why, line: boardLine(today, v.why) };
  }

  if (state.lastChangeDay && daysBetween(state.lastChangeDay, today) < TAG_COOLDOWN_DAYS) {
    return { action: { type: "none" }, why: `Hashtags: no trial running; the next one can start ${addDays(state.lastChangeDay, TAG_COOLDOWN_DAYS)}.`, line: null };
  }
  const start = addDays(today, TAG_LEAD_DAYS);
  const swaps = state.plan.swaps;
  const next = TAG_CANDIDATES.find((c) => {
    const lost = state.failed[`${c.out}:${c.in}`];
    if (lost && daysBetween(lost, today) < TAG_RETRY_DAYS) return false;
    // Only a tag still posting can be challenged, and never by a tag that already posts.
    if (!same(sittingTag(c.out, swaps, start), c.out)) return false;
    return !swaps.some((s) => same(s.in, c.in));
  });
  if (!next) return { action: { type: "none" }, why: "Hashtags: every challenger has had its trial; none is due a retry yet.", line: null };
  const started: TagTrial = { out: next.out, in: next.in, start };
  const why = `Hashtag trial starts ${start}: #${next.in} in place of #${next.out} on every other day for ${TAG_TRIAL_DAYS} days, then whichever did better stays.`;
  return { action: { type: "start", trial: started }, why, line: boardLine(today, why) };
}
