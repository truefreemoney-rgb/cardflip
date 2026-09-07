import "server-only";
import { db } from "@/lib/db";
import { askingPriceFor } from "@/lib/listing";
import { latestUsdPrices } from "@/lib/server/priceHistory";

/**
 * "Live" Inventory prices (Chris, 09-07: "it stays at the original value when
 * scanned but never updates after that"). cards.price was written once at
 * scan time; the daily crons only refresh the catalog's price_series. This
 * closes the loop on every Inventory load, from our own series — one batched
 * read, no external calls:
 *
 *  - every row with a catalog id gets today's market + the asking price it
 *    implies (condition multiplier, rounding, fee floor — askingPriceFor);
 *  - unlisted rows whose price the seller never touched (price_locked = 0)
 *    are REWRITTEN to that asking price, so the editor and the eBay draft
 *    start from today's number;
 *  - listed rows are never rewritten here — their price IS the live eBay
 *    ask; the reprice nudge stays the seller's decision.
 *
 * Rows scanned before catalog_card_id existed (09-01) are skipped.
 */

const ROW_CAP = 400;

export interface LivePrice {
  cardId: string;
  market: number;
  suggested: number;
  previous: number;
  applied: boolean;
}

interface Row {
  id: string;
  price: number;
  catalog_card_id: string;
  condition: string;
  status: string;
  price_locked: number | null;
}

export async function refreshLivePrices(userId: string, now = Date.now()): Promise<LivePrice[]> {
  const rows = (await db
    .prepare(
      `SELECT id, price, catalog_card_id, condition, status, price_locked FROM cards
       WHERE user_id = ? AND status != 'sold' AND catalog_card_id IS NOT NULL
       ORDER BY created_at DESC LIMIT ${ROW_CAP}`,
    )
    .all(userId)) as unknown as Row[];
  if (rows.length === 0) return [];

  const markets = await latestUsdPrices([...new Set(rows.map((r) => r.catalog_card_id))]);
  const out: LivePrice[] = [];
  for (const row of rows) {
    const hit = markets.get(row.catalog_card_id);
    if (!hit || !(hit.price > 0)) continue;
    const suggested = askingPriceFor(hit.price, row.condition);
    if (!(suggested > 0)) continue;
    const moved = Math.abs(suggested - row.price) >= 0.005;
    const canApply = row.status === "ready" && row.price_locked !== 1;
    let applied = false;
    if (moved && canApply) {
      await db
        .prepare("UPDATE cards SET price = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .run(suggested, now, row.id, userId);
      applied = true;
    }
    out.push({
      cardId: row.id,
      market: Math.round(hit.price * 100) / 100,
      suggested,
      previous: row.price,
      applied,
    });
  }
  return out;
}
