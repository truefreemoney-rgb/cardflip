import { POSTAGE_USD, coversAllCosts, coversCosts, estimatedEbayFees } from "./fees.ts";
import { CONDITIONS, CONDITION_MULTIPLIER, askingPriceFor, formatMoney } from "./listing.ts";
import { priceDayLabel, type CardFacts } from "./cardPages.ts";
import { SCANS } from "./pricing.ts";
import { dayIndex, type HistoryPoint } from "./priceSeries.ts";
import { etDate } from "./time.ts";
import type { Condition, GameId } from "./types.ts";

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
  /** The short answer: always "Yes." (Chris 10-02: no "Not on its own" / "Yes, just" for cheap cards). */
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
    return { verdict: "Yes.", detail: `${base} The asking price carries the selling costs, so the sale returns the card's full value.` };
  }
  if (m.covers === "part") {
    return { verdict: "Yes.", detail: `${base} Part of the selling costs ride on top of the value at this price.` };
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
// The condition ladder: the eBay Suggested Price for each condition (SEO 10-02).

export interface ConditionStep {
  condition: Condition;
  /** askingPriceFor(market, condition): the scanner's own number for that copy. */
  ask: number;
}

/** Near Mint down to Heavily Played, each with its asking price (Damaged is not a price anyone searches for). Empty without a market price. */
export function conditionLadder(market: number): ConditionStep[] {
  if (!(market > 0)) return [];
  return CONDITIONS.filter((c) => c !== "Damaged").map((condition) => ({ condition, ask: askingPriceFor(market, condition) }));
}

// ---------------------------------------------------------------------------
// Rank in the set: where this card sits among the set's priced cards (SEO 10-02).

export interface SetStanding {
  /** 1 = the set's most valuable priced card. */
  rank: number;
  /** Cards of the set with a price the guard believes. */
  priced: number;
  /** The median of those prices. */
  median: number;
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** "Charizard is the most valuable card in Base Set, 47x the set's median price of $20.10." Null when the set has one priced card (nothing to compare). */
export function rankWords(name: string, setName: string, price: number, s: SetStanding): string | null {
  if (s.priced < 2 || !(s.median > 0)) return null;
  const of = `of ${s.priced.toLocaleString("en-US")} priced cards in ${setName}`;
  const place =
    s.rank === 1 ? `${name} is the most valuable ${of}` : s.rank <= 10 ? `${name} is the ${ordinal(s.rank)} most valuable ${of}` : `${name} ranks ${ordinal(s.rank)} ${of}`;
  const ratio = price / s.median;
  const vs =
    ratio >= 1.95
      ? `${Math.round(ratio)}x the set's median price of ${formatMoney(s.median)}`
      : ratio >= 1.05
        ? `above the set's median price of ${formatMoney(s.median)}`
        : ratio > 0.95
          ? `right at the set's median price of ${formatMoney(s.median)}`
          : `below the set's median price of ${formatMoney(s.median)}`;
  return `${place}, ${vs}.`;
}

// ---------------------------------------------------------------------------
// The scan angle: what the scanner reads off this card.

const SCAN_MARKS: Record<GameId, string> = {
  pokemon: "the card number and set symbol",
  mtg: "the collector number, set code and finish",
  yugioh: "the set code and rarity",
  onepiece: "the card code",
  lorcana: "the card number and set",
};

/** The heading over scanWords: "Have a Charizard?" */
export const scanHeading = (name: string): string => `Have a ${name}?`;

/** One paragraph on scanning this exact card with CardFlip (reworded 10-02, Chris hated "Point your phone at…"); the facts come from the catalog row. */
export function scanWords(f: Pick<CardFacts, "game" | "name" | "number" | "setName" | "tags">): string {
  const printing = f.tags.length ? ` (${f.tags.join(", ")})` : "";
  return (
    `Scan it with CardFlip and get today's market price and an eBay Suggested Price for your copy in seconds. ` +
    `The scanner reads ${SCAN_MARKS[f.game]} off the card, so it picks out ${f.name} ${f.number}, ${f.setName}${printing}, from every other printing. ` +
    `Your first ${SCANS.trial} scans are free.`
  );
}

// ---------------------------------------------------------------------------
// Common questions (10-17, task #58): the questions people type into search, answered from the page's own numbers.

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * Up to three short questions and answers for a card page, only from facts the page already holds: the guarded headline
 * price, the condition values (the scanner's multipliers, from $10 up), the other printings' guarded prices
 * and the release date. Nothing is asked that the page cannot answer; no price, no "worth" question.
 */
export function cardFaq(
  f: Pick<CardFacts, "name" | "number" | "setName" | "release">,
  headline: { price: number; label: string; day: string } | null,
  printings: { name: string; setName: string; price: number | null }[],
  today: string,
): FaqItem[] {
  const out: FaqItem[] = [];
  const who = [f.name, f.number].filter(Boolean).join(" ");
  if (headline && headline.price > 0) {
    let a = `${who} from ${f.setName} is worth about ${formatMoney(headline.price)} (${headline.label}, Near Mint) as of ${priceDayLabel(headline.day)}.`;
    if (headline.price >= 10) {
      // The value by condition (the scanner's multipliers), not askingPriceFor: that is an eBay ask with the fees on top.
      const ask = (c: Condition) => Math.round(headline.price * CONDITION_MULTIPLIER[c] * 100) / 100;
      a += ` A Lightly Played copy is about ${formatMoney(ask("Lightly Played"))}, a Heavily Played one about ${formatMoney(ask("Heavily Played"))}.`;
    }
    out.push({ q: `How much is ${who} worth?`, a });
    const priced = printings.filter((p) => p.price != null && p.price > 0);
    if (priced.length > 0) {
      const top = priced[0];
      a =
        headline.price >= (top.price as number)
          ? `This one. At ${formatMoney(headline.price)}, the ${f.setName} printing is worth more than the other ${priced.length} ${f.name} ${priced.length === 1 ? "card" : "cards"} with a price.`
          : `${top.name} from ${top.setName}, at ${formatMoney(top.price as number)}. It is the most valuable of ${priced.length + 1} ${f.name} cards with a price.`;
      out.push({ q: `What is the most valuable ${f.name} card?`, a });
    }
  }
  if (f.release && f.release <= today) {
    const d = etDate(`${f.release}T12:00:00Z`, "", { month: "long", day: "numeric", year: "numeric" });
    out.push({ q: `When did ${f.setName} come out?`, a: `${f.setName} was released on ${d}.` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Set summary strip (10-17, task #62): the set at a glance, from the set page's own guarded list.

export interface SetSummary {
  /** Cards with a sure price (not flagged, unverified or stale). */
  priced: number;
  /** The median sure price: "a typical card", which one chase card cannot drag up the way an average is. */
  typical: number | null;
  top: { name: string; key: string; price: number } | null;
  /** The set's value change over 7 / 30 days: the same cards' sum now against then (cards with both readings only), or null. */
  change7: number | null;
  change30: number | null;
}

type SummaryCard = { key: string; name: string; price: number | null; flagged: boolean; unverified: boolean; stale?: boolean; was7?: number | null; was30?: number | null };

export function setSummary(cards: SummaryCard[]): SetSummary {
  const sure = cards.filter((c) => c.price != null && c.price > 0 && !c.flagged && !c.unverified && !c.stale);
  const prices = sure.map((c) => c.price as number).sort((a, b) => a - b);
  const mid = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null;
  const top = sure.reduce<SummaryCard | null>((m, c) => (!m || (c.price as number) > (m.price as number) ? c : m), null);
  const change = (pick: (c: SummaryCard) => number | null | undefined) => {
    let now = 0;
    let then = 0;
    let n = 0;
    for (const c of sure) {
      const was = pick(c);
      if (was == null || !(was > 0)) continue;
      now += c.price as number;
      then += was;
      n++;
    }
    // Fewer than 5 cards with history says nothing about a set.
    return n >= 5 && then > 0 ? now / then - 1 : null;
  };
  return { priced: sure.length, typical: mid, top: top ? { name: top.name, key: top.key, price: top.price as number } : null, change7: change((c) => c.was7), change30: change((c) => c.was30) };
}
