/**
 * eBay selling fees. One shared source: the UI, the CSV export, and the admin
 * stats all quote fees through here.
 *
 * The estimate (13.25% + $0.30) mirrors eBay's standard trading-card final
 * value fee. It's only the fallback: once the Finances API has reported the
 * real fee for a sale (cards.sold_fees, synced by lib/server/ebayFinances.ts)
 * that actual figure wins — category quirks, promoted-listing fees and store
 * discounts make the flat formula wrong in both directions.
 */

export const EBAY_FEE_RATE = 0.1325;
export const EBAY_FLAT_FEE = 0.3;

export function estimatedEbayFees(gross: number): number {
  return gross * EBAY_FEE_RATE + EBAY_FLAT_FEE;
}

/**
 * The listing-price floor (Chris, 09-03): a single cheap card has to clear
 * MIN_NET_USD after eBay's fees AND the postage the seller pays, or the
 * listing is a guaranteed loss — a $0.91 Eri nets nothing after 13.25% +
 * $0.30 + a stamp. TCGplayer's market stays the card's VALUE; this is the
 * least an eBay listing can sensibly say. It never bites above a few
 * dollars, so mid and high value cards price exactly as before.
 *
 * gross − (gross·rate + flat) − postage ≥ net  ⇒  gross ≥ (net + flat + postage) / (1 − rate)
 */
export const MIN_NET_USD = 0.5;
export const POSTAGE_USD = 0.75;

export function listingFloor(): number {
  return Math.ceil(((MIN_NET_USD + EBAY_FLAT_FEE + POSTAGE_USD) / (1 - EBAY_FEE_RATE)) * 100) / 100;
}

/** What the seller pockets — actual fees when recorded, the estimate otherwise. */
export function netAfterFees(gross: number, actualFees?: number | null): number {
  return gross - (actualFees ?? estimatedEbayFees(gross));
}
