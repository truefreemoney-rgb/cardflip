/**
 * A market price the price guard (lib/server/priceTrust.ts) does not believe,
 * carried to the screens (site price guard, 09-30). Client-safe: the verdict is
 * computed on the server (lib/server/priceTrustSite.ts); this file holds only
 * the shape and the one sentence every surface shows, so they all say the same
 * words. `hard` = evidence the number is wrong; false = only unverified (thin,
 * round, young). The screens treat both the same: a collector cannot verify
 * either, and the page never presents the number as the card's value.
 */
export interface PriceFlag {
  hard: boolean;
  /** Short, for logs and tooltips ("cardmarket 20.4x", "flat 87d"). */
  reason: string;
}

/** The sentence a flagged card shows instead of its market price. */
export const PRICE_FLAG_NOTE = "This price looks off, check sold listings";

/**
 * A market price that is shown but STALE (10-02): the identical value for
 * `days` calendar days (>= 45) with no evidence it is wrong. The screens print
 * the number and add `priceStaleNote(days)` with the sold-listings link, in
 * place of hiding it: Charizard Plasma Storm 136 at $1,150 flat 128 days was a
 * fair Near Mint price the hide buried. Set at response time like `untrusted`,
 * never stored.
 */
export interface PriceStale {
  days: number;
}

/** "Market hasn't updated this in 4 months" (weeks under two months). No full stop. */
export function priceStaleNote(days: number): string {
  if (days >= 60) {
    const months = Math.round(days / 30);
    return `Market hasn't updated this in ${months} month${months === 1 ? "" : "s"}`;
  }
  const weeks = Math.max(1, Math.round(days / 7));
  return `Market hasn't updated this in ${weeks} week${weeks === 1 ? "" : "s"}`;
}

/** The count line every total shows when cards were left out of it: "2 cards left out, their prices look off". No full stop. */
export const priceFlagLeftOut = (n: number) => `${n} ${n === 1 ? "card" : "cards"} left out, ${n === 1 ? "its price looks" : "their prices look"} off`;

/** The way forward that goes after the count on the reports (Insights, the weekly mail), which have no per-card note. */
export const PRICE_FLAG_LEFT_OUT_NEXT = "Check sold listings from your Collection.";

/** The link that goes with it where a page has an eBay sold-listings search. */
export const PRICE_FLAG_LINK = "View Sold on eBay";
