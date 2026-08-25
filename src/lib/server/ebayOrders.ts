import "server-only";
import { db } from "@/lib/db";
import { getUserAccessToken } from "@/lib/server/ebayAuth";
import { updateCard, type CardRecord } from "@/lib/server/cards";
import { EbaySellError, ebayFetch } from "@/lib/server/ebaySell";

/**
 * Closing the loop after "publish": a card that sells on eBay used to sit in
 * the ledger as "listed" until the seller pressed a manual button. This reads
 * the seller's recent orders (Fulfillment API, read-only scope) and flips
 * matching listed cards to sold with the real sale price and date.
 *
 * Matching is by what eBay echoes back about each line item: `legacyItemId`
 * (the live listing id we stored at publish) first, `sku` (our card id,
 * see skuForCard) as the fallback for listings finished on eBay's own form.
 *
 * Tokens issued before this scope existed will 403 — that surfaces as
 * `skipped: "no_scope"` so the UI can ask for a reconnect instead of erroring.
 */

const THROTTLE_MS = 10 * 60 * 1000;
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 3;

export interface SalesSyncResult {
  /** Cards flipped listed → sold in this pass. */
  sold: CardRecord[];
  /** Why the pass didn't run, when it didn't. */
  skipped?: "not_connected" | "no_scope" | "no_listings" | "throttled" | "error";
}

interface OrderLineItem {
  legacyItemId?: string;
  sku?: string;
  lineItemCost?: { value?: string };
  total?: { value?: string };
}

interface EbayOrder {
  orderId?: string;
  creationDate?: string;
  orderPaymentStatus?: string;
  cancelStatus?: { cancelState?: string };
  lineItems?: OrderLineItem[];
}

function metaKey(userId: string): string {
  return `ebay_sales_sync:${userId}`;
}
function lastSyncAt(userId: string): number {
  const row = db
    .prepare("SELECT value FROM price_history_meta WHERE key = ?")
    .get(metaKey(userId)) as { value: string } | undefined;
  return Number(row?.value ?? 0);
}
function recordSyncAt(userId: string, at: number) {
  db.prepare("INSERT OR REPLACE INTO price_history_meta (key, value) VALUES (?, ?)").run(
    metaKey(userId),
    String(at),
  );
}

export async function syncEbaySales(userId: string, force = false): Promise<SalesSyncResult> {
  const listed = db
    .prepare(
      `SELECT id, ebay_sku, ebay_listing_id FROM cards
       WHERE user_id = ? AND status = 'listed'
         AND (ebay_listing_id IS NOT NULL OR ebay_sku IS NOT NULL)`,
    )
    .all(userId) as { id: string; ebay_sku: string | null; ebay_listing_id: string | null }[];
  if (listed.length === 0) return { sold: [], skipped: "no_listings" };

  const now = Date.now();
  if (!force && now - lastSyncAt(userId) < THROTTLE_MS) return { sold: [], skipped: "throttled" };

  const token = await getUserAccessToken(userId);
  if (!token) return { sold: [], skipped: "not_connected" };

  const byListingId = new Map(listed.filter((c) => c.ebay_listing_id).map((c) => [c.ebay_listing_id!, c.id]));
  const bySku = new Map(listed.filter((c) => c.ebay_sku).map((c) => [c.ebay_sku!, c.id]));

  const since = new Date(now - WINDOW_MS).toISOString();
  const sold: CardRecord[] = [];
  try {
    let path: string | null =
      `/sell/fulfillment/v1/order?filter=${encodeURIComponent(`creationdate:[${since}..]`)}&limit=200`;
    for (let page = 0; path && page < MAX_PAGES; page++) {
      const data = (await ebayFetch(token, "GET", path)) as {
        orders?: EbayOrder[];
        next?: string;
      } | null;
      for (const order of data?.orders ?? []) {
        if (order.orderPaymentStatus === "FAILED") continue;
        if (order.cancelStatus?.cancelState === "CANCELED") continue;
        const soldAt = order.creationDate ? Date.parse(order.creationDate) : now;
        for (const line of order.lineItems ?? []) {
          const cardId =
            (line.legacyItemId && byListingId.get(line.legacyItemId)) ||
            (line.sku && bySku.get(line.sku)) ||
            null;
          if (!cardId) continue;
          const soldPrice = Number(line.lineItemCost?.value ?? line.total?.value ?? 0) || null;
          const updated = updateCard(cardId, userId, { status: "sold", soldPrice, soldAt });
          if (updated) {
            sold.push(updated);
            byListingId.delete(line.legacyItemId ?? "");
            bySku.delete(line.sku ?? "");
          }
        }
      }
      // `next` is a full URL; ebayFetch wants the path+query part.
      path = data?.next ? data.next.replace(/^https?:\/\/[^/]+/, "") : null;
    }
  } catch (err) {
    if (err instanceof EbaySellError && err.status === 403) {
      // Token predates the fulfillment scope — only a reconnect can widen it.
      return { sold, skipped: "no_scope" };
    }
    console.error("eBay sales sync failed:", err);
    return { sold, skipped: "error" };
  }

  recordSyncAt(userId, now);
  return { sold };
}
