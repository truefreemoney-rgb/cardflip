import "server-only";
import { db } from "@/lib/db";
import { getUserAccessToken } from "@/lib/server/ebayAuth";
import { setCardSoldFees } from "@/lib/server/cards";
import { EbaySellError, ebayFetch } from "@/lib/server/ebaySell";

/**
 * Real net-after-fees: sold rows start with sold_fees NULL (the UI shows the
 * flat estimate from lib/fees.ts) and this sweep fills in the actual charge
 * from the Finances API's SALE transaction for the order the sales sync
 * stamped on the row (ebay_order_id / ebay_line_item_id).
 *
 * Fees can lag the sale by minutes to hours on eBay's side, so a row whose
 * order has no SALE transaction yet just stays NULL and is retried next pass.
 * Tokens issued before the sell.finances scope 403 here — that surfaces as
 * `skipped: "no_scope"`, never an error, and a reconnect fixes it.
 */

/** Finances lives on apiz.ebay.com, unlike the rest of the Sell APIs. */
const FINANCES_API = "https://apiz.ebay.com";
const THROTTLE_MS = 10 * 60 * 1000;
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Orders looked up per pass — each is one API call. */
const MAX_ORDERS_PER_PASS = 25;

export interface FeeSyncResult {
  /** Card ids whose sold_fees were filled in this pass. */
  updated: string[];
  skipped?: "not_connected" | "no_scope" | "nothing" | "throttled" | "error";
}

interface FinTransaction {
  transactionType?: string;
  orderId?: string;
  totalFeeAmount?: { value?: string };
  orderLineItems?: {
    lineItemId?: string;
    marketplaceFees?: { amount?: { value?: string } }[];
  }[];
}

function metaKey(userId: string): string {
  return `ebay_fees_sync:${userId}`;
}
async function lastSyncAt(userId: string): Promise<number> {
  const row = (await db
    .prepare("SELECT value FROM price_history_meta WHERE key = ?")
    .get(metaKey(userId))) as { value: string } | undefined;
  return Number(row?.value ?? 0);
}
async function recordSyncAt(userId: string, at: number): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO price_history_meta (key, value) VALUES (?, ?)")
    .run(metaKey(userId), String(at));
}

function lineFeeSum(fees: { amount?: { value?: string } }[] | undefined): number | null {
  if (!fees?.length) return null;
  let sum = 0;
  for (const fee of fees) sum += Number(fee.amount?.value ?? 0);
  return Number.isFinite(sum) ? sum : null;
}

export async function syncEbayFees(userId: string, force = false): Promise<FeeSyncResult> {
  const now = Date.now();
  const pending = (await db
    .prepare(
      `SELECT id, ebay_order_id, ebay_line_item_id FROM cards
       WHERE user_id = ? AND status = 'sold' AND sold_fees IS NULL
         AND ebay_order_id IS NOT NULL AND sold_at > ?
       ORDER BY sold_at DESC`,
    )
    .all(userId, now - WINDOW_MS)) as {
    id: string;
    ebay_order_id: string;
    ebay_line_item_id: string | null;
  }[];
  if (pending.length === 0) return { updated: [], skipped: "nothing" };

  if (!force && now - (await lastSyncAt(userId)) < THROTTLE_MS) {
    return { updated: [], skipped: "throttled" };
  }

  const token = await getUserAccessToken(userId);
  if (!token) return { updated: [], skipped: "not_connected" };

  // One Finances call per order; several cards can share an order (multi-line
  // checkout), so group first.
  const byOrder = new Map<string, typeof pending>();
  for (const row of pending) {
    const group = byOrder.get(row.ebay_order_id) ?? [];
    group.push(row);
    byOrder.set(row.ebay_order_id, group);
  }

  const updated: string[] = [];
  try {
    let looked = 0;
    for (const [orderId, rows] of byOrder) {
      if (looked >= MAX_ORDERS_PER_PASS) break;
      looked++;
      const data = (await ebayFetch(
        token,
        "GET",
        `/sell/finances/v1/transaction?filter=${encodeURIComponent(`orderId:{${orderId}}`)}&limit=50`,
        undefined,
        FINANCES_API,
      )) as { transactions?: FinTransaction[] } | null;
      const sale = data?.transactions?.find((t) => t.transactionType === "SALE");
      // No SALE transaction yet — eBay hasn't processed the payout; retry later.
      if (!sale) continue;

      for (const row of rows) {
        // Per-line fees when the breakdown names our line; the order total is
        // only safe when the order has a single line (multi-line totals would
        // overstate every card's share).
        const line = row.ebay_line_item_id
          ? sale.orderLineItems?.find((l) => l.lineItemId === row.ebay_line_item_id)
          : undefined;
        let fee = lineFeeSum(line?.marketplaceFees);
        if (fee == null && (sale.orderLineItems?.length ?? 0) <= 1) {
          const total = Number(sale.totalFeeAmount?.value ?? NaN);
          if (Number.isFinite(total)) fee = total;
        }
        if (fee == null || fee < 0) continue;
        await setCardSoldFees(row.id, userId, Math.round(fee * 100) / 100);
        updated.push(row.id);
      }
    }
  } catch (err) {
    if (err instanceof EbaySellError && err.status === 403) {
      // Token predates the finances scope — only a reconnect can widen it.
      return { updated, skipped: "no_scope" };
    }
    console.error("eBay fee sync failed:", err);
    return { updated, skipped: "error" };
  }

  await recordSyncAt(userId, now);
  return { updated };
}
