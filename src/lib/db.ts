import { createClient, type Client, type InValue, type Transaction } from "@libsql/client";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { decodePrices, encodePrices, setDay, toPoints } from "@/lib/priceSeries";

/**
 * A single SQL database backs the whole app, behind an async adapter
 * (vercel-migration): with TURSO_DATABASE_URL set it speaks to Turso
 * (libSQL over HTTP — the Vercel deployment), otherwise it opens the same
 * local file as always (`data/cardflip.db` — dev, tests, and the Fly
 * machine). Same SQLite dialect either way; only the transport differs.
 *
 * The adapter keeps node:sqlite's `db.prepare(sql).get/all/run` shape so
 * the 100+ call sites only gained an `await`. `run()` returns `{ changes,
 * lastInsertRowid }` like before. Multi-statement writes that used raw
 * BEGIN/COMMIT now go through `db.transaction()` — the HTTP client
 * rejects bare BEGIN.
 *
 * Remote caveat (verify at cutover): PRAGMA foreign_keys is per-connection
 * and not guaranteed sticky over HTTP, so ON DELETE CASCADE must be
 * re-verified against Turso; the delete paths may need explicit child
 * deletes.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "cardflip.db");

const TURSO_URL = process.env.TURSO_DATABASE_URL;
/** True when queries go to Turso rather than the local file. */
export const dbIsRemote = Boolean(TURSO_URL);

if (!dbIsRemote) fs.mkdirSync(DATA_DIR, { recursive: true });

/** libsql wants a URL; Windows paths need forward slashes. */
function fileUrl(p: string): string {
  return `file:${p.replace(/\\/g, "/")}`;
}

// A dev-mode hot-reload can re-run this module; keep one client per process.
const globalForDb = globalThis as unknown as {
  __cardflipClient?: Client;
  __cardflipReady?: Promise<void>;
};

const client =
  globalForDb.__cardflipClient ??
  createClient(
    dbIsRemote
      ? { url: TURSO_URL!, authToken: process.env.TURSO_AUTH_TOKEN }
      : { url: fileUrl(DB_PATH) },
  );
if (!globalForDb.__cardflipClient) {
  globalForDb.__cardflipClient = client;
  // The libsql native binding asserts (UV_HANDLE_CLOSING, win/async.c) when a
  // Windows process exits with the client still open — confirmed directly:
  // the test scripts crashed at exit until this close landed. Harmless for
  // the long-running server; essential for short-lived scripts.
  process.once("beforeExit", () => {
    try {
      client.close();
    } catch {
      // Already closed.
    }
  });
}

