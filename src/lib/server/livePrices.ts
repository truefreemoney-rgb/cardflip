import "server-only";
import { db } from "@/lib/db";
import { askingPriceFor } from "@/lib/listing";
import { usdSeries } from "@/lib/server/priceHistory";
import { dayIndex } from "@/lib/priceSeries";

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
  /** Scan-time price: stored on create, else backfilled here from the series on the scan day. */
  scanned: number | null;
}

interface Row {
  id: string;
  price: number;
  catalog_card_id: string;
  condition: string;
  status: string;
  price_locked: number | null;
  scan_price: number | null;
  created_at: number;
}

/** Latest non-null value in a series. */
function lastOf(prices: (number | null)[]): number | null {
  for (let j = prices.length - 1; j >= 0; j--) if (prices[j] != null) return prices[j];
  return null;
}

/** The value on `day` (or the nearest earlier day; the first point when the
 *  series starts after `day`) — "what the market was when this was scanned". */
function onDay(series: { startDay: string; prices: (number | null)[] }, day: string): number | null {
  const i = Math.min(dayIndex(series.startDay, day), series.prices.length - 1);
  for (let j = i; j >= 0; j--) if (series.prices[j] != null) return series.prices[j];
  for (let j = Math.max(i, 0); j < series.prices.length; j++) if (series.prices[j] != null) return series.prices[j];
  return null;
}

export async function refreshLivePrices(userId: string, now = Date.now()): Promise<LivePrice[]> {
  const rows = (await db
    .prepare(
      `SELECT id, price, catalog_card_id, condition, status, price_locked, scan_price, created_at FROM cards
       WHERE user_id = ? AND status != 'sold' AND catalog_card_id IS NOT NULL
       ORDER BY created_at DESC LIMIT ${ROW_CAP}`,
    )
    .all(userId)) as unknown as Row[];
  if (rows.length === 0) return [];

  const series = await usdSeries([...new Set(rows.map((r) => r.catalog_card_id))]);
  const out: LivePrice[] = [];
  for (const row of rows) {
    const s = series.get(row.catalog_card_id);
    const market = s ? lastOf(s.prices) : null;
    if (!s || market == null || !(market > 0)) continue;
    const suggested = askingPriceFor(market, row.condition);
    // Scan-time price for rows from before scan_price existed: the series
    // value on the scan day through the same condition math, stored once.
    let scanned = row.scan_price;
    if (scanned == null) {
      const then = onDay(s, new Date(row.created_at).toISOString().slice(0, 10));
      const asking = then != null ? askingPriceFor(then, row.condition) : 0;
      if (asking > 0) {
        scanned = asking;
        await db.prepare("UPDATE cards SET scan_price = ? WHERE id = ? AND user_id = ?").run(scanned, row.id, userId);
      }
    }
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
      market: Math.round(market * 100) / 100,
      suggested,
      previous: row.price,
      applied,
      scanned,
    });
  }
  return out;
}
