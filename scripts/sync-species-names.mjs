#!/usr/bin/env node
// Populates a local dex-number -> English-species-name table so Japanese and
// Chinese card names can show a readable English overlay ("ピカチュウ" ->
// "Pikachu") without a live translation call at request time.
//
// Usage: npm run sync:species

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "cardflip.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS species_names (
    dex_id INTEGER PRIMARY KEY,
    name_en TEXT NOT NULL
  );
`);

const upsert = db.prepare(`
  INSERT INTO species_names (dex_id, name_en) VALUES (?, ?)
  ON CONFLICT(dex_id) DO UPDATE SET name_en = excluded.name_en
`);

function titleCase(slug) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function main() {
  console.log("Fetching Pokémon species list...");
  const res = await fetch("https://pokeapi.co/api/v2/pokemon-species?limit=1500");
  const { results } = await res.json();
  console.log(`Found ${results.length} species. Syncing...`);

  db.exec("BEGIN");
  let count = 0;
  for (const entry of results) {
    const match = entry.url.match(/\/pokemon-species\/(\d+)\//);
    if (!match) continue;
    const dexId = Number(match[1]);
    upsert.run(dexId, titleCase(entry.name));
    count++;
  }
  db.exec("COMMIT");

  console.log(`Done. ${count} species names synced.`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
