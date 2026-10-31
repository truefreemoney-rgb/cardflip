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

import { feeModelFor, formatLocalAmount, type EbayAccountType, type Marketplace } from "./marketplaces.ts";

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
// 10-08 evening (Chris: "something tells me it's not a flat $5"): real rates checked. 10-11 night (Chris: "why
// are we using $1.11, seems dumb"): the 2 oz guess was never weighed; a card + penny sleeve + toploader is
// ~0.35 oz and a #10 envelope ~0.2 oz, so one card is the 1 oz rate. Later that night every number was re-read
// off eBay's own shipping calculator (ebay.com/shp/calc/rates) and USPS Notice 123 (effective 2026-10-04):
//   - eBay Standard Envelope label, 1 oz, tracked: $0.78. eBay only sells it for items sold at $20 or less.
//   - Stamped envelope (no label, no tracking): Forever stamp $0.82 + $0.49 nonmachinable surcharge (a rigid
//     toploader can't go through the letter machines) = $1.31.
//   - Tracked mailer: eBay label, USPS Ground Advantage, 3 oz 7x4x1 bubble mailer, Columbus OH -> Los Angeles
//     = $6.07 (cross-country on purpose so the seller never loses money; nearby is $5.38). Under a pound the
//     weight never moves it, so a slab costs the same as a raw card.
// All three are the seller's cost, never the buyer's (free shipping: the postage sits inside the price).
/** The eBay Standard Envelope label: the cheapest postage, and the flat per-sale allowance everywhere else. */
export const POSTAGE_USD = 0.78;
/** Stamps on a plain envelope, no tracking: Forever $0.82 + $0.49 nonmachinable (USPS Notice 123, 2026-10-04). */
export const STAMP_POSTAGE_USD = 1.31;
/**
 * The seller PICKS how a card ships (Chris 10-08: "we shouldn't let the user
 * post to eBay unless they pick a shipping option"); the pick's postage sits
 * inside the asking price and the buyer sees free shipping. Chris 10-11 night
 * (sellers must stay competitive):
 *   sale price      "Envelope"                                   "Tracked mailer"
 *   $20 or less     eBay Standard Envelope label, tracked, $0.78  $6.07
 *   $20.01-$50      stamps, NO tracking, $1.31                    $6.07
 *   over $50        not allowed                                  $6.07 (required)
 * Nothing is picked by default; the suggested pick (defaultShipMethod) is the
 * tracked envelope while its price stays at $20 or less, else the tracked
 * mailer. The untracked stamp envelope is never suggested: the seller chooses it.
 */
export type ShipMethod = "envelope" | "tracked";
export const SHIP_METHODS: readonly ShipMethod[] = ["envelope", "tracked"];
export const TRACKED_POSTAGE_USD = 6.07;
/**
 * eBay Standard Envelope: eBay only sells the label for items sold at $20 or
 * less (eBay's rule, not ours). Over it the envelope pick goes out with stamps
 * and no tracking (Chris 10-11).
 */
export const ENVELOPE_LABEL_MAX_USD = 20;
/**
 * The envelope pick's cap: up to $50 a card may go in a stamped envelope; over
 * it the tracked mailer is required. Was $100 from 10-11; Chris 10-30 moved it
 * to $50: an untracked card that goes missing loses the "not received" claim,
 * and over $50 the extra $4.76 for tracking is under 10% of the sale.
 */
export const ENVELOPE_MAX_USD = 50;
/** Postage for the pick at this sale price (no price = the label rate): tracked $6.07; envelope $0.78 up to $20, $1.31 over. */
export function postageFor(method: ShipMethod | null | undefined, gross?: number | null): number {
  if (method === "tracked") return TRACKED_POSTAGE_USD;
  return gross != null && !envelopeTracked(gross) ? STAMP_POSTAGE_USD : POSTAGE_USD;
}
/**
 * What one copy REALLY costs to post at this sale price, for the Inventory
 * summary and the sales report (Chris 10-12: a $1,178 card showed
 * "Postage · 1 × $0.78"). Over $50 the tracked mailer whatever was picked;
 * otherwise the pick's rate at this price; with no pick on the row, eBay's
 * label up to $20 and the tracked mailer above it (the stamps are never
 * assumed: the seller chooses them).
 */
export function salePostage(method: ShipMethod | null | undefined, gross: number): number {
  if (!envelopeAllowed(gross)) return TRACKED_POSTAGE_USD;
  if (method) return postageFor(method, gross);
  return envelopeTracked(gross) ? POSTAGE_USD : TRACKED_POSTAGE_USD;
}
/** "$0.78" / "$6.07" for the pick tiles. */
export function formatMoneyPostage(n: number): string {
  // The "$" was lost when this shipped 10-08 (the tiles read "0.78"); found 10-11 night.
  return `$${n.toFixed(2)}`;
}
export function isShipMethod(v: unknown): v is ShipMethod {
  return v === "envelope" || v === "tracked";
}
/**
 * The seller's pick off a cards row (shipping_method), null when none — askingPriceFor then prices the
 * suggested pick. Every server-side recompute passes it (10-14: the Inventory refresh priced a $41.89 Sylveon
 * at the tracked $55.75 while the scanner, honouring the Envelope pick, said $50.26).
 */
