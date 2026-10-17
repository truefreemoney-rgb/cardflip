import "server-only";
import { db } from "@/lib/db";

/**
 * Per-account row caps (#26, 10-16 audit: no cap on cards, watchlist or price checks). Far above real use (prod 10-17:
 * the biggest account had 45 cards, 6 watched, 14 lookups): they stop a runaway script or a hostile account from
 * filling the database (Turso bills rows), not a seller. Sold cards are the sales record and never count.
 */
export const ROW_CAPS = { cards: 25_000, wishlist: 1_000, priceChecks: 500 } as const;

export const CARDS_CAP_MESSAGE = `Your Inventory is full (${ROW_CAPS.cards.toLocaleString("en-US")} cards). Remove some cards to add more.`;
export const WISHLIST_CAP_MESSAGE = `Your watchlist is full (${ROW_CAPS.wishlist.toLocaleString("en-US")} cards). Remove some to watch more.`;

/** True when the account already holds `cap` rows. Reads at most `cap` index entries; a failed read never blocks. */
async function atCap(sql: string, userId: string, cap: number): Promise<boolean> {
  try {
    return Boolean(await db.prepare(`${sql} LIMIT 1 OFFSET ?`).get(userId, cap - 1));
  } catch {
    return false;
  }
}

export function cardsFull(userId: string, cap: number = ROW_CAPS.cards): Promise<boolean> {
  return atCap("SELECT 1 FROM cards WHERE user_id = ? AND status <> 'sold'", userId, cap);
}

export function wishlistFull(userId: string, cap: number = ROW_CAPS.wishlist): Promise<boolean> {
  return atCap("SELECT 1 FROM wishlist_items WHERE user_id = ?", userId, cap);
}

/** Lookup history keeps the newest `keep` rows; older ones go. A history, so a new lookup is never refused. Never throws. */
export async function trimPriceChecks(userId: string, keep: number = ROW_CAPS.priceChecks): Promise<void> {
  await db
    .prepare(
      `DELETE FROM price_checks WHERE user_id = ? AND checked_at < (
         SELECT checked_at FROM price_checks WHERE user_id = ? ORDER BY checked_at DESC LIMIT 1 OFFSET ?)`,
    )
    .run(userId, userId, keep - 1)
    .catch(() => {});
}
