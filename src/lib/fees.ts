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
/** Per-order fee: $0.30 on an order of $10 or less, $0.40 over $10 (eBay US since 03-2024; Chris 09-30). */
export const EBAY_FLAT_FEE = 0.3;
export const EBAY_FLAT_FEE_OVER_10 = 0.4;
export const EBAY_FLAT_FEE_STEP_USD = 10;

export function ebayFlatFee(gross: number): number {
  return gross > EBAY_FLAT_FEE_STEP_USD ? EBAY_FLAT_FEE_OVER_10 : EBAY_FLAT_FEE;
}

export function estimatedEbayFees(gross: number): number {
  return gross * EBAY_FEE_RATE + ebayFlatFee(gross);
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
  const at = (flat: number) => Math.ceil(((net + flat + POSTAGE_USD) / (1 - EBAY_FEE_RATE)) * 100) / 100;
  const low = at(EBAY_FLAT_FEE);
  // Over $10 the order fee is $0.40, so a price past the step must cover that instead.
  return low > EBAY_FLAT_FEE_STEP_USD ? at(EBAY_FLAT_FEE_OVER_10) : low;
}

/**
 * Cheap cards list at their value PLUS fees and postage (Chris, 09-30: "start
 * with the total cost of fees and postage then attach the tcg price of the
 * card on top" — a $1.50 card at $1.50 nets a quarter). Under
 * COST_COVERED_MAX_USD the whole cost goes on top (costCoveredPrice), so the
 * seller pockets the card's full market value. From there the added share
 * TAPERS straight down to nothing at COST_TAPER_END_USD (Chris 09-30 picked
 * the taper over a flat $10 line, which would list a $9.99 card at $12.73
 * beside a $10.00 card at $10.00): $5 → $6.98, $7.50 → $8.68, $10 → $10.
 * The curve only rises with value, so a cheaper card never lists higher —
 * and a quick sale (a smaller value) always lands under full value. From
 * $10 up the market price already clears costs and stays competitive.
 */
export const COST_COVERED_MAX_USD = 5;
export const COST_TAPER_END_USD = 10;
/** Whether any fees/postage go on top of this value (under $10). */
export function coversCosts(value: number): boolean {
  return value > 0 && value < COST_TAPER_END_USD;
}
/** Whether ALL of them do (under $5) — the seller keeps the full value. */
export function coversAllCosts(value: number): boolean {
  return value > 0 && value < COST_COVERED_MAX_USD;
}

/**
 * The asking price for a card worth `value` under the rule above (the value
 * itself from $10 up). Integer cents, rounded up, so the taper never lands a
 * cent low and never dips below the full-cover price at $5.
 */
export function costTaperedPrice(value: number): number {
  const cents = Math.round(value * 100);
  if (!coversCosts(cents / 100)) return cents / 100;
  const full = costCoveredPrice(cents / 100);
  if (coversAllCosts(cents / 100)) return full;
  const extra = Math.round(full * 100) - cents;
  const end = COST_TAPER_END_USD * 100;
  const span = (COST_TAPER_END_USD - COST_COVERED_MAX_USD) * 100;
  return (cents + Math.ceil((extra * (end - cents)) / span)) / 100;
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
