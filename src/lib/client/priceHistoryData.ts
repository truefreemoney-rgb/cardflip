import { useEffect, useState } from "react";
import { apiPath } from "@/lib/client/basePath";
import type { Currency, PokemonCard } from "@/lib/types";
import type { PriceFlag, PriceStale } from "@/lib/priceFlag";

/**
 * The price-history data layer, split out of components/PriceHistoryChart.tsx
 * so callers that only need the numbers (the trend strip, the recorded-price
 * fallback, the sparkline) do not pull the chart's drawing code into their
 * bundle. PriceHistoryChart re-exports everything here for compatibility.
 */

export interface Point { day: string; price: number }
export interface Series {
  variant: string;
  source: string;
  currency: string;
  points: Point[];
  /** The price guard flags this series (/api/price-history): the drawn history stays, the latest point is not presented as the price. */
  untrusted?: PriceFlag;
  /** The latest value has stood 45+ days (/api/price-history, 10-02): shown, with a note. */
  stale?: PriceStale;
}

/** The latest recorded point of a series, as the editor stores it (feeds pointCanRebase in lib/listing.ts). */
export interface RecordedPoint { price: number; day: string; variant: string; source: string; currency: Currency; untrusted?: PriceFlag; stale?: PriceStale }
const pointOf = (s: Series): RecordedPoint | null => {
  const last = s.points[s.points.length - 1];
  return last
    ? { price: last.price, day: last.day, variant: s.variant, source: s.source, currency: s.currency as Currency, ...(s.untrusted ? { untrusted: s.untrusted } : {}), ...(s.stale ? { stale: s.stale } : {}) }
    : null;
};


export interface TrendAverages {
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  currency: Currency;
  source: string;
}
/**
 * The source-published averages for a card, if any (Cardmarket via
 * pokemontcg.io). Sanitized here — the display side — because cached price
 * rows predate the fetch-time guard in lib/tcg.ts: Cardmarket's product
 * averages sometimes blend 1st Edition / graded sales (Base Set Charizard's
 * 1d was €14,950 next to an $855 TCGplayer market), and one absurd figure
 * discredits the whole panel. The strip is dropped entirely when its 30d
 * baseline is >4x the best USD market; 1d/7d values >3x off that baseline
 * are hidden individually.
 */
export function cardTrend(card: Pick<PokemonCard, "prices">): TrendAverages | null {
  const p = card.prices.find((x) => x.trend && (x.trend.avg30 || x.trend.avg7 || x.trend.avg1));
  if (!p?.trend) return null;
  const usdMarket = card.prices.reduce<number | null>(
    (best, x) =>
      x.currency === "USD" && x.market != null && (best == null || x.market > best)
        ? x.market
        : best,
    null,
  );
  const base = p.trend.avg30 ?? p.trend.avg7;
  if (base != null && usdMarket != null && base > usdMarket * 4) return null;
  const steady = (v: number | null) =>
    v == null ? null : base != null && (v > base * 3 || v < base / 3) ? null : v;
  return {
    avg1: steady(p.trend.avg1),
    avg7: steady(p.trend.avg7),
    avg30: p.trend.avg30 ?? null,
    currency: p.currency,
    source: p.source,
  };
}

// The promise is cached, not the result, so four panels opening the same
// card at once share ONE request (QA, 09-04: 4× identical fetches per open).
export const cache = new Map<string, Promise<Series[]>>();

/** Fetches (and memoizes per page) every series we hold for a card. Shared with PriceSparkline. */
export function loadSeries(cardId: string): Promise<Series[]> {
  if (!cardId) return Promise.resolve([]);
  const hit = cache.get(cardId);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch(apiPath(`/api/price-history?cardId=${encodeURIComponent(cardId)}`));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { series: Series[] };
    return data.series;
  })();
  cache.set(cardId, p);
  p.catch(() => cache.delete(cardId));
  return p;
}

export function pickSeries(all: Series[], prefer: string | null | undefined): Series | null {
  if (all.length === 0) return null;
  // USD only (Chris 09-26): no EUR fallback, the chart just waits for a dollar series.
  const pool = all.filter((s) => s.currency === "USD");
  if (pool.length === 0) return null;
  const byPref = prefer ? pool.filter((s) => s.variant === prefer) : [];
  const ranked = (byPref.length ? byPref : pool)
    .slice()
    .sort((a, b) => b.points.length - a.points.length || (a.source === "tcgplayer" ? -1 : 1));
  return ranked[0] ?? null;
}

/**
 * The most recent recorded point for a card (preferring `variant`), from the
 * same fetch/cache the chart uses — lets the Market panel's TCGplayer tile
 * fall back to yesterday's recorded price when the live lookup fails
 * (pokemontcg.io drops about half its requests).
 */
/** The latest recorded point for a card (preferring `variant`), one-shot — the page stores it on the queue item. */
export async function lastRecordedPoint(
  cardId: string,
  variant?: string | null,
): Promise<RecordedPoint | null> {
  const all = await loadSeries(cardId);
  const s = pickSeries(all, variant);
  return s ? pointOf(s) : null;
}

export function useLastRecordedPrice(cardId: string, variant?: string | null) {
  const [state, setState] = useState<{ id: string; point: RecordedPoint | null }>({ id: "", point: null });
  useEffect(() => {
    if (!cardId) return; // caller has no catalogue card (hook-order placeholder)
    let alive = true;
    loadSeries(cardId)
      .then((all) => {
        if (!alive) return;
        const s = pickSeries(all, variant);
        setState({ id: cardId, point: s ? pointOf(s) : null });
      })
      .catch(() => { if (alive) setState({ id: cardId, point: null }); });
    return () => { alive = false; };
  }, [cardId, variant]);
  return state.id === cardId ? state.point : null;
}
