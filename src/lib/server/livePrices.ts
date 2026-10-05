import "server-only";
import { db } from "@/lib/db";
import { askingPriceFor, marketForCondition } from "@/lib/listing";
import { heldSeries, preferredVariants, usdSeries } from "@/lib/server/priceHistory";
import { dayIndex } from "@/lib/priceSeries";
import { heldTrust } from "@/lib/server/priceTrustSite";
import type { PriceFlag, PriceStale } from "@/lib/priceFlag";

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
 *    ask; the reprice nudge stays the seller's decision;
 *  - a market the price guard (priceTrustSite) flags is reported with `flag`
 *    and no suggestion, no scan-price backfill. An unlocked draft whose stored
 *    price was written from a market (the seller never typed it) is blanked to
 *    0, applied: the screens then show the note and the seller types their own,
 *    the same as for a card scanned while flagged. A locked or listed price is
 *    the seller's and is never touched.
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
  /** The raw market on the day the row was added (the series value, no condition or fee math): the screens lead
   *  with the Market price since 10-02, so their "was $X" must be a market too, not the scan-time asking price. */
  marketThen: number | null;
  /** The price guard does not believe this market: the screens show the note, not a suggestion (suggested is 0). */
  flag?: PriceFlag;
  /** The market has not changed in 45+ days (10-02): shown and suggested as usual, with a note under it. */
  stale?: PriceStale;
}

interface Row {
  id: string;
  price: number;
  catalog_card_id: string;
  variant: string | null;
  game: string | null;
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
      `SELECT id, price, catalog_card_id, variant, game, condition, status, price_locked, scan_price, created_at FROM cards
       WHERE user_id = ? AND status != 'sold' AND catalog_card_id IS NOT NULL
       ORDER BY created_at DESC LIMIT ${ROW_CAP}`,
    )
    .all(userId)) as unknown as Row[];
  if (rows.length === 0) return [];

  const series = await usdSeries([...new Set(rows.map((r) => r.catalog_card_id))], preferredVariants(rows));
  // The price guard: a market the rule does not believe is neither suggested nor written (see below).
  const trust = await heldTrust(rows);
  const out: LivePrice[] = [];
  // Writes are collected and flushed as multi-row UPDATE ... FROM (VALUES)
  // statements below: per-row UPDATEs were up to 2 x ROW_CAP round trips on
  // every Inventory load, which on Turso is both slow and billed.
  const backfills: { id: string; scanned: number }[] = [];
  const moves: { id: string; price: number }[] = [];
  for (const row of rows) {
    const s = heldSeries(series, row);
    const market = s ? lastOf(s.prices) : null;
    if (!s || market == null || !(market > 0)) continue;
    const flag = trust.flag(row);
    if (flag) {
      // An unlocked draft price is by definition the last market suggestion (every typed price sets the lock), so
      // it cannot stay: it would show as the card's price and pre-fill the editor.
      const blank = row.status === "ready" && row.price_locked !== 1 && row.price > 0;
      if (blank) moves.push({ id: row.id, price: 0 });
      out.push({ cardId: row.id, market: marketForCondition(market, row.condition), suggested: 0, previous: row.price, applied: blank, scanned: row.scan_price, marketThen: null, flag });
      continue;
    }
    const suggested = askingPriceFor(market, row.condition);
    // Scan-time price for rows from before scan_price existed: the series
    // value on the scan day through the same condition math, stored once.
    let scanned = row.scan_price;
    const then = onDay(s, new Date(row.created_at).toISOString().slice(0, 10));
    if (scanned == null) {
      const asking = then != null ? askingPriceFor(then, row.condition) : 0;
      if (asking > 0) {
        scanned = asking;
        backfills.push({ id: row.id, scanned });
      }
    }
    if (!(suggested > 0)) continue;
    const moved = Math.abs(suggested - row.price) >= 0.005;
    const canApply = row.status === "ready" && row.price_locked !== 1;
    let applied = false;
    if (moved && canApply) {
      moves.push({ id: row.id, price: suggested });
      applied = true;
    }
    const stale = trust.stale(row);
    out.push({
      cardId: row.id,
      market: marketForCondition(market, row.condition),
      suggested,
      previous: row.price,
      applied,
      scanned,
      marketThen: then != null && then > 0 ? marketForCondition(then, row.condition) : null,
      ...(stale ? { stale } : {}),
    });
  }
  await batchUpdate(
    userId,
    "scan_price = v.column2",
    backfills.map((b) => [b.id, b.scanned]),
  );
  await batchUpdate(
    userId,
    "price = v.column2, updated_at = v.column3",
    moves.map((m) => [m.id, m.price, now]),
  );
  return out;
}

/**
 * Multi-row UPDATE ... FROM (VALUES ...) — same shape as
 * priceBulkWrite.updateMtgPriceColumns. SQLite names VALUES columns
 * column1..N (3.33+, true of node's SQLite and Turso); column1 is the card id.
 */
async function batchUpdate(userId: string, setClause: string, rows: (string | number)[][]): Promise<void> {
  if (rows.length === 0) return;
  const PER_STMT = 400;
  for (let i = 0; i < rows.length; i += PER_STMT) {
    const slice = rows.slice(i, i + PER_STMT);
    const values = slice.map((r) => `(${r.map(() => "?").join(", ")})`).join(", ");
    await db
      .prepare(
        `UPDATE cards SET ${setClause}
         FROM (VALUES ${values}) AS v
         WHERE cards.id = v.column1 AND cards.user_id = ?`,
      )
      .run(...slice.flat(), userId);
  }
}
