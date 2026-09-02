import "server-only";
import { db } from "@/lib/db";
import { latestUsdPrice } from "@/lib/server/priceHistory";

/**
 * The stale-listing half of BACKLOG's "auto-offers + reprice nudge": a card
 * listed a while ago at a price the market has since left behind. Computed
 * on request from our own price_series (same data the charts draw, refreshed
 * daily) — no external calls, so the collection page can ask on every load.
 *
 * Only rows that carry catalog_card_id qualify (scans after 09-01); a listing
 * has to be a week old before we second-guess its price, and the market has
 * to have moved ≥15% in either direction — down ("buyers see an overpriced
 * card") or up ("you're leaving money on the table").
 */

// TEMPORARILY 0 (09-02) so Chris can live-test the reprice PUT on a fresh
// listing — REVERT to 7 days after the test.
const MIN_AGE_MS = 0;
const MIN_DRIFT = 0.15;
const CHECK_CAP = 50;

export interface RepriceNudge {
  cardId: string;
  /** The latest market price we hold. */
  market: number;
  /** What it's listed at. */
  listedPrice: number;
  /** (market - listed) / listed, e.g. -0.18 = market is 18% below the ask. */
  drift: number;
}

export async function getRepriceNudges(userId: string, now = Date.now()): Promise<RepriceNudge[]> {
  const rows = (await db
    .prepare(
      `SELECT id, price, catalog_card_id FROM cards
       WHERE user_id = ? AND status = 'listed' AND catalog_card_id IS NOT NULL
         AND price > 0 AND listed_at IS NOT NULL AND listed_at < ?
       LIMIT ${CHECK_CAP}`,
    )
    .all(userId, now - MIN_AGE_MS)) as { id: string; price: number; catalog_card_id: string }[];

  const nudges: RepriceNudge[] = [];
  for (const row of rows) {
    const market = await latestUsdPrice(row.catalog_card_id);
    if (market == null || market <= 0) continue;
    const drift = (market - row.price) / row.price;
    if (Math.abs(drift) < MIN_DRIFT) continue;
    nudges.push({ cardId: row.id, market: Math.round(market * 100) / 100, listedPrice: row.price, drift });
  }
  return nudges;
}