// Next's build process imports route modules from several parallel workers —
// each evaluates this module and races to create the schema on the same fresh
// file (confirmed directly: build failed with "database is locked" once
// enough routes existed to collide). WAL mode alone doesn't prevent that
// during concurrent DDL; a busy timeout makes SQLite retry instead of
// failing immediately. File mode only — Turso's server owns its pragmas.
const FILE_PRAGMAS = `
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    ebay_connected INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    -- Two-step verification (TOTP, totp.ts): secret set at setup, enabled_at
    -- stamped once the first code is confirmed. Secret without enabled_at =
    -- abandoned setup, ignored at login.
    totp_secret TEXT,
    totp_enabled_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_name TEXT NOT NULL,
    set_name TEXT NOT NULL,
    card_number TEXT NOT NULL,
    image_url TEXT NOT NULL,
    condition TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ready', 'listed', 'sold')),
    price REAL NOT NULL DEFAULT 0,
    listed_at INTEGER,
    sold_price REAL,
    sold_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- Mirror of TCGdex's Japanese card names/sets. TCGdex's own name-search
  -- endpoint doesn't work for the "ja" locale (verified directly — even an
  -- exact name returns no results), so OCR matches are looked up against
  -- this local copy instead. Populated by scripts/sync-cjk-cards.mjs.
  CREATE TABLE IF NOT EXISTS jp_cards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    set_id TEXT NOT NULL,
    set_name TEXT NOT NULL,
    local_id TEXT NOT NULL,
    synced_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jp_cards_name ON jp_cards(name);

  -- Same idea as jp_cards, mirroring TCGdex's "zh-tw" (Traditional Chinese)
  -- locale — its name-search is equally broken there. Populated by
  -- scripts/sync-cjk-cards.mjs.
  CREATE TABLE IF NOT EXISTS zh_cards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    set_id TEXT NOT NULL,
    set_name TEXT NOT NULL,
    local_id TEXT NOT NULL,
    synced_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_zh_cards_name ON zh_cards(name);

  -- A growing log of every card looked up on the Price Check page. One row
  -- per lookup (not per price source) so the history stays readable as a
  -- simple table; the full source-by-source comparison is kept alongside as
  -- JSON in case it's needed later.
  CREATE TABLE IF NOT EXISTS price_checks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_name TEXT NOT NULL,
    set_name TEXT NOT NULL,
    card_number TEXT NOT NULL,
    language TEXT NOT NULL,
    representative_price REAL,
    prices_json TEXT NOT NULL,
    checked_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_price_checks_checked_at ON price_checks(checked_at);

  -- English species name by National Pokédex number, so a Japanese/Chinese
  -- card name has a readable overlay ("ピカチュウ" -> "Pikachu") without a
  -- live translation call. Populated by scripts/sync-species-names.mjs.
  CREATE TABLE IF NOT EXISTS species_names (
    dex_id INTEGER PRIMARY KEY,
    name_en TEXT NOT NULL
  );

  -- Cards a user has saved for later — from either the scanner or the Price
  -- Check search — distinct from "cards" (the sell pipeline: ready/listed/
  -- sold). A wishlist entry has no status to progress through, just a card
  -- someone wants to remember.
  CREATE TABLE IF NOT EXISTS wishlist_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_name TEXT NOT NULL,
    english_name TEXT,
    set_name TEXT NOT NULL,
    card_number TEXT NOT NULL,
    language TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    price REAL,
    added_at INTEGER NOT NULL,
    UNIQUE (user_id, card_name, set_name, card_number)
  );

  CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist_items(user_id);

  -- Mirror of TCGdex's English catalogue, so identifying a card never depends
  -- on pokemontcg.io being up. Populated by scripts/sync-cards.mjs.
  -- set_card_count_official is the denominator a card prints ("25/102" -> 102)
  -- and set_card_count_total includes the secret rares numbered above it, so a
  -- local_id exceeding the official count identifies one. Both are nullable:
  -- the columns arrived after the first sync, and a mirror synced before that
  -- still identifies cards, just without the set-total tiebreak. See
  -- src/lib/cardNumber.ts.
  CREATE TABLE IF NOT EXISTS en_cards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    set_id TEXT NOT NULL,
    set_name TEXT NOT NULL,
    local_id TEXT NOT NULL,
    set_release_date TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    set_card_count_official INTEGER,
    set_card_count_total INTEGER,
    set_code TEXT NOT NULL DEFAULT '',
    synced_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_en_cards_name ON en_cards(name);
  CREATE INDEX IF NOT EXISTS idx_en_cards_local_id ON en_cards(local_id);

  -- Magic: The Gathering mirror (Scryfall, every paper printing; see
  -- scripts/sync-mtg.mjs). Same identification shape as en_cards — name +
  -- collector number + set code — plus what Scryfall gives that TCGdex
  -- doesn't: prices per printing (USD nonfoil/foil/etched, EUR), rarity,
  -- type line and finishes. Prices refresh on every sync, so MTG pricing is
  -- served from here rather than a live upstream (see lib/server/mtgCards.ts).
  CREATE TABLE IF NOT EXISTS mtg_sets (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    released_at TEXT NOT NULL DEFAULT '',
    card_count INTEGER,
    printed_size INTEGER,
    set_type TEXT NOT NULL DEFAULT '',
    icon_url TEXT NOT NULL DEFAULT '',
    synced_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mtg_cards (
    id TEXT PRIMARY KEY,
    oracle_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    set_code TEXT NOT NULL,
    set_name TEXT NOT NULL,
    collector_number TEXT NOT NULL,
    set_release_date TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    rarity TEXT NOT NULL DEFAULT '',
    type_line TEXT NOT NULL DEFAULT '',
    finishes TEXT NOT NULL DEFAULT '',
    lang TEXT NOT NULL DEFAULT 'en',
    price_usd REAL,
    price_usd_foil REAL,
    price_usd_etched REAL,
    price_eur REAL,
    price_eur_foil REAL,
    synced_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mtg_cards_name ON mtg_cards(name);
  CREATE INDEX IF NOT EXISTS idx_mtg_cards_number ON mtg_cards(collector_number, set_code);

  -- Local copy of successful card lookups. pokemontcg.io fails often enough
  -- to break scanning outright, so a card seen once stays available even
  -- while the upstream is down. See lib/server/cardCache.ts.
  CREATE TABLE IF NOT EXISTS card_cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    cached_at INTEGER NOT NULL
  );

  -- The tables below used to be created at module load by the libs that own
  -- them (priceHistory, passwordReset, ebayAuth, pokemonPriceRefresh); with
  -- the async adapter all DDL runs behind one schema gate instead, so a
  -- module import can never race a query.

  -- One compact row per card/variant/source (see lib/priceSeries.ts + the
  -- rationale in lib/server/priceHistory.ts).
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

  -- One-time reset links; only the token's SHA-256 is stored (passwordReset.ts).
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

  -- eBay OAuth tokens, AES-256-GCM sealed (ebayAuth.ts).
  CREATE TABLE IF NOT EXISTS ebay_tokens (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    access_expires_at INTEGER NOT NULL,
    refresh_token TEXT NOT NULL,
    refresh_expires_at INTEGER NOT NULL,
    ebay_user_id TEXT,
    ebay_username TEXT,
    scopes TEXT NOT NULL,
    connected_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ebay_tokens_ebay_user ON ebay_tokens(ebay_user_id);

  -- The seller's own photo of each ledger card (cardPhotos.ts): ≤1600px
  -- client-re-encoded JPEGs, so a row is a few hundred KB. In the DB on
  -- purpose — serverless hosting then needs no separate file store, and
  -- the whole product lives in Turso. Explicitly deleted with the card;
  -- the CASCADE is only a backstop (unverified over HTTP, see header).
  CREATE TABLE IF NOT EXISTS card_photos (
    card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    bytes BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- TCGplayer productId -> card map from scripts/backfill-tcgcsv.mjs
  -- (pokemonPriceRefresh.ts).
  CREATE TABLE IF NOT EXISTS tcgplayer_products (
    product_id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL,
    card_id TEXT NOT NULL,
    game TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tcgplayer_products_group ON tcgplayer_products(group_id);
`;