export function shipMethodOf(row: { shipping_method?: string | null }): ShipMethod | null {
  return isShipMethod(row.shipping_method) ? row.shipping_method : null;
}
/** Whether the envelope pick is allowed at this sale price ($50 or less, Chris 10-30). */
export function envelopeAllowed(gross: number): boolean {
  return gross <= ENVELOPE_MAX_USD;
}
/** Whether an envelope at this sale price gets eBay's tracked Standard Envelope label ($20 or less) rather than stamps. */
export function envelopeTracked(gross: number): boolean {
  return gross <= ENVELOPE_LABEL_MAX_USD;
}
/** The pick to suggest for a card worth `net`: the tracked envelope while its price stays at $20 or less, never the stamps. */
export function defaultShipMethod(net: number): ShipMethod {
  return envelopeTracked(costCoveredPrice(net, "envelope")) ? "envelope" : "tracked";
}

/**
 * The asking price at which the seller KEEPS `net` after eBay's cut and
 * the postage of the chosen shipping — the fee is a share of the sale price,
 * so it compounds: gross = (net + flat + postage) / (1 − rate), rounded up to
 * the cent.
 */
export function costCoveredPrice(net: number, method: ShipMethod = "envelope"): number {
  const priced = (postage: number) => {
    const at = (flat: number) => Math.ceil(((net + flat + postage) / (1 - EBAY_FEE_RATE)) * 100) / 100;
    const low = at(EBAY_FLAT_FEE);
    // Over $10 the order fee is $0.40, so a price past the step must cover that instead.
    return low > EBAY_FLAT_FEE_STEP_USD ? at(EBAY_FLAT_FEE_OVER_10) : low;
  };
  const first = priced(postageFor(method));
  // An envelope priced past eBay's $20 label line ships with stamps (Chris 10-11): price it again with the
  // stamp postage. More postage only raises the price, so the result is over $20 too and never disagrees.
  return method === "envelope" && !envelopeTracked(first) ? priced(STAMP_POSTAGE_USD) : first;
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
/**
 * Chris 10-08: "the fees and shipping should be added to every card for now"
 * — every card lists at value + eBay fees + postage, no taper, so the seller
 * keeps the full market value at any price. Flip this off to bring the $5-$10
 * taper above back (the curve code stays intact underneath).
 */
export const COSTS_ON_EVERY_CARD = true;
/** Whether any fees/postage go on top of this value (under $10, or always). */
export function coversCosts(value: number): boolean {
  return value > 0 && (COSTS_ON_EVERY_CARD || value < COST_TAPER_END_USD);
}
/** Whether ALL of them do (under $5, or always) — the seller keeps the full value. */
export function coversAllCosts(value: number): boolean {
  return value > 0 && (COSTS_ON_EVERY_CARD || value < COST_COVERED_MAX_USD);
}

/**
 * The asking price for a card worth `value` under the rule above (the value
 * itself from $10 up). Integer cents, rounded up, so the taper never lands a
 * cent low and never dips below the full-cover price at $5.
 */
export function costTaperedPrice(value: number, method: ShipMethod = "envelope"): number {
  const cents = Math.round(value * 100);
  if (!coversCosts(cents / 100)) return cents / 100;
  const full = costCoveredPrice(cents / 100, method);
  if (coversAllCosts(cents / 100)) return full;
  const extra = Math.round(full * 100) - cents;
  const end = COST_TAPER_END_USD * 100;
  const span = (COST_TAPER_END_USD - COST_COVERED_MAX_USD) * 100;
  return (cents + Math.ceil((extra * (end - cents)) / span)) / 100;
}

/**
 * The break-even price: eBay's cut + postage and nothing else ($1.25 at
 * 13.25% + $0.30 + the $0.78 envelope label, 10-11). The old $1.79 minimum (clear $0.50 on every
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

// ---------------------------------------------------------------------------
// Per-marketplace variants (docs/EBAY_COUNTRIES_PLAN.md, increment 1).
//
// Same formulas as above with one marketplace's numbers. The exports above
// are the US path and are NOT changed; scripts/test-marketplaces.mjs asserts
// every `…For(US_MARKETPLACE)` equals its US twin across a price sweep. All
// amounts are in the marketplace's own currency. Nothing calls these for a
// non-US marketplace yet.

export function ebayFlatFeeFor(mp: Marketplace, gross: number, account?: EbayAccountType | null): number {
  const m = feeModelFor(mp, account);
  return gross > m.flatStep ? m.flatOver : m.flat;
}

export function estimatedEbayFeesFor(mp: Marketplace, gross: number, account?: EbayAccountType | null): number {
  return gross * feeModelFor(mp, account).rate + ebayFlatFeeFor(mp, gross, account);
}

/**
 * Round UP to a whole cent. The US row keeps Math.ceil exactly (its output is
 * pinned byte for byte). Other sites take a 1e-6-cent tolerance first: with a
 * no-fee model (UK / AU private) the quotient is an exact cent amount that
 * float noise ("1259.0000000000002") would otherwise round up a whole cent,
 * which also made the taper dip a cent as the value rose.
 */
function ceilCentsFor(mp: Marketplace, x: number): number {
  return mp.key === "US" ? Math.ceil(x) : Math.ceil(x - 1e-6);
}

export function costCoveredPriceFor(mp: Marketplace, net: number, account?: EbayAccountType | null, method: ShipMethod = "envelope"): number {
  const m = feeModelFor(mp, account);
  const priced = (postage: number) => {
    const at = (flat: number) => ceilCentsFor(mp, ((net + flat + postage) / (1 - m.rate)) * 100) / 100;
    const low = at(m.flat);
    return low > m.flatStep ? at(m.flatOver) : low;
  };
  const first = priced(postageForOn(mp, method));
  // US (Chris 10-11): an envelope priced past the label line ships with stamps, priced again at the stamp rate.
  return method !== "tracked" && mp.stamped && first > mp.stamped.over ? priced(mp.stamped.postage) : first;
}
/**
 * What the seller pays to post a card on this site by the chosen method at this
 * sale price (sites without a tracked tier: the letter rate; US envelope over
 * $20: the stamp rate, see postageFor).
 */
export function postageForOn(mp: Marketplace, method: ShipMethod | null | undefined, gross?: number | null): number {
  if (method === "tracked" && mp.tracked) return mp.tracked.postage;
  return gross != null && mp.stamped && gross > mp.stamped.over ? mp.stamped.postage : mp.postage;
}

/** salePostage for another eBay site: the tracked tier over the US envelope cap when the site has one, else the pick's rate (no pick = tracked over the label line). */
export function salePostageOn(mp: Marketplace, method: ShipMethod | null | undefined, gross: number): number {
  if (!mp.tracked) return postageForOn(mp, method, gross);
  if (gross > ENVELOPE_MAX_USD) return mp.tracked.postage;
  if (method) return postageForOn(mp, method, gross);
  return mp.stamped && gross > mp.stamped.over ? mp.tracked.postage : mp.postage;
}

export function coversCostsFor(mp: Marketplace, value: number): boolean {
  return value > 0 && (COSTS_ON_EVERY_CARD || value < mp.taper.end);
}

export function coversAllCostsFor(mp: Marketplace, value: number): boolean {
  return value > 0 && (COSTS_ON_EVERY_CARD || value < mp.taper.coveredMax);
}

/** The taper formula for one value in cents (inside the taper zone or below it). */
function taperCents(mp: Marketplace, cents: number, account?: EbayAccountType | null): number {
  const full = costCoveredPriceFor(mp, cents / 100, account);
  if (coversAllCostsFor(mp, cents / 100)) return full;
  const extra = Math.round(full * 100) - cents;
  const end = mp.taper.end * 100;
  const span = (mp.taper.end - mp.taper.coveredMax) * 100;
  return (cents + ceilCentsFor(mp, (extra * (end - cents)) / span)) / 100;
}

export function costTaperedPriceFor(mp: Marketplace, value: number, account?: EbayAccountType | null): number {
  const cents = Math.round(value * 100);
  if (!coversCostsFor(mp, cents / 100)) return cents / 100;
  if (mp.key === "US" || coversAllCostsFor(mp, cents / 100)) return taperCents(mp, cents, account);
  // Another site, inside the taper: a cheaper card must never list higher (the
  // US curve's documented property). Where postage is close to the taper's
  // width (IE: a €3.50 envelope over a €5 taper) the curve is nearly flat and
  // cent rounding can dip it, so take the running maximum from the taper's start.
  let best = 0;
  for (let c = Math.ceil(mp.taper.coveredMax * 100); c <= cents; c++) best = Math.max(best, taperCents(mp, c, account));
  return best;
}

export function listingFloorFor(mp: Marketplace, account?: EbayAccountType | null): number {
  return costCoveredPriceFor(mp, 0, account);
}

export function belowFloorFor(mp: Marketplace, price: number, account?: EbayAccountType | null): boolean {
  return price > 0 && price < listingFloorFor(mp, account) - 0.005;
}

export function floorRefusalFor(mp: Marketplace, account?: EbayAccountType | null): string {
  // £ / € / A$ / C$ (the narrow symbol alone would print AUD and CAD as a bare "$", next to US$).
  const amount = formatLocalAmount(mp, listingFloorFor(mp, account));
  return `The lowest price is ${amount} — anything under it loses money after eBay fees and postage.`;
}

export function netAfterFeesFor(mp: Marketplace, gross: number, actualFees?: number | null, account?: EbayAccountType | null): number {
  return gross - (actualFees ?? estimatedEbayFeesFor(mp, gross, account));
}
