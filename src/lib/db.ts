import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { decodePrices, encodePrices, setDay, toPoints } from "@/lib/priceSeries";

/**
 * A single embedded SQLite database backs the whole app. This is a real,
 * durable backend — not the localStorage stub the client used to fake a
 * session with — but it's file-based on purpose: no external database
 * service, no connection string, no account to provision, so `npm run dev`
 * is still all it takes to stand the whole thing up.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "cardflip.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

// A dev-mode hot-reload can re-run this module; keep one connection per process.
const globalForDb = globalThis as unknown as { __cardflipDb?: DatabaseSync };

export const db = globalForDb.__cardflipDb ?? new DatabaseSync(DB_PATH);
globalForDb.__cardflipDb = db;

// Next's build process imports route modules from several parallel workers
// to collect their config — each one evaluates this module and races to
// create the schema on the same fresh file (confirmed directly: build failed
// with "database is locked" once enough routes existed to collide). WAL mode
// alone doesn't prevent that during concurrent DDL; a busy timeout makes
// SQLite retry instead of failing immediately.
db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    ebay_connected INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
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
`);

/**
 * Columns added to en_cards after it first shipped.
 *
 * CREATE TABLE IF NOT EXISTS silently does nothing on a database that already
 * has the table, so a mirror synced before these columns existed — production's
 * included, on the Fly volume — would still be missing them, and the lookup's
 * SELECT would throw on every scan. The sync script runs the same probe, but
 * the app must not depend on having been re-synced first: SQLite has no
 * "ADD COLUMN IF NOT EXISTS", so add and ignore the duplicate-column error.
 */
for (const column of [
  "set_card_count_official INTEGER",
  "set_card_count_total INTEGER",
  "set_code TEXT NOT NULL DEFAULT ''",
]) {
  try {
    db.exec(`ALTER TABLE en_cards ADD COLUMN ${column}`);
  } catch {
    // Already present.
  }
}

// Same probe pattern for the seller ledger: sealed product rows arrived after
// the table shipped. "kind" tells a booster box from a single; product_type
// keeps which sealed product it is ("Booster Box", "Elite Trainer Box", ...).
// Grading needs no column — a slab's grade is stored in `condition` ("PSA 10"),
// which is already free text the UI displays verbatim.
//
// The eBay columns arrived with the Sell Inventory push: the SKU/offer id let a
// re-push update the same draft instead of creating a second one, and the
// listing id is what "View on eBay" links to once the offer is published.
// `photo_at` marks that the seller's own photo of the copy is on disk
// (data/photos/<id>.jpg) — eBay's picture policy wants the actual item, not
// catalogue art, so that file is the only listing image ever sent.
for (const column of [
  "kind TEXT NOT NULL DEFAULT 'card'",
  "product_type TEXT",
  "ebay_sku TEXT",
  "ebay_offer_id TEXT",
  "ebay_listing_id TEXT",
  "ebay_pushed_at INTEGER",
  "ebay_published_at INTEGER",
  "photo_at INTEGER",
  // Listing API draft (the one that shows in My eBay › Drafts) — id + the
  // URL that opens it in eBay's listing tool.
  "ebay_draft_id TEXT",
  "ebay_draft_url TEXT",
  "ebay_draft_at INTEGER",
  // Which game the row belongs to ('pokemon' | 'mtg') — drives titles,
  // eBay aspects and search links when the ledger is re-opened.
  "game TEXT NOT NULL DEFAULT 'pokemon'",
]) {
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN ${column}`);
  } catch {
    // Already present.
  }
}

// Created after the columns exist, so it can't live in the block above.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_en_cards_printed
    ON en_cards(local_id, set_card_count_official);
`);

