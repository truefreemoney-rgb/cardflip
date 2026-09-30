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
 * Postage the seller pays on a single card (a stamp + a toploader mailer).
 *
 * gross − (gross·rate + flat) − postage ≥ net  ⇒  gross ≥ (net + flat + postage) / (1 − rate)
 */
export const POSTAGE_USD = 0.75;

/**
 * The asking price at which the seller KEEPS `net` after eBay's cut and
 * postage — the fee is a share of the sale price, so it compounds:
 * gross = (net + flat + postage) / (1 − rate), rounded up to the cent.
 */
export function costCoveredPrice(net: number): number {
  return Math.ceil(((net + EBAY_FLAT_FEE + POSTAGE_USD) / (1 - EBAY_FEE_RATE)) * 100) / 100;
}

/**
 * Cheap cards list at their value PLUS fees and postage (Chris, 09-30: "start
 * with the total cost of fees and postage then attach the tcg price of the
 * card on top" — a $1.50 card at $1.50 nets a quarter). Below this value the
 * suggested price is costCoveredPrice(value), so the seller pockets the
 * card's full market value; from here up the card is worth enough that the
 * market price already clears costs and stays competitive with other eBay
 * listings, so it prices as before.
 */
export const COST_COVERED_MAX_USD = 5;
export function coversCosts(value: number): boolean {
  return value > 0 && value < COST_COVERED_MAX_USD;
}

/**
 * The break-even price: eBay's cut + postage and nothing else ($1.22 at
 * 13.25% + $0.30 + $0.75). The old $1.79 minimum (clear $0.50 on every
 * sale, 09-03) is gone — Chris 09-30: "if you follow these rules, you
 * shouldnt need to have the minimum listing price any more"; a $0.25
 * Spidops lists at $1.50, not $1.79. Suggested prices never come near this
 * line (value + costs is always above it); it only stops a hand-typed price
 * that would lose money.
 */
export function listingFloor(): number {
  return costCoveredPrice(0);
}

/**
 * HARD RULE (Chris, 09-08: "we can never go under the floor price, the user
 * has to at least break even or make a profit, never lose money"): no
 * listing price below break-even can be saved, repriced, drafted or
 * published. Servers refuse with this sentence; the UI clamps before it
 * gets there. $0 means "unpriced" and is not a listing price, so it passes.
 */
export function belowFloor(price: number): boolean {
  return price > 0 && price < listingFloor() - 0.005;
}
export function floorRefusal(): string {
  return `The lowest price is $${listingFloor().toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — anything under it loses money after eBay fees and postage.`;
}

/** What the seller pockets — actual fees when recorded, the estimate otherwise. */
export function netAfterFees(gross: number, actualFees?: number | null): number {
  return gross - (actualFees ?? estimatedEbayFees(gross));
}
