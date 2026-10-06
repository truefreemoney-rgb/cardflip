import "server-only";
import { db } from "@/lib/db";
import { tokenOrSkip } from "@/lib/server/ebayAuth";
import { recordCopiesSold, type CardRecord } from "@/lib/server/cards";
import { EbaySellError, ebayFetch } from "@/lib/server/ebaySell";
import { fxRateOnDay } from "@/lib/server/fx";
import { toUsd } from "@/lib/localPricing";

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
// After a failed pass, wait this long (not the full throttle) before asking eBay again.
const FAIL_BACKOFF_MS = 5 * 60 * 1000;

export interface SalesSyncResult {
  /** Cards flipped listed → sold in this pass. */
  sold: CardRecord[];
  /** Why the pass didn't run, when it didn't. */
  skipped?: "not_connected" | "no_scope" | "no_listings" | "throttled" | "error";
  /**
   * Order lines in another currency left alone this pass because no exchange
   * rate for the SALE DATE could be had; they are not recorded as applied, so
   * the next pass retries them. A sale is never converted with a guessed rate.
   */
  deferred?: number;
}

interface OrderLineItem {
  lineItemId?: string;
  legacyItemId?: string;
  sku?: string;
  quantity?: number;
  lineItemCost?: { value?: string; currency?: string };
  total?: { value?: string; currency?: string };
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
async function lastSyncAt(userId: string): Promise<number> {
  const row = (await db
    .prepare("SELECT value FROM price_history_meta WHERE key = ?")
    .get(metaKey(userId))) as { value: string } | undefined;
  return Number(row?.value ?? 0);
}
async function recordSyncAt(userId: string, at: number): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO price_history_meta (key, value) VALUES (?, ?)").run(
    metaKey(userId),
    String(at),
  );
}

async function releaseClaim(orderId: string, lineKey: string): Promise<void> {
  try {
    await db.prepare("DELETE FROM ebay_sold_lines WHERE order_id = ? AND line_key = ?").run(orderId, lineKey);
  } catch (err) {
    console.error("eBay sold-line claim release failed:", err);
  }
}

export async function syncEbaySales(userId: string, force = false): Promise<SalesSyncResult> {
  const listed = (await db
    .prepare(
      `SELECT id, ebay_sku, ebay_listing_id FROM cards
       WHERE user_id = ? AND status = 'listed'
         AND (ebay_listing_id IS NOT NULL OR ebay_sku IS NOT NULL)`,
    )
    .all(userId)) as { id: string; ebay_sku: string | null; ebay_listing_id: string | null }[];
  if (listed.length === 0) return { sold: [], skipped: "no_listings" };

  const now = Date.now();
  if (!force && now - (await lastSyncAt(userId)) < THROTTLE_MS) return { sold: [], skipped: "throttled" };

  const token = await tokenOrSkip(userId);
  if (token === "not_connected") return { sold: [], skipped: token };
  if (token === "error") {
    await recordSyncAt(userId, now - THROTTLE_MS + FAIL_BACKOFF_MS).catch(() => {});
    return { sold: [], skipped: token };
  }

  const byListingId = new Map(listed.filter((c) => c.ebay_listing_id).map((c) => [c.ebay_listing_id!, c.id]));
  const bySku = new Map(listed.filter((c) => c.ebay_sku).map((c) => [c.ebay_sku!, c.id]));

  const since = new Date(now - WINDOW_MS).toISOString();
  const sold: CardRecord[] = [];
  let deferred = 0;
  // One Frankfurter call per currency + day for this whole pass (a failure is remembered too).
  const fxMemo = new Map<string, number | null>();
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
          // The window re-reads old orders every pass; only apply each order
          // line to the ledger once (ebay_sold_lines) — a partially-sold
          // quantity>1 card stays 'listed' and would otherwise re-decrement.
          const lineKey = line.lineItemId ?? line.sku ?? line.legacyItemId ?? "";
          const applied = await db
            .prepare("SELECT 1 AS one FROM ebay_sold_lines WHERE order_id = ? AND line_key = ?")
            .get(order.orderId ?? "", lineKey);
          if (applied) continue;
          const paid = line.lineItemCost?.value != null ? line.lineItemCost : line.total;
          let soldPrice = Number(paid?.value ?? 0) || null;
          // A sale on another eBay site is in that site's currency: keep what the buyer paid, and book the USD
          // equivalent at the SALE DATE's rate (Frankfurter historical, cached). No rate = defer the line.
          const currency = (paid?.currency ?? "USD").trim().toUpperCase() || "USD";
          let soldLocal: { price: number; currency: string } | null = null;
          if (soldPrice != null && currency !== "USD") {
            // An unreadable order date has no sale-date rate: defer the line, never throw the pass.
            const rate = Number.isFinite(soldAt) ? await fxRateOnDay(currency, new Date(soldAt).toISOString().slice(0, 10), fxMemo) : null;
            if (rate == null) {
              deferred++;
              continue;
            }
            soldLocal = { price: soldPrice, currency };
            soldPrice = toUsd(soldPrice, rate);
          }
          // Claim the line FIRST (INSERT OR IGNORE): a concurrent pass that loses the race sees 0 changes
          // and skips, so a sale is never recorded twice. Released below if recording fails.
          const claim = await db
            .prepare("INSERT OR IGNORE INTO ebay_sold_lines (order_id, line_key, applied_at) VALUES (?, ?, ?)")
            .run(order.orderId ?? "", lineKey, now);
          if (!claim.changes) continue;
          // Quantity-aware: a partial sale splits off a sold row and leaves
          // the listing live with the rest, so the card stays matchable for
          // later orders in this same window.
          let result: Awaited<ReturnType<typeof recordCopiesSold>> = null;
          try {
            result = await recordCopiesSold(cardId, userId, line.quantity ?? 1, soldPrice, soldAt, {
              orderId: order.orderId ?? null,
              lineItemId: line.lineItemId ?? null,
            }, soldLocal);
          } catch (err) {
            await releaseClaim(order.orderId ?? "", lineKey);
            throw err;
          }
          if (!result) await releaseClaim(order.orderId ?? "", lineKey);
          if (result) {
            sold.push(result.sold);
            if (!result.remaining) {
              byListingId.delete(line.legacyItemId ?? "");
              bySku.delete(line.sku ?? "");
            }
          }
        }
      }
      // `next` is a full URL; ebayFetch wants the path+query part.
      path = data?.next ? data.next.replace(/^https?:\/\/[^/]+/, "") : null;
    }
  } catch (err) {
    // Failures back off too (same throttle key), so a broken token/scope doesn't re-hit eBay every page load.
    await recordSyncAt(userId, now - THROTTLE_MS + FAIL_BACKOFF_MS).catch(() => {});
    if (err instanceof EbaySellError && err.status === 403) {
      // Token predates the fulfillment scope — only a reconnect can widen it.
      return { sold, skipped: "no_scope" };
    }
    console.error("eBay sales sync failed:", err);
    return { sold, skipped: "error" };
  }

  await recordSyncAt(userId, now);
  return deferred ? { sold, deferred } : { sold };
}
