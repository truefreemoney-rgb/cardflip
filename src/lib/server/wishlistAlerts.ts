import "server-only";
import { db } from "@/lib/db";
import { isMailConfigured, sendWishlistAlertEmail, type WishlistAlertHit } from "@/lib/server/mail";
import { latestUsdPrices } from "@/lib/server/priceHistory";
import { sendPushToUser } from "@/lib/server/push";
import { tcgCatalogPrices } from "@/lib/server/tcgCards";
import { wishlistDipPush } from "@/lib/pushMessages";

/**
 * The daily check behind "email me when it dips to $X" on wishlist rows.
 *
 * Current price comes from our own price_series — the same data the charts
 * draw, refreshed daily by the crons — so this sweep costs no external
 * calls. Per series the latest USD point stands in for "market"; when a
 * card has several USD variants the reference is the one the wishlist saved
 * from ("normal" first, then holofoil, then whatever exists), not the
 * cheapest, so a holo target doesn't fire off the plain printing's price.
 *
 * One email per user per pass, listing every card that hit. A fired alert
 * stamps alerted_at and stays quiet until the seller changes the target
 * (setWishlistAlert clears the stamp).
 */

const CHECK_CAP = 200;

interface AlertRow {
  id: string;
  user_id: string;
  card_name: string;
  english_name: string | null;
  set_name: string;
  card_number: string;
  card_id: string;
  alert_price: number;
  email: string;
}

export interface AlertSweepResult {
  checked: number;
  sent: number;
}

export async function sweepWishlistAlerts(
  now = Date.now(),
  /** Test seam: the mailer and its configured check (scripts/test-ebay-sweeps.mjs). */
  deps: { send?: typeof sendWishlistAlertEmail; configured?: () => boolean; push?: typeof sendPushToUser } = {},
): Promise<AlertSweepResult> {
  if (!(deps.configured ?? isMailConfigured)()) return { checked: 0, sent: 0 };
  const send = deps.send ?? sendWishlistAlertEmail;
  const push = deps.push ?? sendPushToUser;
  const rows = (await db
    .prepare(
      `SELECT w.id, w.user_id, w.card_name, w.english_name, w.set_name, w.card_number,
              w.card_id, w.alert_price, u.email
       FROM wishlist_items w JOIN users u ON u.id = w.user_id
       WHERE w.alert_price IS NOT NULL AND w.alerted_at IS NULL AND w.card_id IS NOT NULL
       LIMIT ${CHECK_CAP}`,
    )
    .all()) as unknown as AlertRow[];

  // One batched series read for the whole sweep instead of one per row (up
  // to 200 round trips on Turso).
  const ids = [...new Set(rows.map((r) => r.card_id))];
  const prices = await latestUsdPrices(ids);
  // Lorcana / One Piece / Yu-Gi-Oh! have no price_series: their catalog price.
  const catalog = await tcgCatalogPrices(ids.filter((id) => !prices.has(id)));
  const hitsByUser = new Map<string, { email: string; userId: string; hits: (WishlistAlertHit & { rowId: string })[] }>();
  for (const row of rows) {
    const price = prices.get(row.card_id)?.price ?? catalog.get(row.card_id) ?? null;
    if (price == null || price > row.alert_price) continue;
    const entry = hitsByUser.get(row.user_id) ?? { email: row.email, userId: row.user_id, hits: [] };
    entry.hits.push({
      rowId: row.id,
      name: row.english_name || row.card_name,
      set: row.set_name,
      number: row.card_number,
      price,
      target: row.alert_price,
    });
    hitsByUser.set(row.user_id, entry);
  }

  let sent = 0;
  for (const { email, userId, hits } of hitsByUser.values()) {
    try {
      await send(email, hits);
      sent += hits.length;
      for (const hit of hits) {
        await db.prepare("UPDATE wishlist_items SET alerted_at = ? WHERE id = ?").run(now, hit.rowId);
      }
      // The phone banner rides along with the mail (Tier 2 #9); it never throws.
      await push(userId, wishlistDipPush(hits));
    } catch (err) {
      // Stamp nothing on a failed send — the next daily pass retries.
      console.error(`wishlist alert email to ${email} failed:`, err);
    }
  }
  return { checked: rows.length, sent };
}