/**
 * Columns added after tables first shipped. CREATE TABLE IF NOT EXISTS
 * silently does nothing on a database that already has the table, and
 * SQLite has no "ADD COLUMN IF NOT EXISTS" — add and ignore the
 * duplicate-column error. (See the original per-table notes in git history;
 * behaviour is unchanged from the sync driver.)
 */
const COLUMN_PROBES: [table: string, columns: string[]][] = [
  [
    "en_cards",
    [
      "set_card_count_official INTEGER",
      "set_card_count_total INTEGER",
      "set_code TEXT NOT NULL DEFAULT ''",
    ],
  ],
  [
    "cards",
    [
      "kind TEXT NOT NULL DEFAULT 'card'",
      "product_type TEXT",
      "ebay_sku TEXT",
      "ebay_offer_id TEXT",
      "ebay_listing_id TEXT",
      "ebay_pushed_at INTEGER",
      "ebay_published_at INTEGER",
      "photo_at INTEGER",
      "ebay_draft_id TEXT",
      "ebay_draft_url TEXT",
      "ebay_draft_at INTEGER",
      "game TEXT NOT NULL DEFAULT 'pokemon'",
    ],
  ],
  ["wishlist_items", ["card_id TEXT", "game TEXT"]],
  ["users", [
    "totp_secret TEXT",
    "totp_enabled_at INTEGER",
    // Stripe billing (lib/server/stripe.ts): customer id once checkout has
    // run; sub_status mirrors the subscription ("active", "past_due",
    // "canceled", ... — NULL = never subscribed); sub_period_end for display.
    "stripe_customer_id TEXT",
    "sub_status TEXT",
    "sub_period_end INTEGER",
    // Scan metering (lib/server/scanQuota.ts): scan_month is the yyyy-mm the
    // counter belongs to (reset lazily on rollover); extra_scans is the bank
    // of purchased pack scans, consumed after the monthly allowance.
    "scan_month TEXT",
    "scans_used INTEGER NOT NULL DEFAULT 0",
    "extra_scans INTEGER NOT NULL DEFAULT 0",
  ]],
];

