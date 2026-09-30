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

/** The link that goes with it where a page has an eBay sold-listings search. */
export const PRICE_FLAG_LINK = "View Sold on eBay";
