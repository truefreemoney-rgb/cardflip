// READ ONLY (prod): Pokémon TCGplayer lines whose LAST point breaks the listing cap (pokemonPriceRefresh.pokemonListingCap:
// from $20, a market at 1.45x+ the cheapest listing reads 1.45x that listing). The nightly tcgcsv refresh writes capped
// points, so an uncapped last point came from somewhere else (10-21: the name-search recorder and the daily held-card sweep
// write pokemontcg.io's raw market after the refresh). node scripts/_uncapped-lines.mjs
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const lows = new Map();
for (const r of (await c.execute("SELECT card_id, variant, low_usd, day FROM listing_lows WHERE game = 'pokemon' AND day >= date('now','-3 days')")).rows) lows.set(`${r.card_id}|${r.variant}`, Number(r.low_usd));
const held = new Set((await c.execute("SELECT DISTINCT catalog_card_id AS catalog_id FROM cards WHERE game = 'pokemon' AND catalog_card_id IS NOT NULL")).rows.map((r) => r.catalog_id));
const rows = (await c.execute("SELECT card_id, variant, start_day, updated_day, prices FROM price_series WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD' AND updated_day >= date('now','-3 days')")).rows;
let checked = 0, broken = 0, brokenHeld = 0, brokenToday = 0; const list = [];
for (const r of rows) {
  const k = `${r.card_id}|${r.variant}`; const low = lows.get(k); if (low == null) continue;
  const p = JSON.parse(String(r.prices)); let v = null, idx = -1; for (let j = p.length - 1; j >= 0; j--) if (p[j] != null) { v = p[j]; idx = j; break; }
  if (v == null) continue; checked++;
  const cap = v >= 20 && low > 0 && v >= 1.45 * low ? Math.min(v, Math.round(low * 1.45 * 100) / 100) : v;
  if (cap < v - 0.01) { broken++; if (held.has(r.card_id)) brokenHeld++; if (r.updated_day === new Date().toISOString().slice(0, 10)) brokenToday++; list.push({ k, v, low, cap, day: r.updated_day, held: held.has(r.card_id), prev: p.slice(Math.max(0, idx - 3), idx) }); }
}
console.log(`lines with a fresh listing low ${checked}; last point over the cap ${broken} (held by a user ${brokenHeld}; written today UTC ${brokenToday})`);
list.sort((a, b) => b.v - a.v);
for (const x of list.slice(0, 25)) console.log(`${x.k}\tlast ${x.v}\tcap ${x.cap}\tlow ${x.low}\t${x.day}${x.held ? "\tHELD" : ""}\tprev ${JSON.stringify(x.prev)}`);
