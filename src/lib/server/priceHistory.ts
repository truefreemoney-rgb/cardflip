import "server-only";
import { db } from "@/lib/db";
import type { GameId, PokemonCard } from "@/lib/types";
import { searchEnglishCardsLocal, enrichWithPricing, hasEnglishMirror } from "@/lib/server/enCards";
import { normalizeNumber } from "@/lib/cardNumber";
import { type HistorySeries, summarize } from "@/lib/priceHistoryStats";
import { decodePrices, encodePrices, setDay, toPoints, todayUtc } from "@/lib/priceSeries";

export { summarize, todayUtc };
export type { HistoryPoint, HistorySeries, HistoryStats } from "@/lib/priceHistoryStats";

/**
 * Our own price history — one compact row per card / variant / source (see lib/priceSeries.ts).
 *
 * eBay denied Marketplace Insights (2026-08-16), pokemontcg.io and Scryfall
 * only serve today's price, and there is no free historical Pokémon feed, so
 * the history is built here from every price we see:
 *   - Pokémon: recorded whenever a fresh pokemontcg.io lookup succeeds
 *     (`putCachedCards`), plus a lazy once-a-day sweep of every card sitting
 *     in someone's ledger or wishlist (`sweepPriceHistory`).
 *   - Magic: recorded by scripts/sync-mtg.mjs on the syncing PC and shipped
 *     inside seed/mtg-mirror.db.gz (Fly can't reach Scryfall); backfilled
 *     ~90 days from MTGJSON by scripts/backfill-mtgjson.mjs.
 * Days are UTC YYYY-MM-DD; a second price on the same day overwrites, so a
 * series is at most one point per day.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS price_series (
    card_id TEXT NOT NULL,
    game TEXT NOT NULL,
    variant TEXT NOT NULL,
    source TEXT NOT NULL,
    currency TEXT NOT NULL,
    start_day TEXT NOT NULL,
    prices TEXT NOT NULL,
    updated_day TEXT NOT NULL,
    PRIMARY KEY (card_id, variant, source)
  );
  CREATE TABLE IF NOT EXISTS price_history_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const selectRow = db.prepare(
  "SELECT start_day, prices FROM price_series WHERE card_id = ? AND variant = ? AND source = ?",
);
const upsertRow = db.prepare(
  `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

/** Write one day's price into a series (read-modify-write of one compact row). */
export function recordPoint(
  cardId: string,
  game: GameId,
  variant: string,
  source: string,
  currency: string,
  price: number,
  day = todayUtc(),
): void {
  const existing = selectRow.get(cardId, variant, source) as { start_day: string; prices: string } | undefined;
  const row = setDay(
    existing ? { startDay: existing.start_day, prices: decodePrices(existing.prices) } : null,
    day,
    price,
  );
  upsertRow.run(cardId, game, variant, source, currency, row.startDay, encodePrices(row.prices), day);
}

/** Record today's market price for every priced variant of each card. */
export function recordPrices(cards: PokemonCard[], day = todayUtc()): number {
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const card of cards) {
      const game: GameId = card.game ?? "pokemon";
      for (const p of card.prices) {
        if (p.market == null || !(p.market > 0)) continue;
        recordPoint(card.id, game, p.variant, p.source, p.currency, p.market, day);
        n++;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return n;
}

/** Every series we hold for a card, oldest point first. */
export function getPriceHistory(cardId: string): HistorySeries[] {
  const rows = db
    .prepare("SELECT variant, source, currency, start_day, prices FROM price_series WHERE card_id = ?")
    .all(cardId) as unknown as { variant: string; source: string; currency: string; start_day: string; prices: string }[];
  return rows.map((r) => ({
    variant: r.variant,
    source: r.source,
    currency: r.currency,
    points: toPoints({ startDay: r.start_day, prices: decodePrices(r.prices) }),
  }));
}

// ---------------------------------------------------------------------------
// Lazy daily sweep of the cards people actually hold.

const SWEEP_KEY = "last_sweep_at";
const SWEEP_EVERY_MS = 20 * 60 * 60 * 1000; // ~daily, tolerant of scale-to-zero gaps
const SWEEP_CAP = 150;
let sweeping = false;

function metaGet(key: string): string | null {
  const row = db.prepare("SELECT value FROM price_history_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
function metaSet(key: string, value: string) {
  db.prepare("INSERT OR REPLACE INTO price_history_meta (key, value) VALUES (?, ?)").run(key, value);
}

/** True if a sweep is due — cheap enough to ask on every /api/auth/me. */
export function sweepDue(now = Date.now()): boolean {
  if (sweeping) return false;
  const last = Number(metaGet(SWEEP_KEY) ?? 0);
  return now - last > SWEEP_EVERY_MS;
}

/**
 * Re-price every distinct Pokémon card in any ledger or wishlist, plus
 * anything price-checked in the last 30 days, so the cards people care about
 * get a daily point even when nobody re-scans them. Driven by
 * lib/server/dailyJobs.ts once a day; capped so it can't hammer
 * pokemontcg.io. Magic is refreshed wholesale from Scryfall's bulk file.
 */
export async function sweepPriceHistory(now = Date.now()): Promise<number> {
  if (sweeping || !hasEnglishMirror()) return 0;
  sweeping = true;
  metaSet(SWEEP_KEY, String(now));
  try {
    const rows = db
      .prepare(
        `SELECT card_name AS name, card_number AS number FROM cards WHERE game = 'pokemon'
         UNION
         SELECT COALESCE(english_name, card_name) AS name, card_number AS number FROM wishlist_items WHERE language = 'en'
         UNION
         SELECT card_name AS name, card_number AS number FROM price_checks
          WHERE language = 'en' AND checked_at > ?
         LIMIT ${SWEEP_CAP}`,
      )
      .all(now - 30 * 86_400_000) as unknown as { name: string; number: string }[];
    let recorded = 0;
    for (const row of rows) {
      const printed = row.number
        ? { number: normalizeNumber(row.number), setTotal: null, setCode: null, isSecretRare: false }
        : null;
      const local = searchEnglishCardsLocal(row.name, printed, 6);
      if (local.cards.length === 0) continue;
      // pokemontcg.io fails roughly half its requests (see enCards.ts) and
      // enrichWithPricing swallows that into "no prices" — so a card that
      // comes back unpriced gets one more try after a pause before we give
      // up on it for today.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const priced = await enrichWithPricing(local.cards, local.releaseDates);
          const n = recordPrices(priced);
          recorded += n;
          if (n > 0) break;
        } catch {
          // fall through to the retry
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (recorded > 0) console.info(`Price-history sweep: ${recorded} points for ${rows.length} held cards`);
    return recorded;
  } finally {
    sweeping = false;
  }
}
