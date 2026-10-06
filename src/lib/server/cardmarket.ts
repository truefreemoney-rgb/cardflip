/**
 * Cardmarket (Europe's card market) as the last price source for cards
 * TCGplayer can't price (10-05, Chris: "use every resource available to get
 * the cards priced"). Its EUR figures are stored in dollars at the day's ECB
 * rate under source "cardmarket-converted", so every dollar reader shows them
 * and card pages / charts say where they came from. No "server-only": tests
 * and scripts import it.
 */

export const CONVERTED_SOURCE = "cardmarket-converted";

/** Cardmarket's game ids in its free product files (probed 10-05). */
export const CARDMARKET_GAME = { mtg: 1, yugioh: 3, pokemon: 6, onepiece: 18, lorcana: 19 } as const;

/**
 * Pure: one Cardmarket price block → today's dollar price, or null. Trend
 * first, else the 30-day average; skipped when the figures disagree wildly
 * (trend vs avg30 over 3×, the cheapest listing over 2× the trend, or €100+
 * with no listing at all: Creator Pack Mudkip €2,912 trend / €10,000 low,
 * Treecko €943 / €2,500, Torchic €1,199 / none, 10-05) or under 2 cents.
 */
export function cardmarketUsd(cm: unknown, usdPerEur: number | null): number | null {
  if (!cm || typeof cm !== "object" || !usdPerEur || !(usdPerEur > 0)) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const { trend, avg30, low } = cm as { trend?: unknown; avg30?: unknown; low?: unknown };
  const t = n(trend), a = n(avg30), l = n(low);
  const eur = t ?? a;
  if (eur == null || eur < 0.02) return null;
  if (t != null && a != null && Math.max(t, a) > 3 * Math.min(t, a)) return null;
  if (l != null && l > 2 * eur) return null;
  if (l == null && eur >= 100) return null;
  return Math.round(eur * usdPerEur * 100) / 100;
}

export interface PriceGuideEntry {
  idProduct: number;
  trend?: number | null;
  avg30?: number | null;
  low?: number | null;
  "trend-foil"?: number | null;
  "avg30-foil"?: number | null;
  "low-foil"?: number | null;
}

/** Pure: a price-guide entry → { usd, foil } in dollars (plain and foil judged separately). */
export function guideUsd(g: PriceGuideEntry | undefined, usdPerEur: number | null): { usd: number | null; foil: number | null } {
  if (!g) return { usd: null, foil: null };
  return {
    usd: cardmarketUsd({ trend: g.trend, avg30: g.avg30, low: g.low }, usdPerEur),
    foil: cardmarketUsd({ trend: g["trend-foil"], avg30: g["avg30-foil"], low: g["low-foil"] }, usdPerEur),
  };
}

/** Cardmarket's free daily price guide for one game (~17 MB for Yu-Gi-Oh), keyed by idProduct. */
export async function fetchPriceGuide(cmGame: number): Promise<Map<number, PriceGuideEntry>> {
  const url = `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_${cmGame}.json`;
  const r = await fetch(url, { headers: { "User-Agent": "CardFlip/1.0 (support@cardflip.io)" }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`cardmarket price guide ${cmGame}: HTTP ${r.status}`);
  const body = (await r.json()) as { priceGuides?: PriceGuideEntry[] };
  return new Map((body.priceGuides ?? []).map((g) => [g.idProduct, g]));
}
