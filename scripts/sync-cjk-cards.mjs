#!/usr/bin/env node
// Mirrors every card name/set/number from a TCGdex locale into our own
// SQLite table, since TCGdex's name-search doesn't work for "ja" or "zh-tw"
// (confirmed directly — even an exact name returns []). Browsing per-set
// listings does work, so this walks every set once and caches the result.
//
// Usage:
//   npm run sync:jp   (locale=ja, table=jp_cards)
//   npm run sync:zh   (locale=zh-tw, table=zh_cards)

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const [, , locale, table] = process.argv;

if (!locale || !table) {
  console.error("Usage: node scripts/sync-cjk-cards.mjs <locale> <table>");
  process.exit(1);
}

const API_BASE = `https://api.tcgdex.net/v2/${locale}`;

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "cardflip.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    set_id TEXT NOT NULL,
    set_name TEXT NOT NULL,
    local_id TEXT NOT NULL,
    synced_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_${table}_name ON ${table}(name);
`);

const upsert = db.prepare(`
  INSERT INTO ${table} (id, name, set_id, set_name, local_id, synced_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    set_name = excluded.set_name,
    local_id = excluded.local_id,
    synced_at = excluded.synced_at
`);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function main() {
  console.log(`Fetching ${locale} set list...`);
  const sets = await fetchJson(`${API_BASE}/sets`);
  console.log(`Found ${sets.length} sets. Syncing cards into ${table}...\n`);

  const now = Date.now();
  let totalCards = 0;

  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    process.stdout.write(`[${i + 1}/${sets.length}] ${set.id} — ${set.name} ... `);
    try {
      const detail = await fetchJson(`${API_BASE}/sets/${set.id}`);
      const cards = detail.cards ?? [];

      db.exec("BEGIN");
      try {
        for (const card of cards) {
          upsert.run(card.id, card.name, set.id, set.name, card.localId, now);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      totalCards += cards.length;
      console.log(`${cards.length} cards`);
    } catch (err) {
      console.log(`skipped (${err.message})`);
    }
  }

  console.log(`\nDone. ${totalCards} cards synced across ${sets.length} sets.`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