/**
 * Seed the Magic mirror from the file baked into the deploy.
 *
 * Scryfall rate-limits Fly's shared egress IP hard enough that
 * scripts/sync-mtg.mjs can't finish from the machine (429s that don't clear
 * on retry — seen 08-16 on page 2), while the same script from a home IP
 * finishes in six minutes. So the mirror is synced locally, exported with
 * `npm run export:mtg` to seed/mtg-mirror.db.gz (~9 MB), shipped in the
 * image, and copied into the live database here on first boot — or whenever
 * the seed is newer than what the volume holds. Idempotent, a few seconds,
 * and it never overwrites a mirror that a successful in-place sync made
 * fresher than the seed.
 */
export async function seedMtgMirror(): Promise<void> {
  // Never during `next build`: its ~15 parallel workers each evaluate this
  // module against a throwaway database, and 15 concurrent seed imports
  // (gunzip + attach + a 73k-row history merge) trip "database is locked" and
  // failed the Fly build (v102). Called from instrumentation.ts on server
  // start — NOT at module import: v105 ran an 84k-series merge synchronously
  // on the event loop after "Ready" and every request hung for ~2 minutes.
  // The history merge below is batched with yields and short transactions
  // so the server keeps serving while it runs.
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build") return;
  const seedGz = path.join(process.cwd(), "seed", "mtg-mirror.db.gz");
  if (!fs.existsSync(seedGz)) return;
  const tmp = path.join(DATA_DIR, "mtg-mirror.seed.db");
  let attachedSeed = false;
  try {
    const seedTime = Math.floor(fs.statSync(seedGz).mtimeMs);
    const current = db
      .prepare("SELECT COALESCE(MAX(synced_at), 0) AS at, COUNT(*) AS n FROM mtg_cards")
      .get() as { at: number; n: number };
    // A live mirror only wins when it is BOTH newer than the seed AND
    // actually complete. Recency alone was wrong once: an in-place sync that
    // 429'd on page 2 left 175 rows with a fresh timestamp, the seed was
    // skipped, and Magic search on prod returned nothing (08-16). Anything
    // below the floor is a partial run and gets replaced.
    const FULL_MIRROR_FLOOR = 80_000;
    // Marker written after a successful import of this exact seed file, so
    // later boots skip the gunzip + compare entirely. Versioned: bumping
    // SEED_IMPORT_VERSION forces every deploy to re-run the import logic once.
    const SEED_IMPORT_VERSION = 4;
    const marker = path.join(DATA_DIR, "mtg-seed.imported");
    const markerValue = `${seedTime}:v${SEED_IMPORT_VERSION}`;
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === markerValue) return;

    // Stream the gunzip to disk — the seed is ~26 MB gzipped / ~250 MB raw,
    // and gunzipSync into a Buffer OOM-killed the 512 MB Fly machine in a
    // crash loop (v106/107, 08-16). Streaming keeps memory flat.
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

    db.exec(`ATTACH DATABASE '${tmp.replace(/'/g, "''")}' AS mtgseed`);
    attachedSeed = true;
    // Older seeds were exported without keys; index in place (the tmp file is
    // ours) so phase 2's per-key reads aren't full scans.
    try {
      db.exec("CREATE INDEX IF NOT EXISTS mtgseed.idx_seed_series ON price_series(card_id, variant, source)");
    } catch { /* read-only or already keyed */ }

    // --- Phase 1 (one short transaction, pure SQL): mirror, new series, map.
    db.exec("BEGIN");
    if (replaceMirror) {
      // Wholesale replace: rows from a partial sync would otherwise linger.
      db.exec("DELETE FROM mtg_cards");
      db.exec("DELETE FROM mtg_sets");
      db.exec(`INSERT OR REPLACE INTO mtg_sets (code, name, released_at, card_count, printed_size, set_type, icon_url, synced_at)
                 SELECT code, name, released_at, card_count, printed_size, set_type, icon_url, synced_at FROM mtgseed.mtg_sets`);
      db.exec(`INSERT OR REPLACE INTO mtg_cards (id, oracle_id, name, set_code, set_name, collector_number, set_release_date,
                 image_url, rarity, type_line, finishes, lang, price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil, synced_at)
                 SELECT id, oracle_id, name, set_code, set_name, collector_number, set_release_date,
                 image_url, rarity, type_line, finishes, lang, price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil, synced_at
                 FROM mtgseed.mtg_cards`);
    }
    const seedHasHistory = db
      .prepare("SELECT 1 AS ok FROM mtgseed.sqlite_master WHERE type = 'table' AND name = 'price_series'")
      .get();
    let historyRows = 0;
    if (seedHasHistory) {
      db.exec(`CREATE TABLE IF NOT EXISTS price_series (
        card_id TEXT NOT NULL, game TEXT NOT NULL, variant TEXT NOT NULL, source TEXT NOT NULL,
        currency TEXT NOT NULL, start_day TEXT NOT NULL, prices TEXT NOT NULL, updated_day TEXT NOT NULL,
        PRIMARY KEY (card_id, variant, source))`);
      // Rows prod doesn't have at all: straight copy.
      historyRows = Number(
        db.prepare(`INSERT OR IGNORE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
                    SELECT card_id, game, variant, source, currency, start_day, prices, updated_day FROM mtgseed.price_series`).run().changes,
      );
    }
    const seedHasMap = db
      .prepare("SELECT 1 AS ok FROM mtgseed.sqlite_master WHERE type = 'table' AND name = 'tcgplayer_products'")
      .get();
    if (seedHasMap) {
      db.exec(`CREATE TABLE IF NOT EXISTS tcgplayer_products (
        product_id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, card_id TEXT NOT NULL, game TEXT NOT NULL)`);
      db.exec(`INSERT OR REPLACE INTO tcgplayer_products (product_id, group_id, card_id, game)
               SELECT product_id, group_id, card_id, game FROM mtgseed.tcgplayer_products`);
    }
    db.exec("COMMIT");

    // --- Phase 2 (batched, yielding): series both sides hold — fill prod's
    // gaps from the seed, never overwrite prod's own points. Keys only are
    // loaded up front (small); each batch reads, merges and writes ~300 rows
    // in its own short transaction, then yields to the event loop.
    if (seedHasHistory) {
      const keys = db.prepare(`SELECT s.card_id, s.variant, s.source
                                 FROM mtgseed.price_series s
                                 JOIN price_series p ON p.card_id = s.card_id AND p.variant = s.variant AND p.source = s.source
                                WHERE s.updated_day <> p.updated_day OR s.start_day <> p.start_day`)
        .all() as unknown as { card_id: string; variant: string; source: string }[];
      const readSeed = db.prepare("SELECT start_day, prices FROM mtgseed.price_series WHERE card_id = ? AND variant = ? AND source = ?");
      const readProd = db.prepare("SELECT start_day, prices FROM price_series WHERE card_id = ? AND variant = ? AND source = ?");
      const write = db.prepare("UPDATE price_series SET start_day = ?, prices = ? WHERE card_id = ? AND variant = ? AND source = ?");
      const BATCH = 300;
      for (let i = 0; i < keys.length; i += BATCH) {
        db.exec("BEGIN");
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
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
        await new Promise<void>((r) => setImmediate(r));
      }
    }

    db.exec("DETACH DATABASE mtgseed");
    attachedSeed = false;
    fs.unlinkSync(tmp);
    fs.writeFileSync(marker, markerValue);
    const after = (db.prepare("SELECT COUNT(*) AS n FROM mtg_cards").get() as { n: number }).n;
    console.info(`MTG seed ${path.basename(seedGz)}: mirror ${replaceMirror ? "replaced" : "kept"} (${after} printings), ${historyRows} price series merged`);
  } catch (err) {
    // A failed seed must never take the app down — Pokémon still works and
    // Magic search reports "catalogue isn't loaded" until the next boot.
    console.error("MTG mirror seed failed:", err);
    try { db.exec("ROLLBACK"); } catch { /* no transaction open */ }
    if (attachedSeed) { try { db.exec("DETACH DATABASE mtgseed"); } catch { /* already detached */ } }
  }
}
