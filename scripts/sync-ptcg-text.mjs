// Pokémon big-print text for the catalog (10-30): HP, attack + ability names, Pokédex number, regulation mark,
// artist and rarity for every en_cards row, from the free pokemontcg.io data (GitHub PokemonTCG/pokemon-tcg-data,
// 176 sets, ~20.6k cards; files cached in data/ptcg/). Writes en_card_text locally, and on prod with --prod.
// The scanner reads the same things off the photo; with the collector number hidden they pick the printing
// (lib/server/enCards.ts).
//
//   node scripts/sync-ptcg-text.mjs            # local data/cardflip.db
//   node scripts/sync-ptcg-text.mjs --prod     # also prod (.env.migration.json)
//   node scripts/sync-ptcg-text.mjs --codes    # also fill the set codes of the 2023+ sets that have none (printed codes only)
//
// Mapping: a pokemontcg set lands on the en_cards set with the same folded name, else the one released within 3 days
// with the same printed total (dry run 10-30: 173 of 176 sets, 20,213 of 20,352 cards); three sets are aliased by hand.
// Within a set the card matches by collector number (leading zeros dropped).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { createClient } from "@libsql/client";

const RAW = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";
const dataDir = path.join(process.cwd(), "data");
const cacheDir = path.join(dataDir, "ptcg");
fs.mkdirSync(cacheDir, { recursive: true });
const prodFlag = process.argv.includes("--prod");
const codesFlag = process.argv.includes("--codes");
const refresh = process.argv.includes("--refresh");

const local = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(dataDir, "cardflip.db"));
local.exec("PRAGMA journal_mode = WAL");
let prod = null;
if (prodFlag) {
  const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
  prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
}

const CREATE = `CREATE TABLE IF NOT EXISTS en_card_text (
  id TEXT PRIMARY KEY, ptcg_id TEXT NOT NULL DEFAULT '', hp INTEGER, dex INTEGER, regulation TEXT NOT NULL DEFAULT '',
  attacks TEXT NOT NULL DEFAULT '[]', artist TEXT NOT NULL DEFAULT '', rarity TEXT NOT NULL DEFAULT '', synced_at INTEGER NOT NULL)`;
const CREATE_IDX = "CREATE INDEX IF NOT EXISTS idx_en_card_text_dex ON en_card_text(dex)";
const UPSERT = `INSERT INTO en_card_text (id, ptcg_id, hp, dex, regulation, attacks, artist, rarity, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET ptcg_id = excluded.ptcg_id, hp = excluded.hp, dex = excluded.dex, regulation = excluded.regulation,
    attacks = excluded.attacks, artist = excluded.artist, rarity = excluded.rarity, synced_at = excluded.synced_at`;
// Only sets whose cards PRINT the code (2023 onward) and have none in the catalog; older codes are PTCGO-only.
const SET_CODE_FILLS = [
  ["Black Bolt", "BLK"],
  ["White Flare", "WHT"],
  ["30th Classic Collection", "30C"],
  ["Scarlet & Violet Energy", "SVE"],
  ["SVP Black Star Promos", "SVP"],
];
// pokemontcg set id -> en_cards set_name where the names differ.
const ALIASES = { base1: "Base Set", svp: "SVP Black Star Promos", sve: "Scarlet & Violet Energy" };

async function cached(file, url) {
  const f = path.join(cacheDir, file);
  if (!refresh && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(f, text);
  return JSON.parse(text);
}

const fold = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const num = (s) => String(s ?? "").trim().toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, "$1");
const dayDiff = (a, b) => Math.abs((new Date(a) - new Date(String(b).replace(/\//g, "-"))) / 864e5);

const enSets = local.prepare("SELECT set_id, set_name, set_release_date d, set_card_count_official off, set_card_count_total tot, set_code FROM en_cards GROUP BY set_id").all();
const enRows = local.prepare("SELECT id, set_id, local_id FROM en_cards").all();
const bySet = new Map();
for (const r of enRows) {
  if (!bySet.has(r.set_id)) bySet.set(r.set_id, new Map());
  bySet.get(r.set_id).set(num(r.local_id), r.id);
}

const sets = await cached("sets.json", `${RAW}/sets/en.json`);
const now = Date.now();
const rows = [];
let mappedSets = 0, unmatched = [], landed = 0, total = 0;
for (const s of sets) {
  const alias = ALIASES[s.id];
  const cands = alias
    ? enSets.filter((e) => e.set_name === alias)
    : enSets.filter((e) => fold(e.set_name) === fold(s.name) || (dayDiff(e.d, s.releaseDate) <= 3 && (Number(e.off) === Number(s.printedTotal) || Number(e.tot) === Number(s.total))));
  const pick = cands.find((e) => alias ? true : fold(e.set_name) === fold(s.name)) ?? (cands.length === 1 ? cands[0] : null);
  if (!pick) { unmatched.push(`${s.id} ${s.name}`); continue; }
  mappedSets++;
  let cards;
  try { cards = await cached(`${s.id}.json`, `${RAW}/cards/en/${s.id}.json`); } catch (e) { console.warn("skip", s.id, e.message); continue; }
  const ids = bySet.get(pick.set_id) ?? new Map();
  for (const card of cards) {
    total++;
    const id = ids.get(num(card.number));
    if (!id) continue;
    landed++;
    const names = [...(card.attacks ?? []).map((a) => a.name), ...(card.abilities ?? []).map((a) => a.name)].filter(Boolean);
    const hp = Number(card.hp);
    rows.push([
      id,
      card.id,
      Number.isFinite(hp) && hp > 0 ? hp : null,
      Array.isArray(card.nationalPokedexNumbers) && card.nationalPokedexNumbers.length ? Number(card.nationalPokedexNumbers[0]) : null,
      card.regulationMark ?? "",
      JSON.stringify(names),
      card.artist ?? "",
      card.rarity ?? "",
      now,
    ]);
  }
}
console.log(`sets: ${mappedSets}/${sets.length} mapped${unmatched.length ? ` (unmatched: ${unmatched.join(", ")})` : ""}; cards: ${landed}/${total} land on an en_cards row`);

// Local
local.exec(CREATE);
local.exec(CREATE_IDX);
local.exec("BEGIN");
const up = local.prepare(UPSERT);
for (const r of rows) up.run(...r);
if (codesFlag) {
  const fill = local.prepare("UPDATE en_cards SET set_code = ? WHERE set_name = ? AND set_code = ''");
  for (const [name, code] of SET_CODE_FILLS) console.log(`local set code ${name} -> ${code}: ${fill.run(code, name).changes} rows`);
}
local.exec("COMMIT");
console.log(`local: ${rows.length} text rows written`);

// Prod
if (prod) {
  await prod.execute(CREATE);
  await prod.execute(CREATE_IDX);
  const stmts = rows.map((args) => ({ sql: UPSERT, args }));
  for (let i = 0; i < stmts.length; i += 200) {
    await prod.batch(stmts.slice(i, i + 200), "write");
    process.stdout.write(`prod ${Math.min(i + 200, stmts.length)}/${stmts.length}\r`);
  }
  console.log(`\nprod: ${rows.length} text rows written`);
  if (codesFlag) {
    for (const [name, code] of SET_CODE_FILLS) {
      const r = await prod.execute({ sql: "UPDATE en_cards SET set_code = ? WHERE set_name = ? AND set_code = ''", args: [code, name] });
      console.log(`prod set code ${name} -> ${code}: ${r.rowsAffected} rows`);
    }
  }
}
