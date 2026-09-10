#!/usr/bin/env node
// Fills mtg_cards.flavor_name on the local mirror without a full Scryfall walk
// (docs/MTG-IDENTIFICATION.md §3c, phase 2 leftover: LTC 386 "Shards of
// Narsil" IS Thorn of Amethyst, and the photo only shows the flavor name).
//
//   node scripts/sync-mtg-flavor.mjs
//
// ~640 paper printings carry a flavor name (Secret Lair + Universes Beyond
// twins), four search pages — the full sync (scripts/sync-mtg.mjs) also
// writes the column, but Scryfall 429s that walk from here. Prod gets the
// column through scripts/push-mtg-cues.mjs like the other printing cues.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const API = "https://api.scryfall.com";
const HEADERS = {
  "User-Agent": "CardFlip/1.0 (+https://cardflip.io)",
  Accept: "application/json",
};
const PAGE_DELAY_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"));
try { db.exec("ALTER TABLE mtg_cards ADD COLUMN flavor_name TEXT NOT NULL DEFAULT ''"); } catch { /* present */ }

async function getJson(url, attempt = 1) {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`${url} → ${res.status} after ${attempt} tries`);
    await sleep(2000 * attempt);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const update = db.prepare("UPDATE mtg_cards SET flavor_name = ? WHERE id = ?");
const query = encodeURIComponent("game:paper lang:en has:flavorname");
let url = `${API}/cards/search?q=${query}&unique=prints&order=set&page=1`;
let seen = 0;
let written = 0;
let missing = 0;
while (url) {
  const json = await getJson(url);
  db.exec("BEGIN");
  for (const c of json.data ?? []) {
    const flavor = c.flavor_name ?? c.card_faces?.[0]?.flavor_name ?? "";
    seen += 1;
    if (!flavor) continue;
    const r = update.run(flavor, c.id);
    if (r.changes) written += 1;
    else missing += 1; // not in the mirror (Art Series / extras) — the full sync brings it
  }
  db.exec("COMMIT");
  url = json.has_more ? json.next_page : null;
  if (url) await sleep(PAGE_DELAY_MS);
}
const total = db.prepare("SELECT COUNT(*) AS n FROM mtg_cards WHERE flavor_name <> ''").get().n;
console.log(`flavor names: ${seen} printings from Scryfall, ${written} rows updated, ${missing} not in the mirror; ${total} rows carry one`);
const narsil = db.prepare("SELECT name, flavor_name FROM mtg_cards WHERE set_code = 'ltc' AND collector_number = '386'").get();
console.log("LTC 386:", narsil ?? "(not in mirror)");
