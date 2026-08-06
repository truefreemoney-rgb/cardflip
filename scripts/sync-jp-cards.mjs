#!/usr/bin/env node
// Mirrors every Japanese card name/set/number from TCGdex into our own
// SQLite table, since TCGdex's name-search doesn't work for the "ja" locale
// (confirmed directly — even an exact name returns []). Browsing per-set
// listings does work, so this walks every set once and caches the result.
//
// Usage: npm run sync:jp

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const API_BASE = "https://api.tcgdex.net/v2/ja";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "cardflip.db"));

db.exec(`
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

const upsert = db.prepare(`
  INSERT INTO jp_cards (id, name, set_id, set_name, local_id, synced_at)
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
  console.log("Fetching Japanese set list...");
  const sets = await fetchJson(`${API_BASE}/sets`);
  console.log(`Found ${sets.length} sets. Syncing cards...\n`);

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
