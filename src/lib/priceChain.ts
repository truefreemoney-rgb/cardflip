/**
 * THE card price chain (Chris 10-19 "yes build it", docs/PRICE-SOURCES-TEST-10-19.md):
 * the order every market price is taken from, and the one place the lifts live.
 * Client-safe: no secrets, no db.
 *
 *   1. TCGplayer market (today).
 *   2. Our own 30-day TCGplayer median: a flagged number's first stand-in (priceTrustSite fallbackOf).
 *   3. Cardmarket converted to dollars and lifted 12% (MAGIC ONLY, measured 10-19: 11-13% low, 55-68% within 25%).
 *      Pokémon's Cardmarket sits at half of TCGplayer and scatters: no lift, last resort only.
 *   4. Card Kingdom retail divided by 1.24 (MAGIC ONLY: official public list, a consistent shop markup).
 *   5. CardTrader cheapest Near Mint listing: last resort (thin, 25-66% high on $20+).
 *   6. Unsure: the seller types it.
 *
 * eBay sold is NEVER a base ("ebay prices are always going to be higher and wrong because they bake in the ebay fees and
 * shipping"); lib/listing.ts pickPrice quotes it only when TCGplayer's row is flagged, 45+ days flat, or missing.
 * Steps 3-5 fill cards TCGplayer leaves blank (the nightly jobs write them under their own source so every page says where
 * the number came from) and rank the stored backup rows a card page reads (backupRank).
 */
import type { GameId } from "@/lib/types";

/** Cardmarket EUR -> USD lift per game; absent = no lift (the plain ECB conversion). */
export const CARDMARKET_LIFT: Partial<Record<GameId, number>> = { mtg: 1.12 };

export const cardmarketLift = (game: GameId | string | null | undefined): number => (game && game in CARDMARKET_LIFT ? CARDMARKET_LIFT[game as GameId]! : 1);

/** Card Kingdom retail / this = a TCGplayer-level number (measured 10-19: median 1.22-1.32x TCGplayer by price band). */
export const CARD_KINGDOM_DIVISOR = 1.24;
export const CARD_KINGDOM_SOURCE = "cardkingdom";

/** Stored backup sources a card page may headline when no TCGplayer row is fresh, best first, per game. */
export const BACKUP_ORDER: Record<GameId, readonly string[]> = {
  mtg: ["cardmarket-converted", CARD_KINGDOM_SOURCE, "cardtrader"],
  pokemon: ["cardtrader", "cardmarket-converted"],
  yugioh: ["cardtrader", "cardmarket-converted"],
  onepiece: ["cardtrader", "cardmarket-converted"],
  lorcana: ["cardtrader", "cardmarket-converted"],
};

/** Lower is better; a source the chain does not list ranks last. */
export function backupRank(game: GameId | string, source: string): number {
  const order = BACKUP_ORDER[game as GameId] ?? [];
  const i = order.indexOf(source);
  return i < 0 ? order.length : i;
}

/** What a stored backup source is called on a card page, the chart and the price table. */
export function backupSourceLabel(source: string): string {
  switch (source) {
    case "cardmarket-converted": return "Cardmarket (converted from €)";
    case CARD_KINGDOM_SOURCE: return "Card Kingdom (adjusted)";
    case "cardtrader": return "CardTrader (listings)";
    default: return source;
  }
}

/** How many days back the own-series median looks (step 2). */
export const MEDIAN_DAYS = 30;

/**
 * Pure: the median of a series' last `days` priced points, or null under `minPoints`. `prices` is the decoded day-indexed
 * series (nulls = no price that day), newest last.
 */
export function recentMedian(prices: readonly (number | null)[], days = MEDIAN_DAYS, minPoints = 5): number | null {
  const tail = prices.slice(-days).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b);
  if (tail.length < minPoints) return null;
  const mid = Math.floor(tail.length / 2);
  const m = tail.length % 2 ? tail[mid] : (tail[mid - 1] + tail[mid]) / 2;
  return Math.round(m * 100) / 100;
}
