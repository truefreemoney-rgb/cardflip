import { POSTAGE_USD, coversAllCosts, coversCosts, estimatedEbayFees } from "./fees.ts";
import { askingPriceFor, formatMoney } from "./listing.ts";
import { priceDayLabel, type CardFacts } from "./cardPages.ts";
import { SCANS } from "./pricing.ts";
import { dayIndex, type HistoryPoint } from "./priceSeries.ts";
import type { GameId } from "./types.ts";

/**
 * What only CardFlip can say about a card, in words, for the public card pages
 * (SEO: unique content on every card page, Chris 10-02). Pure: every sentence is
 * built from the catalog facts, the headline price and the price series the page
 * already holds, through the same listing math the scanner uses. Nothing here
 * reads a database, and no number reaches a sentence unless the page's price
 * guard already let it through (the server passes only guard-checked points).
 */

// ---------------------------------------------------------------------------
// Is it worth selling? The listing math in one line.

export interface SellMath {
  /** The market price the sentence starts from (a Near Mint copy). */
  market: number;
  /** The eBay Suggested Price for that copy: the scanner's own number (askingPriceFor). */
  ask: number;
  /** eBay's estimated cut at that asking price. */
  fees: number;
  postage: number;
  /** What the seller keeps: ask − fees − postage. */
  net: number;
  /** "all": fees and postage ride on top (under $5); "part": a tapering share (to $10); "none": the market price stands. */
  covers: "all" | "part" | "none";
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function sellMath(market: number): SellMath {
  const ask = askingPriceFor(market, "Near Mint");
  const fees = cents(estimatedEbayFees(ask));
  const net = cents(ask - fees - POSTAGE_USD);
  const covers: SellMath["covers"] = coversAllCosts(market) ? "all" : coversCosts(market) ? "part" : "none";
  return { market, ask, fees, postage: POSTAGE_USD, net, covers };
}

export interface SellWords {
  /** The short answer: "Yes.", "Yes, just.", "Not on its own." */
  verdict: string;
  /** The math in plain English. */
  detail: string;
}

/** The "is it worth selling" line a card page prints under its market price. */
export function sellWords(name: string, market: number): SellWords | null {
  if (!(market > 0)) return null;
  const m = sellMath(market);
  const base = `A Near Mint copy of ${name} is worth about ${formatMoney(m.market)} today. The eBay Suggested Price is ${formatMoney(m.ask)}; after eBay's fees and ${formatMoney(m.postage)} postage you would keep about ${formatMoney(m.net)}.`;
  if (m.covers === "all") {
    return { verdict: "Not on its own.", detail: `${base} That is the card's value and nothing more: the asking price only carries the selling costs.` };
  }
  if (m.covers === "part") {
    return { verdict: "Yes, just.", detail: `${base} Part of the selling costs ride on top of the value at this price, so the sale clears a little under the card's full worth.` };
  }
  const share = Math.round((m.net / m.market) * 100);
  return { verdict: "Yes.", detail: `${base} That is ${share}% of the market price.` };
}

// ---------------------------------------------------------------------------
// The recorded range: high, low, and where today sits.

export interface HistoryRange {
  high: HistoryPoint;
  low: HistoryPoint;
  first: string;
  last: string;
  /** Calendar days from the first recorded day to the last, inclusive. */
  days: number;
}

/** The high and low of a series (oldest first, priced days only); null under two points. */
export function historyRange(points: readonly HistoryPoint[]): HistoryRange | null {
  if (points.length < 2) return null;
  let high = points[0];
  let low = points[0];
  for (const p of points) {
    if (p.price > high.price) high = p;
    if (p.price < low.price) low = p;
  }
  const first = points[0].day;
  const last = points[points.length - 1].day;
  return { high, low, first, last, days: dayIndex(first, last) + 1 };
}

/** "Across 93 days of daily prices, the high was $14.20 on Aug 3, 2026 and the low $9.80 on Sep 1, 2026. Today's price sits near the top of that range." */
export function rangeWords(range: HistoryRange, current: { price: number; day: string }): string {
  const span = `Across ${range.days.toLocaleString("en-US")} days of daily prices, the high was ${formatMoney(range.high.price)} on ${priceDayLabel(range.high.day)} and the low ${formatMoney(range.low.price)} on ${priceDayLabel(range.low.day)}.`;
  if (range.high.price === range.low.price) return `${span} The price has not moved in that time.`;
  if (current.price >= range.high.price) return `${span} Today's price is the highest CardFlip has recorded for this card.`;
  if (current.price <= range.low.price) return `${span} Today's price is the lowest CardFlip has recorded for this card.`;
  const pos = (current.price - range.low.price) / (range.high.price - range.low.price);
  const where = pos >= 0.75 ? "near the top of" : pos <= 0.25 ? "near the bottom of" : "in the middle of";
  return `${span} Today's price sits ${where} that range.`;
}

// ---------------------------------------------------------------------------
// The scan angle: what the scanner reads off this card.

const SCAN_MARKS: Record<GameId, string> = {
  pokemon: "the card number and the set symbol",
  mtg: "the collector number, the set code and the finish (a foil reads off the shine)",
  yugioh: "the set code and the rarity",
  onepiece: "the card code",
  lorcana: "the card number and the set",
};

/** One paragraph on scanning this exact card with CardFlip; the facts come from the catalog row. */
export function scanWords(f: Pick<CardFacts, "game" | "name" | "number" | "setName" | "tags">): string {
  const printing = f.tags.length ? ` (${f.tags.join(", ")})` : "";
  return (
    `Point your phone at ${f.name} in the CardFlip app and the scanner reads ${SCAN_MARKS[f.game]} off the photo, ` +
    `matches it to ${f.name} ${f.number} in ${f.setName}${printing}, and shows today's market price with an eBay Suggested Price for the copy in your hand. ` +
    `${SCANS.trial} scans are free to start.`
  );
}
