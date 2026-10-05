#!/usr/bin/env node
// Fills mtg_cards.attraction_lights on the local mirror without a full
// Scryfall walk (09-29: Unfinity Attractions 219a-f are one picture with
// different lit numbers down the right edge, e.g. Kiddie Coaster 219c = 2,5,6).
//
//   node scripts/sync-mtg-attractions.mjs
//
// The full sync (scripts/sync-mtg.mjs) also writes the column. Prod gets it
// through scripts/push-mtg-cues.mjs like the other printing cues.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { scryfallFetch } from "./lib/scryfall-guard.mjs";

const API = "https://api.scryfall.com";
const HEADERS = {
  "User-Agent": "CardFlip/1.0 (+https://cardflip.io)",
  Accept: "application/json",
};
const PAGE_DELAY_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"));
try { db.exec("ALTER TABLE mtg_cards ADD COLUMN attraction_lights TEXT NOT NULL DEFAULT ''"); } catch { /* present */ }

async function getJson(url, attempt = 1) {
  const res = await scryfallFetch(url, { headers: HEADERS });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`${url} → ${res.status} after ${attempt} tries`);
    await sleep(2000 * attempt);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const update = db.prepare("UPDATE mtg_cards SET attraction_lights = ? WHERE id = ?");
const query = encodeURIComponent("game:paper t:attraction");
let url = `${API}/cards/search?q=${query}&unique=prints&order=set&page=1`;
let seen = 0;
let written = 0;
let missing = 0;
while (url) {
  const json = await getJson(url);
  db.exec("BEGIN");
  for (const c of json.data ?? []) {
    seen += 1;
    if (!Array.isArray(c.attraction_lights) || !c.attraction_lights.length) continue;
    const r = update.run([...c.attraction_lights].sort((a, b) => a - b).join(","), c.id);
    if (r.changes) written += 1;
    else missing += 1;
  }
  db.exec("COMMIT");
  url = json.has_more ? json.next_page : null;
  if (url) await sleep(PAGE_DELAY_MS);
}
const total = db.prepare("SELECT COUNT(*) AS n FROM mtg_cards WHERE attraction_lights <> ''").get().n;
console.log(`attractions: ${seen} printings from Scryfall, ${written} rows updated, ${missing} not in the mirror; ${total} rows carry lights`);
console.log("UNF 219c:", db.prepare("SELECT name, attraction_lights FROM mtg_cards WHERE set_code = 'unf' AND collector_number = '219c'").get());
