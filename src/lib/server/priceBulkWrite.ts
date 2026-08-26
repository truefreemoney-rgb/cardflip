import { db } from "@/lib/db";

/**
 * Bulk read/write helpers for the daily price refreshers.
 *
 * On Fly the database was a local file, so per-row SELECT+UPSERT loops were
 * effectively free. On Turso every statement is an HTTP round trip — the
 * TCGCSV pass alone was ~60k round trips and blew straight through Vercel's
 * 300s function limit (observed 08-26). The refreshers now read a whole
 * series family into memory once, compute the new encoded rows locally, and
 * write them back as multi-row statements — a few hundred round trips total.
 * Each multi-row INSERT is a single atomic statement, which is all the
 * atomicity the old short per-group transactions were buying.
 */

export interface SeriesKeyed {
  startDay: string;
  prices: string;
}

/** All series rows for one game+source, keyed `${cardId}|${variant}`. */
export async function readSeriesMap(game: "pokemon" | "mtg", source: string): Promise<Map<string, SeriesKeyed>> {
  const map = new Map<string, SeriesKeyed>();
  // Paginate on rowid: the full family is 10s of MB and a single huge SELECT
  // risks the HTTP client's response limits.
  const PAGE = 20_000;
  let after = -1;
  for (;;) {
    const rows = (await db
      .prepare(
        `SELECT rowid AS rid, card_id, variant, start_day, prices FROM price_series
         WHERE game = ? AND source = ? AND rowid > ? ORDER BY rowid LIMIT ${PAGE}`,
      )
      .all(game, source, after)) as { rid: number; card_id: string; variant: string; start_day: string; prices: string }[];
    for (const r of rows) map.set(`${r.card_id}|${r.variant}`, { startDay: r.start_day, prices: r.prices });
    if (rows.length < PAGE) return map;
    after = Number(rows[rows.length - 1].rid);
  }
}

export interface SeriesUpsert {
  cardId: string;
  game: "pokemon" | "mtg";
  variant: string;
  source: string;
  currency: string;
  startDay: string;
  prices: string;
  updatedDay: string;
}

/** Multi-row INSERT OR REPLACE, ~400 rows (3.2k params) per statement. */
export async function upsertSeriesRows(rows: SeriesUpsert[]): Promise<void> {
  const PER_STMT = 400;
  for (let i = 0; i < rows.length; i += PER_STMT) {
    const slice = rows.slice(i, i + PER_STMT);
    const values = slice.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const args: (string | number)[] = [];
    for (const r of slice) args.push(r.cardId, r.game, r.variant, r.source, r.currency, r.startDay, r.prices, r.updatedDay);
    await db
      .prepare(
        `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
         VALUES ${values}`,
      )
      .run(...args);
  }
}

export interface MtgPriceRow {
  id: string;
  usd: number | null;
  foil: number | null;
  etched: number | null;
  eur: number | null;
  eurFoil: number | null;
}

/**
 * Batch mirror-price update via UPDATE ... FROM (VALUES ...). SQLite names a
 * VALUES table's columns column1..columnN; needs SQLite 3.33+, true of both
 * node's bundled SQLite and Turso. Callers pre-filter to ids that exist in
 * mtg_cards, so every row lands.
 */
export async function updateMtgPriceColumns(rows: MtgPriceRow[]): Promise<void> {
  const PER_STMT = 400;
  for (let i = 0; i < rows.length; i += PER_STMT) {
    const slice = rows.slice(i, i + PER_STMT);
    const values = slice.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const args: (string | number | null)[] = [];
    for (const r of slice) args.push(r.id, r.usd, r.foil, r.etched, r.eur, r.eurFoil);
    await db
      .prepare(
        `UPDATE mtg_cards SET
           price_usd = v.column2, price_usd_foil = v.column3, price_usd_etched = v.column4,
           price_eur = v.column5, price_eur_foil = v.column6
         FROM (VALUES ${values}) AS v
         WHERE mtg_cards.id = v.column1`,
      )
      .run(...args);
  }
}

/** Every id in mtg_cards, paginated the same way. */
export async function readMtgCardIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const PAGE = 30_000;
  let after = -1;
  for (;;) {
    const rows = (await db
      .prepare(`SELECT rowid AS rid, id FROM mtg_cards WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`)
      .all(after)) as { rid: number; id: string }[];
    for (const r of rows) ids.add(r.id);
    if (rows.length < PAGE) return ids;
    after = Number(rows[rows.length - 1].rid);
  }
}
