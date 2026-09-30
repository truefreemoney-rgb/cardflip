import { db } from "@/lib/db";
import type { GameId } from "@/lib/types";

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

/**
 * Retry for the bulk statements (09-30): one Turso "SQLITE_IOERR: disk I/O
 * error" on statement 110 of 352 killed that day's Magic run, and 09-16 →
 * 09-23 a slow Turso week killed it every day, silently. Every statement
 * here is idempotent (INSERT OR REPLACE of whole rows, UPDATE to absolute
 * values, SELECTs), so a retry can never double-apply. Only transient
 * failures are retried: BLOCKED (plan limit), constraint and SQL errors
 * fail at once.
 */
const TRANSIENT_CODES = /^(SQLITE_IOERR|SQLITE_BUSY|SQLITE_LOCKED|HRANA_|STREAM_EXPIRED)/;
const TRANSIENT_TEXT = /disk I\/O error|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|connections limit exceeded|\b50[234]\b|\b429\b/i;

export function isTransientDbError(err: unknown): boolean {
  const code = typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "";
  if (/^(BLOCKED|SQLITE_CONSTRAINT|SQLITE_ERROR$)/.test(code)) return false;
  const text = err instanceof Error ? err.message : String(err);
  if (/BLOCKED/.test(text)) return false;
  return TRANSIENT_CODES.test(code) || TRANSIENT_TEXT.test(text);
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  { attempts = 5, baseMs = 500, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isTransientDbError(err)) throw err;
      // 0.5s, 1s, 2s, 4s (+ up to 25% jitter): ~8s at most before the last try.
      const wait = baseMs * 2 ** (i - 1);
      console.warn(`db: transient error, retry ${i}/${attempts - 1} in ${wait}ms:`, err instanceof Error ? err.message : err);
      await sleep(wait + Math.round(Math.random() * wait * 0.25));
    }
  }
}

export interface SeriesKeyed {
  startDay: string;
  prices: string;
  /** The day the row was last written (lets a re-run skip what today's run already wrote). */
  updatedDay: string;
}

/** All series rows for one game+source, keyed `${cardId}|${variant}`. */
export async function readSeriesMap(game: GameId, source: string): Promise<Map<string, SeriesKeyed>> {
  const map = new Map<string, SeriesKeyed>();
  // Paginate on rowid: the full family is 10s of MB and a single huge SELECT
  // risks the HTTP client's response limits.
  const PAGE = 20_000;
  let after = -1;
  for (;;) {
    const rows = (await withDbRetry(() =>
      db
        .prepare(
          `SELECT rowid AS rid, card_id, variant, start_day, prices, updated_day FROM price_series
           WHERE game = ? AND source = ? AND rowid > ? ORDER BY rowid LIMIT ${PAGE}`,
        )
        .all(game, source, after),
    )) as { rid: number; card_id: string; variant: string; start_day: string; prices: string; updated_day: string }[];
    for (const r of rows) map.set(`${r.card_id}|${r.variant}`, { startDay: r.start_day, prices: r.prices, updatedDay: r.updated_day });
    if (rows.length < PAGE) return map;
    after = Number(rows[rows.length - 1].rid);
  }
}

export interface SeriesUpsert {
  cardId: string;
  game: GameId;
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
    await withDbRetry(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
           VALUES ${values}`,
        )
        .run(...args),
    );
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
    await withDbRetry(() =>
      db
        .prepare(
          `UPDATE mtg_cards SET
             price_usd = v.column2, price_usd_foil = v.column3, price_usd_etched = v.column4,
             price_eur = v.column5, price_eur_foil = v.column6
           FROM (VALUES ${values}) AS v
           WHERE mtg_cards.id = v.column1`,
        )
        .run(...args),
    );
  }
}

/** Every mtg_cards row's current prices, keyed by id, paginated the same way (the refresh writes only rows whose prices changed). */
export async function readMtgCardPrices(): Promise<Map<string, MtgPriceRow>> {
  const out = new Map<string, MtgPriceRow>();
  const PAGE = 30_000;
  let after = -1;
  for (;;) {
    const rows = (await withDbRetry(() =>
      db
        .prepare(
          `SELECT rowid AS rid, id, price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil
           FROM mtg_cards WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`,
        )
        .all(after),
    )) as { rid: number; id: string; price_usd: number | null; price_usd_foil: number | null; price_usd_etched: number | null; price_eur: number | null; price_eur_foil: number | null }[];
    for (const r of rows) out.set(r.id, { id: r.id, usd: r.price_usd, foil: r.price_usd_foil, etched: r.price_usd_etched, eur: r.price_eur, eurFoil: r.price_eur_foil });
    if (rows.length < PAGE) return out;
    after = Number(rows[rows.length - 1].rid);
  }
}
