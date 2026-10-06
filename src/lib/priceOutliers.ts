/**
 * The one read-time outlier filter for price history (10-06). price_series keeps junk one-off prints (Aquapolis
 * Tyranitar: a 3-day $0.32 between $110s) that a chart's low/high and the "the low was" sentence would print.
 * Stored data is never touched; every place history feeds a UI reads it through dropOutliers.
 *
 * Rule: a short stretch (at most MAX_JUNK_RUN consecutive points within 1.5x of each other) that sits more than
 * 4x above, or under a quarter of, the level on BOTH sides of it (median of up to 5 points each side) is dropped.
 * A real step change survives: its far side keeps the new level, so the stretch is not off both neighbours
 * (Tyranitar $56 to $111 is a doubling, and a level that persisted for weeks is a market, not a blip).
 * The first and last stretch are never dropped: with one neighbour there is nothing to tell a blip from a move,
 * and the newest point must match the headline price.
 */

import { toPoints, type HistoryPoint } from "./priceSeries.ts";

export const OUTLIER = { factor: 4, maxRun: 7, joinRatio: 1.5, side: 5 } as const;

const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/** Consecutive points whose neighbours stay within joinRatio of each other: [start, end) index pairs. */
function runsOf(points: HistoryPoint[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1]?.price, b = points[i]?.price;
    if (i === points.length || Math.max(a, b) / Math.min(a, b) > OUTLIER.joinRatio) {
      runs.push([start, i]);
      start = i;
    }
  }
  return runs;
}

/** The points with junk blips removed (a new array; the input is not mutated). Series under 3 points pass through. */
export function dropOutliers<T extends HistoryPoint>(points: T[]): T[] {
  let cur = points.filter((p) => p.price > 0);
  // Two passes: a spike next to another spike only shows once its neighbour is gone.
  for (let pass = 0; pass < 2 && cur.length >= 3; pass++) {
    const runs = runsOf(cur);
    const drop = new Set<number>();
    for (let r = 1; r < runs.length - 1; r++) {
      const [s, e] = runs[r];
      if (e - s > OUTLIER.maxRun) continue;
      const level = median(cur.slice(s, e).map((p) => p.price));
      const before = median(cur.slice(Math.max(0, s - OUTLIER.side), s).map((p) => p.price));
      const after = median(cur.slice(e, e + OUTLIER.side).map((p) => p.price));
      const hi = Math.max(before, after), lo = Math.min(before, after);
      if (level > hi * OUTLIER.factor || level < lo / OUTLIER.factor) for (let i = s; i < e; i++) drop.add(i);
    }
    if (drop.size === 0) break;
    cur = cur.filter((_, i) => !drop.has(i));
  }
  return cur;
}

/** How many points dropOutliers would remove. */
export const countOutliers = (points: HistoryPoint[]): number => points.length - dropOutliers(points).length;

/** A stored series row as chart points, junk blips removed: the way every UI reader turns a row into history. */
export const cleanSeriesPoints = (row: { startDay: string; prices: (number | null)[] }): HistoryPoint[] => dropOutliers(toPoints(row));
