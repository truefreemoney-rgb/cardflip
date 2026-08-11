#!/usr/bin/env node
// Mirrors a TCGdex locale into our own SQLite table.
//
// For "ja" and "zh-tw" this exists because TCGdex's name-search doesn't work
// for those locales (confirmed directly — even an exact name returns []).
// For "en" the reason is different: pokemontcg.io is the only English card
// source and it was measured failing 5 of 10 requests, which broke scanning
// outright. A local mirror makes identification independent of it.
//
// English sets also carry a release date and an image URL, which the CJK
// locales don't — those let us rank printings and show thumbnails without
// any network call at all.
//
// Usage:
//   npm run sync:en   (locale=en,     table=en_cards)
//   npm run sync:jp   (locale=ja,     table=jp_cards)
//   npm run sync:zh   (locale=zh-tw,  table=zh_cards)

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const [, , locale, table] = process.argv;

if (!locale || !table) {
  console.error("Usage: node scripts/sync-cards.mjs <locale> <table>");
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
    set_release_date TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    synced_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_${table}_name ON ${table}(name);
  CREATE INDEX IF NOT EXISTS idx_${table}_local_id ON ${table}(local_id);
`);

// Tables created before release date and images existed need the new columns;
// SQLite has no "ADD COLUMN IF NOT EXISTS", so probe and ignore the duplicate.
for (const column of [
  "set_release_date TEXT NOT NULL DEFAULT ''",
  "image_url TEXT NOT NULL DEFAULT ''",
]) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  } catch {
    // Already present.
  }
}

const upsert = db.prepare(`
  INSERT INTO ${table}
    (id, name, set_id, set_name, local_id, set_release_date, image_url, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    set_name = excluded.set_name,
    local_id = excluded.local_id,
    set_release_date = excluded.set_release_date,
    image_url = excluded.image_url,
    synced_at = excluded.synced_at
`);

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastError;
}

async function main() {
  console.log(`Fetching ${locale} set list...`);
  const sets = await fetchJson(`${API_BASE}/sets`);
  console.log(`Found ${sets.length} sets. Syncing cards into ${table}...\n`);

  const now = Date.now();
  let totalCards = 0;
  let skipped = 0;

  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    process.stdout.write(`[${i + 1}/${sets.length}] ${set.id} — ${set.name} ... `);
    try {
      const detail = await fetchJson(`${API_BASE}/sets/${set.id}`);
      const cards = detail.cards ?? [];
      const releaseDate = detail.releaseDate ?? set.releaseDate ?? "";

      db.exec("BEGIN");
      try {
        for (const card of cards) {
          // TCGdex serves images as {base}/{quality}.{ext}; the bare URL 404s.
          const image = card.image ? `${card.image}/low.webp` : "";
          upsert.run(
            card.id,
            card.name,
            set.id,
            set.name,
            card.localId,
            releaseDate,
            image,
            now,
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      totalCards += cards.length;
      console.log(`${cards.length} cards`);
    } catch (err) {
      skipped++;
      console.log(`skipped (${err.message})`);
    }
  }

  const withImages = db
    .prepare(`SELECT COUNT(*) c FROM ${table} WHERE image_url != ''`)
    .get().c;

  console.log(
    `\nDone. ${totalCards} cards across ${sets.length - skipped} sets` +
      (skipped ? ` (${skipped} skipped)` : "") +
      `. ${withImages} have images.`,
  );
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
