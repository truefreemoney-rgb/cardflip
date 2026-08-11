import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

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
  CREATE TABLE IF NOT EXISTS en_cards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    set_id TEXT NOT NULL,
    set_name TEXT NOT NULL,
    local_id TEXT NOT NULL,
    set_release_date TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    synced_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_en_cards_name ON en_cards(name);
  CREATE INDEX IF NOT EXISTS idx_en_cards_local_id ON en_cards(local_id);

  -- Local copy of successful card lookups. pokemontcg.io fails often enough
  -- to break scanning outright, so a card seen once stays available even
  -- while the upstream is down. See lib/server/cardCache.ts.
  CREATE TABLE IF NOT EXISTS card_cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    cached_at INTEGER NOT NULL
  );
`);
