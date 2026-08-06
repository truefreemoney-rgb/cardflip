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

db.exec(`
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
  -- this local copy instead. Populated by scripts/sync-jp-cards.mjs.
  CREATE TABLE IF NOT EXISTS jp_cards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    set_id TEXT NOT NULL,
    set_name TEXT NOT NULL,
    local_id TEXT NOT NULL,
    synced_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jp_cards_name ON jp_cards(name);
`);