async function initSchema(): Promise<void> {
  await client.executeMultiple((dbIsRemote ? "" : FILE_PRAGMAS) + SCHEMA);
  for (const [table, columns] of COLUMN_PROBES) {
    for (const column of columns) {
      try {
        await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column}`);
      } catch {
        // Already present.
      }
    }
  }
  // Created after the columns exist, so it can't live in the schema block.
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_en_cards_printed ON en_cards(local_id, set_card_count_official)",
  );
}

/** Schema-ready gate — every query awaits this once per process. */
function ready(): Promise<void> {
  if (!globalForDb.__cardflipReady) globalForDb.__cardflipReady = initSchema();
  return globalForDb.__cardflipReady;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: bigint | undefined;
}

export interface Statement {
  get<T = Record<string, unknown>>(...args: InValue[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...args: InValue[]): Promise<T[]>;
  run(...args: InValue[]): Promise<RunResult>;
}

/** A statement bound to either the client or an open transaction. */
function statementOn(target: Client | Transaction, sql: string): Statement {
  return {
    async get<T>(...args: InValue[]): Promise<T | undefined> {
      await ready();
      const rs = await target.execute({ sql, args });
      return rs.rows[0] as T | undefined;
    },
    async all<T>(...args: InValue[]): Promise<T[]> {
      await ready();
      const rs = await target.execute({ sql, args });
      return rs.rows as T[];
    },
    async run(...args: InValue[]): Promise<RunResult> {
      await ready();
      const rs = await target.execute({ sql, args });
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid };
    },
  };
}

export interface DbTx {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
}

export const db = {
  prepare(sql: string): Statement {
    return statementOn(client, sql);
  },
  async exec(sql: string): Promise<void> {
    await ready();
    await client.executeMultiple(sql);
  },
  /**
   * Multi-statement write in one transaction. The HTTP client rejects raw
   * BEGIN/COMMIT, so anything that used them goes through here.
   */
  async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    await ready();
    const t = await client.transaction("write");
    try {
      const out = await fn({
        prepare: (sql: string) => statementOn(t, sql),
        exec: async (sql: string) => {
          await t.executeMultiple(sql);
        },
      });
      await t.commit();
      return out;
    } catch (err) {
      try {
        t.close();
      } catch {
        // Already closed.
      }
      throw err;
    }
  },
};

/**
 * Seed the Magic mirror from the file baked into the deploy.
 *
 * File backend only — on Turso the mirror is loaded once during migration
 * and refreshed by the daily price job, so the seed path is skipped
 * entirely. This function keeps its own synchronous node:sqlite connection
 * (ATTACH + short batched transactions on the same file the async client
 * has open — fine under WAL), because the locking/yield behaviour below
 * was tuned the hard way (v102–v107) and rewriting it against the async
 * client would re-open all of it for zero user benefit.
 *
 * Original rationale: Scryfall rate-limits Fly's shared egress IP hard
 * enough that scripts/sync-mtg.mjs can't finish from the machine, so the
 * mirror is synced locally, exported to seed/mtg-mirror.db.gz, shipped in
 * the image, and copied into the live database here on first boot.
 */
export async function seedMtgMirror(): Promise<void> {
  if (dbIsRemote) return;
  // Never during `next build`: its ~15 parallel workers each evaluate this
  // module against a throwaway database, and 15 concurrent seed imports
  // trip "database is locked" (failed the Fly build at v102). Called from
  // instrumentation.ts on server start — NOT at module import (v105 hung
  // every request for ~2 minutes running the merge on the event loop).
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build") return;
  const seedGz = path.join(process.cwd(), "seed", "mtg-mirror.db.gz");
  if (!fs.existsSync(seedGz)) return;
  await ready();
  const tmp = path.join(DATA_DIR, "mtg-mirror.seed.db");
  const sdb = new DatabaseSync(DB_PATH);
  sdb.exec("PRAGMA busy_timeout = 5000");
  let attachedSeed = false;
  try {
    const seedTime = Math.floor(fs.statSync(seedGz).mtimeMs);
    const current = sdb
      .prepare("SELECT COALESCE(MAX(synced_at), 0) AS at, COUNT(*) AS n FROM mtg_cards")
      .get() as { at: number; n: number };
    // A live mirror only wins when it is BOTH newer than the seed AND
    // actually complete. Recency alone was wrong once: an in-place sync that
    // 429'd on page 2 left 175 rows with a fresh timestamp, the seed was
    // skipped, and Magic search on prod returned nothing (08-16).
    const FULL_MIRROR_FLOOR = 80_000;
    const SEED_IMPORT_VERSION = 4;
    const marker = path.join(DATA_DIR, "mtg-seed.imported");
    const markerValue = `${seedTime}:v${SEED_IMPORT_VERSION}`;
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === markerValue) return;

    // Stream the gunzip to disk — gunzipSync into a Buffer OOM-killed the
    // 512 MB Fly machine in a crash loop (v106/107).
    await pipeline(fs.createReadStream(seedGz), zlib.createGunzip(), fs.createWriteStream(tmp));
    const attached = new DatabaseSync(tmp, { readOnly: true });
    const seed = attached
      .prepare("SELECT COALESCE(MAX(synced_at), 0) AS at, COUNT(*) AS n FROM mtg_cards")
      .get() as { at: number; n: number };
    attached.close();
    // The mirror (cards + sets) is replaced only when the seed is newer or
    // more complete than what the volume holds. Price history is merged
    // regardless: a seed can carry new history without new card data.
    const replaceMirror = !(current.n >= FULL_MIRROR_FLOOR && current.n >= seed.n && current.at >= seed.at);

    sdb.exec(`ATTACH DATABASE '${tmp.replace(/'/g, "''")}' AS mtgseed`);
    attachedSeed = true;
    // Older seeds were exported without keys; index in place (the tmp file is
    // ours) so phase 2's per-key reads aren't full scans.
    try {
      sdb.exec("CREATE INDEX IF NOT EXISTS mtgseed.idx_seed_series ON price_series(card_id, variant, source)");
    } catch { /* read-only or already keyed */ }

    // --- Phase 1 (one short transaction, pure SQL): mirror, new series, map.
    sdb.exec("BEGIN");
    if (replaceMirror) {
      sdb.exec("DELETE FROM mtg_cards");
      sdb.exec("DELETE FROM mtg_sets");
      sdb.exec(`INSERT OR REPLACE INTO mtg_sets (code, name, released_at, card_count, printed_size, set_type, icon_url, synced_at)
                 SELECT code, name, released_at, card_count, printed_size, set_type, icon_url, synced_at FROM mtgseed.mtg_sets`);
      sdb.exec(`INSERT OR REPLACE INTO mtg_cards (id, oracle_id, name, set_code, set_name, collector_number, set_release_date,
                 image_url, rarity, type_line, finishes, lang, price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil, synced_at)
                 SELECT id, oracle_id, name, set_code, set_name, collector_number, set_release_date,
                 image_url, rarity, type_line, finishes, lang, price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil, synced_at
                 FROM mtgseed.mtg_cards`);
    }
    const seedHasHistory = sdb
      .prepare("SELECT 1 AS ok FROM mtgseed.sqlite_master WHERE type = 'table' AND name = 'price_series'")
      .get();
    let historyRows = 0;
    if (seedHasHistory) {
      sdb.exec(`CREATE TABLE IF NOT EXISTS price_series (
        card_id TEXT NOT NULL, game TEXT NOT NULL, variant TEXT NOT NULL, source TEXT NOT NULL,
        currency TEXT NOT NULL, start_day TEXT NOT NULL, prices TEXT NOT NULL, updated_day TEXT NOT NULL,
        PRIMARY KEY (card_id, variant, source))`);
      // Rows prod doesn't have at all: straight copy.
      historyRows = Number(
        sdb.prepare(`INSERT OR IGNORE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
                    SELECT card_id, game, variant, source, currency, start_day, prices, updated_day FROM mtgseed.price_series`).run().changes,
      );
    }
    const seedHasMap = sdb
      .prepare("SELECT 1 AS ok FROM mtgseed.sqlite_master WHERE type = 'table' AND name = 'tcgplayer_products'")
      .get();
    if (seedHasMap) {
      sdb.exec(`CREATE TABLE IF NOT EXISTS tcgplayer_products (
        product_id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, card_id TEXT NOT NULL, game TEXT NOT NULL)`);
      sdb.exec(`INSERT OR REPLACE INTO tcgplayer_products (product_id, group_id, card_id, game)
               SELECT product_id, group_id, card_id, game FROM mtgseed.tcgplayer_products`);
    }
    sdb.exec("COMMIT");

    // --- Phase 2 (batched, yielding): series both sides hold — fill prod's
    // gaps from the seed, never overwrite prod's own points. Keys only are
    // loaded up front (small); each batch reads, merges and writes ~300 rows
    // in its own short transaction, then yields to the event loop.
    if (seedHasHistory) {
      const keys = sdb.prepare(`SELECT s.card_id, s.variant, s.source
                                 FROM mtgseed.price_series s
                                 JOIN price_series p ON p.card_id = s.card_id AND p.variant = s.variant AND p.source = s.source
                                WHERE s.updated_day <> p.updated_day OR s.start_day <> p.start_day`)
        .all() as unknown as { card_id: string; variant: string; source: string }[];
      const readSeed = sdb.prepare("SELECT start_day, prices FROM mtgseed.price_series WHERE card_id = ? AND variant = ? AND source = ?");
      const readProd = sdb.prepare("SELECT start_day, prices FROM price_series WHERE card_id = ? AND variant = ? AND source = ?");
      const write = sdb.prepare("UPDATE price_series SET start_day = ?, prices = ? WHERE card_id = ? AND variant = ? AND source = ?");
      const BATCH = 300;
      for (let i = 0; i < keys.length; i += BATCH) {
        sdb.exec("BEGIN");
        try {
          for (const k of keys.slice(i, i + BATCH)) {
            const sd = readSeed.get(k.card_id, k.variant, k.source) as { start_day: string; prices: string } | undefined;
            const pd = readProd.get(k.card_id, k.variant, k.source) as { start_day: string; prices: string } | undefined;
            if (!sd || !pd) continue;
            let row = { startDay: pd.start_day, prices: decodePrices(pd.prices) };
            const have = new Set(toPoints(row).map((pt) => pt.day));
            let changed = false;
            for (const pt of toPoints({ startDay: sd.start_day, prices: decodePrices(sd.prices) })) {
              if (have.has(pt.day)) continue;
              row = setDay(row, pt.day, pt.price);
              changed = true;
            }
            if (changed) { write.run(row.startDay, encodePrices(row.prices), k.card_id, k.variant, k.source); historyRows++; }
          }
          sdb.exec("COMMIT");
        } catch (err) {
          sdb.exec("ROLLBACK");
          throw err;
        }
        await new Promise<void>((r) => setImmediate(r));
      }
    }

    sdb.exec("DETACH DATABASE mtgseed");
    attachedSeed = false;
    fs.unlinkSync(tmp);
    fs.writeFileSync(marker, markerValue);
    const after = (sdb.prepare("SELECT COUNT(*) AS n FROM mtg_cards").get() as { n: number }).n;
    console.info(`MTG seed ${path.basename(seedGz)}: mirror ${replaceMirror ? "replaced" : "kept"} (${after} printings), ${historyRows} price series merged`);
  } catch (err) {
    // A failed seed must never take the app down — Pokémon still works and
    // Magic search reports "catalogue isn't loaded" until the next boot.
    console.error("MTG mirror seed failed:", err);
    try { sdb.exec("ROLLBACK"); } catch { /* no transaction open */ }
    if (attachedSeed) { try { sdb.exec("DETACH DATABASE mtgseed"); } catch { /* already detached */ } }
  } finally {
    try { sdb.close(); } catch { /* already closed */ }
  }
}
