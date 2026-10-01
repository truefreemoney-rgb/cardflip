import "server-only";
import { db } from "@/lib/db";
import { latestUsdPrices } from "@/lib/server/priceHistory";
import { askingPriceFor } from "@/lib/listing";
import { heldTrust } from "@/lib/server/priceTrustSite";

/**
 * The stale-listing half of BACKLOG's "auto-offers + reprice nudge": a card
 * listed a while ago at a price the market has since left behind. Computed
 * on request from our own price_series (same data the charts draw, refreshed
 * daily) — no external calls, so the collection page can ask on every load.
 *
 * Only rows that carry catalog_card_id qualify (scans after 09-01); a listing
 * has to be a week old before we second-guess its price, and today's
 * suggested price has to sit ≥15% away in either direction — below ("buyers
 * see an overpriced card") or above ("you're leaving money on the table").
 * Under $10 that can fire without a market move: a card listed at raw market
 * before the 09-30 value + fees + postage rule nudges up to it.
 *
 * A LIVE listing on another eBay site (ebay_marketplace set, status listed: this query's only rows) is skipped: its ask is
 * in a local currency under that site's fee model, and the target here is the
 * US-fee USD figure, so a nudge would tell the seller to reprice it wrongly.
 *
 * A market the price guard flags (priceTrustSite) never nudges: a junk-high
 * price would otherwise tell the seller to reprice a LIVE eBay listing to it.
 */

const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_DRIFT = 0.15;
const CHECK_CAP = 50;

export interface RepriceNudge {
  cardId: string;
  /** The latest market price we hold. */
  market: number;
  /**
   * The price the nudge offers: today's market through the same math the
   * scanner uses (askingPriceFor — condition, and under $10 the card's value
   * with eBay fees + postage, or a tapering share of them, on top). Raw market would undercut every
   * cheap listing (a $1.30 card listed at $2.71 nudged to $1.30 nets 8¢).
   */
  target: number;
  /** What it's listed at. */
  listedPrice: number;
  /** (target - listed) / listed, e.g. -0.18 = the target is 18% below the ask. */
  drift: number;
}

export async function getRepriceNudges(userId: string, now = Date.now()): Promise<RepriceNudge[]> {
  const rows = (await db
    .prepare(
      `SELECT id, price, catalog_card_id, game, condition FROM cards
       WHERE user_id = ? AND status = 'listed' AND catalog_card_id IS NOT NULL
         AND price > 0 AND listed_at IS NOT NULL AND listed_at < ?
         AND ebay_marketplace IS NULL
       LIMIT ${CHECK_CAP}`,
    )
    .all(userId, now - MIN_AGE_MS)) as { id: string; price: number; catalog_card_id: string; game: string | null; condition: string }[];

  // One batched series read for every listed row — the per-row lookup was
  // up to 50 round trips on each collection load (Turso bills each one).
  const markets = await latestUsdPrices([...new Set(rows.map((r) => r.catalog_card_id))]);
  // Judged on the series the market comes from (the card's default, as latestUsdPrices reads it).
  const trust = await heldTrust(rows.map((r) => ({ catalog_card_id: r.catalog_card_id, variant: null, game: r.game })));
  const nudges: RepriceNudge[] = [];
  for (const row of rows) {
    const market = markets.get(row.catalog_card_id)?.price ?? null;
    if (market == null || market <= 0) continue;
    if (trust.flag({ catalog_card_id: row.catalog_card_id, variant: null, game: row.game })) continue;
    const target = askingPriceFor(market, row.condition);
    if (!(target > 0)) continue;
    const drift = (target - row.price) / row.price;
    if (Math.abs(drift) < MIN_DRIFT) continue;
    nudges.push({ cardId: row.id, market: Math.round(market * 100) / 100, target, listedPrice: row.price, drift });
  }
  return nudges;
}
