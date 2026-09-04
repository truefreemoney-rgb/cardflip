#!/usr/bin/env node
// Mirrors Magic: The Gathering from Scryfall into our SQLite (mtg_sets +
// mtg_cards) — the MTG counterpart of sync-cards.mjs.
//
// Why a mirror: identification must not depend on an upstream being up
// (pokemontcg.io taught us that), and Scryfall's card objects already carry
// per-printing prices (USD nonfoil / foil / etched, EUR), so one sync gives
// us search, images AND pricing in one place. Re-run it to refresh prices
// (Scryfall updates them daily) and to pick up new sets.
//
// Source: the paginated search API rather than the bulk file — the bulk
// "default_cards" JSON is ~450MB and parsing it would exceed the Fly
// machine's memory; pages of 175 cards stream through in a few minutes at
// Scryfall's requested pace (≤10 req/s; we do ~8).
//
// Usage:
//   npm run sync:mtg              (English paper printings — the default)
//   node scripts/sync-mtg.mjs ja  (another Scryfall language code)
//   flyctl ssh console --app cardflip-superior -C "node scripts/sync-mtg.mjs"

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { decodePrices, encodePrices, setDay, todayUtc } from "../src/lib/priceSeries.ts";

const lang = process.argv[2] ?? "en";
const API = "https://api.scryfall.com";
// Scryfall asks every client to identify itself.
const HEADERS = {
  "User-Agent": "CardFlip/1.0 (+https://cardflip-superior.fly.dev)",
  Accept: "application/json",
};
const PAGE_DELAY_MS = 120;

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(dataDir, "cardflip.db"));
db.exec("PRAGMA journal_mode = WAL");

// Keep in step with src/lib/db.ts.
db.exec(`
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
`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, attempt = 1) {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`${url} → ${res.status} after ${attempt} tries`);
    const wait = 1000 * attempt;
    console.warn(`  ${res.status} from Scryfall, retrying in ${wait}ms`);
    await sleep(wait);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${url} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

const num = (v) => (v == null || v === "" ? null : Number(v));

// ---------- sets ----------
const upsertSet = db.prepare(`
  INSERT INTO mtg_sets (code, name, released_at, card_count, printed_size, set_type, icon_url, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET
    name = excluded.name,
    released_at = excluded.released_at,
    card_count = excluded.card_count,
    printed_size = excluded.printed_size,
    set_type = excluded.set_type,
    icon_url = excluded.icon_url,
    synced_at = excluded.synced_at
`);

const now = Date.now();
const setsJson = await getJson(`${API}/sets`);
const setNames = new Map();
db.exec("BEGIN");
for (const s of setsJson.data ?? []) {
  if (s.digital) continue;
  setNames.set(s.code, s.name);
  upsertSet.run(
    s.code,
    s.name,
    s.released_at ?? "",
    num(s.card_count),
    num(s.printed_size),
    s.set_type ?? "",
    s.icon_svg_uri ?? "",
    now,
  );
}
db.exec("COMMIT");
console.log(`sets: ${setNames.size} paper sets`);

// ---------- cards ----------
const upsertCard = db.prepare(`
  INSERT INTO mtg_cards (
    id, oracle_id, name, set_code, set_name, collector_number, set_release_date,
    image_url, rarity, type_line, finishes, lang,
    price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    oracle_id = excluded.oracle_id,
    name = excluded.name,
    set_code = excluded.set_code,
    set_name = excluded.set_name,
    collector_number = excluded.collector_number,
    set_release_date = excluded.set_release_date,
    image_url = CASE WHEN excluded.image_url = '' THEN mtg_cards.image_url ELSE excluded.image_url END,
    rarity = excluded.rarity,
    type_line = excluded.type_line,
    finishes = excluded.finishes,
    lang = excluded.lang,
    price_usd = excluded.price_usd,
    price_usd_foil = excluded.price_usd_foil,
    price_usd_etched = excluded.price_usd_etched,
    price_eur = excluded.price_eur,
    price_eur_foil = excluded.price_eur_foil,
    synced_at = excluded.synced_at
`);

function imageOf(card) {
  // Double-faced / adventure layouts keep images on the faces.
  const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris ?? null;
  return uris?.normal ?? uris?.large ?? uris?.small ?? "";
}

