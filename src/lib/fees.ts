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

/** What the seller pockets — actual fees when recorded, the estimate otherwise. */
export function netAfterFees(gross: number, actualFees?: number | null): number {
  return gross - (actualFees ?? estimatedEbayFees(gross));
}
