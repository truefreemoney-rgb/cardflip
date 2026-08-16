/**
 * Pure helpers behind the price-history feature — no DB, no server-only, so
 * scripts/test-price-history.mjs can drive them and the chart can share them.
 */

import type { HistoryPoint } from "@/lib/priceSeries";
export type { HistoryPoint } from "@/lib/priceSeries";

export interface HistorySeries {
  variant: string;
  source: string;
  currency: string;
  points: HistoryPoint[];
}

export interface HistoryStats {
  current: number;
  low30: number | null;
  high30: number | null;
  low90: number | null;
  high90: number | null;
  lowAll: number;
  highAll: number;
  /** Percent change from the first point ≥30 days back (or oldest) to now. */
  change30: number | null;
  days: number;
}

function daysAgo(day: string, now = Date.now()): number {
  return Math.floor((now - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}

export function summarize(points: HistoryPoint[], now = Date.now()): HistoryStats | null {
  if (points.length === 0) return null;
  const current = points[points.length - 1].price;
  const window = (n: number) => points.filter((p) => daysAgo(p.day, now) <= n);
  const range = (ps: HistoryPoint[]): [number, number] | null => {
    if (ps.length < 2) return null;
    let lo = Infinity, hi = -Infinity;
    for (const p of ps) { if (p.price < lo) lo = p.price; if (p.price > hi) hi = p.price; }
    return [lo, hi];
  };
  const r30 = range(window(30));
  const r90 = range(window(90));
  const rAll = range(points) ?? [current, current];
  // Change: compare against the oldest point that is within 30 days — or the
  // oldest we have, if the series is younger than that.
  const w30 = window(30);
  const base = w30.length >= 2 ? w30[0] : points[0];
  const change30 =
    base && base !== points[points.length - 1] && base.price > 0
      ? ((current - base.price) / base.price) * 100
      : null;
  return {
    current,
    low30: r30?.[0] ?? null,
    high30: r30?.[1] ?? null,
    low90: r90?.[0] ?? null,
    high90: r90?.[1] ?? null,
    lowAll: rAll[0],
    highAll: rAll[1],
    change30,
    days: daysAgo(points[0].day, now),
  };
}
