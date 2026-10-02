/**
 * The daily social optimization loop, the scoring half (Chris 10-02: the
 * optimizing must be a job in the product, "should be daily"). Pure: no DB,
 * no fetch — tested in scripts/test-social-optimize.mjs. The job that feeds
 * it is lib/server/socialOptimize.ts.
 *
 * What it can decide is small on purpose. Four kinds exist (set, movers,
 * games, dips), three post each day, and 1pm is always the movers video. So
 * one kind sits on the bench, and the only move is: the benched kind takes
 * the 7am or 7pm slot from the kind posting there, when its posts clearly
 * did better.
 *
 * - Posts 2 to 28 days old only: views keep growing for two days, and a
 *   month-old result says little about now.
 * - Each post is scored against its own site's average (1.0 = an average
 *   post there), so TikTok's view counts cannot swamp the rest. A site that
 *   reports views is scored on views, one that does not (Bluesky, Facebook)
 *   on likes + comments + shares.
 * - One runaway post cannot carry a kind: a post counts for at most
 *   SCORE_CAP times its site's average.
 * - A kind needs MIN_POSTS posts over MIN_DAYS days or there is no opinion.
 * - The bench must beat the sitting kind by MARGIN, and after a change
 *   nothing moves for COOLDOWN_DAYS, so noise cannot flip the schedule.
 *
 * KNOWN LIMIT (measured on prod 10-02): a kind and its time of day are
 * tangled. Set has only ever posted at 7am, movers at 1pm as a video, dips
 * at 7pm, so "dips beat set" may only mean "7pm beats 7am". A finding here
 * is a lead worth a trial, not proof; the switch that acts on it must judge
 * the trial against the old kind IN THE SAME SLOT and put the old kind back
 * when the new one does no better. And a benched kind earns no new numbers,
 * so without trials the loop has nothing to compare after 28 days.
 */
import { easternOf } from "./socialPosts.ts";

export type ScoredKind = "set" | "movers" | "games" | "dips";
export type OpenSlot = "morning" | "evening";
export const SCORED_KINDS: ScoredKind[] = ["set", "movers", "games", "dips"];
export const KIND_NAME: Record<ScoredKind, string> = { set: "set spotlight", movers: "weekly gains", games: "all-games jumps", dips: "price drops" };
export const SLOT_NAME: Record<OpenSlot, string> = { morning: "7am", evening: "7pm" };

export const MIN_AGE_DAYS = 2;
export const MAX_AGE_DAYS = 28;
export const MIN_POSTS = 10;
export const MIN_DAYS = 5;
export const MARGIN = 1.2;
export const SCORE_CAP = 4;
export const COOLDOWN_DAYS = 7;

const DAY_MS = 86_400_000;

export interface ScoredPost {
  site: string;
  kind: string;
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

export interface OptimizeInput {
  posts: ScoredPost[];
  now: number;
  /** The standing schedule: the kind each slot posts. */
  sitting: { morning: ScoredKind; midday: ScoredKind; evening: ScoredKind };
  /** Eastern day of the last change the loop made, if any. */
  lastChangeDay?: string | null;
}

export interface OptimizeReport {
  /** Eastern day the report was made. */
  day: string;
  /** Posts that counted (in the age window, on a site with numbers). */
  counted: number;
  scores: KindScore[];
  /** The one change to make, or null. */
  change: { slot: OpenSlot; from: ScoredKind; to: ScoredKind } | null;
  /** One plain sentence: what it found and why it does or does not change anything. */
  why: string;
}

function isScored(kind: string): kind is ScoredKind {
  return (SCORED_KINDS as string[]).includes(kind);
}

/** Score every kind and pick at most one change. */
export function optimize(input: OptimizeInput): OptimizeReport {
  const day = easternOf(input.now)?.day ?? "";
  const eligible = input.posts.filter((p) => {
    const t = Date.parse(p.at.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (!isScored(p.kind) || Number.isNaN(t)) return false;
    const age = (input.now - t) / DAY_MS;
    return age >= MIN_AGE_DAYS && age <= MAX_AGE_DAYS;
  });
  // Each site against its own average.
  const bySite = new Map<string, ScoredPost[]>();
  for (const p of eligible) bySite.set(p.site, [...(bySite.get(p.site) ?? []), p]);
  const sums = new Map<ScoredKind, { total: number; posts: number; days: Set<string> }>();
  let counted = 0;
  for (const posts of bySite.values()) {
    const hasViews = posts.some((p) => (p.views ?? 0) > 0);
    const metric = (p: ScoredPost) => (hasViews ? (p.views ?? 0) : (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0));
    const mean = posts.reduce((n, p) => n + metric(p), 0) / posts.length;
    if (!(mean > 0)) continue; // a site with no numbers at all says nothing about any kind
    for (const p of posts) {
      const s = sums.get(p.kind as ScoredKind) ?? { total: 0, posts: 0, days: new Set<string>() };
      s.total += Math.min(metric(p) / mean, SCORE_CAP);
      s.posts++;
      const d = easternOf(p.at)?.day;
      if (d) s.days.add(d);
      sums.set(p.kind as ScoredKind, s);
      counted++;
    }
  }
  const scores: KindScore[] = SCORED_KINDS.map((kind) => {
    const s = sums.get(kind);
    const enough = s && s.posts >= MIN_POSTS && s.days.size >= MIN_DAYS;
    return { kind, posts: s?.posts ?? 0, days: s?.days.size ?? 0, score: enough ? Math.round((s.total / s.posts) * 100) / 100 : null };
  });
  const scoreOf = (k: ScoredKind) => scores.find((s) => s.kind === k)?.score ?? null;
  const report = (change: OptimizeReport["change"], why: string): OptimizeReport => ({ day, counted, scores, change, why });

  if (input.lastChangeDay && day) {
    const since = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${input.lastChangeDay}T12:00:00Z`)) / DAY_MS);
    if (since >= 0 && since < COOLDOWN_DAYS) return report(null, `No change: the schedule changed ${since === 0 ? "today" : `${since} day${since === 1 ? "" : "s"} ago`}, and the new post needs ${COOLDOWN_DAYS} days of numbers first.`);
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
    for (const slot of ["morning", "evening"] as OpenSlot[]) {
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
      return `${KIND_NAME[k]} (${s.posts} post${s.posts === 1 ? "" : "s"} over ${s.days} day${s.days === 1 ? "" : "s"})`;
    });
    return report(null, `No change: not enough posts yet to judge ${lines.join(" and ")}; a kind needs ${MIN_POSTS} posts over ${MIN_DAYS} days.`);
  }
  return report(null, `No change: nothing on the bench beats what is posting by ${Math.round((MARGIN - 1) * 100)}%.`);
}