// Every paper printing in the language; `unique=prints` gives one row per
// printing (the default collapses reprints). Ordered by set so a resumed run
// is deterministic.
const query = encodeURIComponent(`game:paper lang:${lang}`);
let url = `${API}/cards/search?q=${query}&unique=prints&order=set&page=1`;
let page = 0;
let total = 0;
let seenSets = new Set();

while (url) {
  const json = await getJson(url);
  page += 1;
  const rows = json.data ?? [];
  db.exec("BEGIN");
  for (const c of rows) {
    if (!c.set || !c.collector_number || !c.name) continue;
    seenSets.add(c.set);
    upsertCard.run(
      c.id,
      c.oracle_id ?? "",
      c.name,
      c.set,
      c.set_name ?? setNames.get(c.set) ?? c.set.toUpperCase(),
      c.collector_number,
      c.released_at ?? "",
      imageOf(c),
      c.rarity ?? "",
      c.type_line ?? "",
      Array.isArray(c.finishes) ? c.finishes.join(",") : "",
      c.lang ?? lang,
      num(c.prices?.usd),
      num(c.prices?.usd_foil),
      num(c.prices?.usd_etched),
      num(c.prices?.eur),
      num(c.prices?.eur_foil),
      now,
    );
  }
  db.exec("COMMIT");
  total += rows.length;
  if (page === 1 || page % 25 === 0) {
    console.log(`page ${page}: ${total}/${json.total_cards ?? "?"} cards, ${seenSets.size} sets`);
  }
  url = json.has_more ? json.next_page : null;
  if (url) await sleep(PAGE_DELAY_MS);
}

// Printings Scryfall no longer returns for this language (renamed / merged
// ids) would otherwise linger forever with stale prices.
const stale = db
  .prepare("DELETE FROM mtg_cards WHERE lang = ? AND synced_at < ?")
  .run(lang, now);
console.log(`done: ${total} cards over ${page} pages, ${seenSets.size} sets, removed ${stale.changes} stale rows`);

// Art Series cards are "extras" the search above never returns; the stale
// sweep just removed them, so bring them back (scripts/sync-mtg-art.mjs).
{
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [path.join(process.cwd(), "scripts/sync-mtg-art.mjs")], { stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// Price history: one point per priced finish per printing for today, in the
// compact per-series rows (lib/priceSeries.ts). This is the only place Magic
// history is authored (Fly can't reach Scryfall), so it travels to prod inside
// the seed — export-mtg-mirror.mjs copies the table. USD/TCGplayer only, and
// bulk under 5¢ is skipped unless a series already exists: a chart for a
// 2¢ common isn't worth its bytes in a 94k-card seed.
db.exec(`
  CREATE TABLE IF NOT EXISTS price_series (
    card_id TEXT NOT NULL, game TEXT NOT NULL, variant TEXT NOT NULL, source TEXT NOT NULL,
    currency TEXT NOT NULL, start_day TEXT NOT NULL, prices TEXT NOT NULL, updated_day TEXT NOT NULL,
    PRIMARY KEY (card_id, variant, source)
  );
`);
const day = todayUtc(now);
const selectRow = db.prepare("SELECT start_day, prices FROM price_series WHERE card_id = ? AND variant = ? AND source = ?");
const upsertRow = db.prepare(`INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
                              VALUES (?, 'mtg', ?, 'tcgplayer', 'USD', ?, ?, ?)`);
const MIN_TRACKED_USD = 0.05;
let points = 0;
db.exec("BEGIN");
for (const row of db.prepare("SELECT id, price_usd, price_usd_foil, price_usd_etched FROM mtg_cards WHERE lang = ?").iterate(lang)) {
  for (const [variant, price] of [["nonfoil", row.price_usd], ["foil", row.price_usd_foil], ["etched", row.price_usd_etched]]) {
    if (!(price > 0)) continue;
    const existing = selectRow.get(row.id, variant, "tcgplayer");
    if (!existing && price < MIN_TRACKED_USD) continue;
    const next = setDay(existing ? { startDay: existing.start_day, prices: decodePrices(existing.prices) } : null, day, price);
    upsertRow.run(row.id, variant, next.startDay, encodePrices(next.prices), day);
    points++;
  }
}
db.exec("COMMIT");
console.log(`price history: ${points} series updated for ${day}`);
