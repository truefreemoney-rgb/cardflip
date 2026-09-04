#!/usr/bin/env node
// Art Series cards into the Magic mirror. Scryfall's search hides "extras"
// (tokens, art series, emblems) unless asked, so sync-mtg.mjs never saw
// them and a scanned art card matched whatever real card shared a word
// (Chris, 09-03 MTG stress test: "they have art cards … still valuable").
//
//   node scripts/sync-mtg-art.mjs [--prod]
//
// Same row shape and upsert as sync-mtg.mjs. Writes the local mirror; with
// --prod also upserts straight into Turso (.env.migration.json), so prod
// doesn't wait on the next seed export. sync-mtg.mjs calls this at the end
// of a full sync so the rows survive its stale-row sweep.
//
// Scryfall prices art cards in EUR only (usd null); the gold-signature
// variant is the "foil" finish. Unpriced in USD for now — a known gap.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { createClient } from "@libsql/client";

const API = "https://api.scryfall.com";
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "application/json" };
const PAGE_DELAY_MS = 120;
const prodFlag = process.argv.includes("--prod");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function getJson(url, attempt = 1) {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`${url} → ${res.status} after ${attempt} tries`);
    await sleep(1000 * attempt);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const dataDir = path.join(process.cwd(), "data");
const local = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(dataDir, "cardflip.db"));
local.exec("PRAGMA journal_mode = WAL");
let prod = null;
if (prodFlag) {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".env.migration.json"), "utf8").replace(/^﻿/, ""));
  prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
}

const UPSERT = `
  INSERT INTO mtg_cards (
    id, oracle_id, name, set_code, set_name, collector_number, set_release_date,
    image_url, rarity, type_line, finishes, lang,
    price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, set_code = excluded.set_code, set_name = excluded.set_name,
    collector_number = excluded.collector_number, set_release_date = excluded.set_release_date,
    image_url = CASE WHEN excluded.image_url = '' THEN mtg_cards.image_url ELSE excluded.image_url END,
    rarity = excluded.rarity, type_line = excluded.type_line, finishes = excluded.finishes,
    lang = excluded.lang, price_usd = excluded.price_usd, price_usd_foil = excluded.price_usd_foil,
    price_usd_etched = excluded.price_usd_etched, price_eur = excluded.price_eur,
    price_eur_foil = excluded.price_eur_foil, synced_at = excluded.synced_at`;
const upsertLocal = local.prepare(UPSERT);

function imageOf(card) {
  const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris ?? null;
  return uris?.normal ?? uris?.large ?? uris?.small ?? "";
}
function rowOf(c, now) {
  // Art cards are stored double-faced with the same name on both faces
  // ("Delivery Moogle // Delivery Moogle"); keep the single name — that's
  // what's printed and what vision reads.
  const name = c.name.includes(" // ") && c.name.split(" // ")[0] === c.name.split(" // ")[1] ? c.name.split(" // ")[0] : c.name;
  return [
    c.id, c.oracle_id ?? "", name, c.set, c.set_name ?? c.set.toUpperCase(), c.collector_number, c.released_at ?? "",
    imageOf(c), c.rarity ?? "", c.type_line ?? "Art Series", Array.isArray(c.finishes) ? c.finishes.join(",") : "", c.lang ?? "en",
    num(c.prices?.usd), num(c.prices?.usd_foil), num(c.prices?.usd_etched), num(c.prices?.eur), num(c.prices?.eur_foil), now,
  ];
}

const now = Date.now();
const query = encodeURIComponent("game:paper lang:en layout:art_series include:extras");
let url = `${API}/cards/search?q=${query}&unique=prints&order=set&page=1`;
let total = 0;
const sets = new Set();
const prodBatch = [];
while (url) {
  const json = await getJson(url);
  const rows = json.data ?? [];
  local.exec("BEGIN");
  for (const c of rows) {
    if (!c.set || !c.collector_number || !c.name) continue;
    const row = rowOf(c, now);
    upsertLocal.run(...row);
    prodBatch.push({ sql: UPSERT, args: row });
    sets.add(c.set);
  }
  local.exec("COMMIT");
  total += rows.length;
  url = json.has_more ? json.next_page : null;
  if (url) await sleep(PAGE_DELAY_MS);
}
console.log(`local: ${total} art cards across ${sets.size} sets`);

if (prod) {
  for (let i = 0; i < prodBatch.length; i += 200) {
    await prod.batch(prodBatch.slice(i, i + 200), "write");
  }
  console.log(`prod: upserted ${prodBatch.length} rows`);
}
