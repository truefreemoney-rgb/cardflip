#!/usr/bin/env node
// Art versions as their own catalog cards (Chris 10-17, #11: "they all have
// different prices, hopefully catch it in the scan too").
//
//   node scripts/sync-art-versions.mjs [--prod]
//
// src/data/pokemon-art-versions.json lists each version: one set number with
// different artwork that TCGplayer sells as its own product (Vivillon xy1-17
// High Plains, Base Set Pikachu Red Cheeks, the Pokémon GO Peelable Dittos).
// For each one this writes:
//   - the twin en_cards row: the base card's set, number and totals under its
//     own id and labelled name, with TCGplayer's photo of that version;
//   - the product map: the version's product to the twin, the base product to
//     the base card (before this both products sat on one card and raced for
//     one price slot every night: xy1-17 showed High Plains' $9.40 on the
//     Meadow picture, base1-58-1st the Red Cheeks $430);
//   - today's TCGplayer price for both, the way the nightly refresh writes it
//     (lib/server/pokemonPriceRefresh.ts), so neither card sits unpriced;
//   - series whose history belongs to the other card are moved or restarted.
// Idempotent. --prod applies the same writes to Turso (.env.migration.json).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { createClient } from "@libsql/client";

const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "application/json" };
const prodFlag = process.argv.includes("--prod");
const root = process.cwd();
const versions = JSON.parse(fs.readFileSync(path.join(root, "src/data/pokemon-art-versions.json"), "utf8"));
const local = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(root, "data", "cardflip.db"));
local.exec("PRAGMA journal_mode = WAL");
let prod = null;
if (prodFlag) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));
  prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
}

async function getJson(url, attempt = 1) {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`${url} → ${res.status} after ${attempt} tries`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// Same as lib/tcgcsv.ts tcgplayerVariantKey and pokemonPriceRefresh.ts pokemonListingCap.
const variantKey = (sub) =>
  !sub ? "normal" : sub.trim().split(/\s+/).map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
const listingCap = (market, low) =>
  !(market >= 20) || low == null || !(low > 0) || market < 1.45 * low ? market : Math.min(market, Math.round(low * 1.45 * 100) / 100);
const photo = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;
const day = new Date().toISOString().slice(0, 10);

/** Series history that is the twin's, not the base card's: moved over whole. */
const MOVE = { "base1-58-1st": true };
/** Series whose recent history mixes both versions: restarted today on the right price. */
const RESTART = { "xy1-17": true };

const groupPrices = new Map();
for (const gid of new Set(versions.map((v) => v.groupId))) {
  groupPrices.set(gid, (await getJson(`https://tcgcsv.com/tcgplayer/3/${gid}/prices`)).results ?? []);
}

/** Statements, run on local then prod: [sql, args]. */
const stmts = [];
const add = (sql, ...args) => stmts.push([sql, args]);

for (const v of versions) {
  const base = local
    .prepare(
      `SELECT id, name, set_id, set_name, local_id, set_release_date, image_url,
              set_card_count_official, set_card_count_total, set_code
         FROM en_cards WHERE id = ?`,
    )
    .get(v.baseId);
  if (!base) {
    console.error(`${v.baseId} is not in en_cards (npm run sync:en / sync-first-edition first)`);
    process.exit(1);
  }
  add(
    `INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url,
                           set_card_count_official, set_card_count_total, set_code, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, set_id = excluded.set_id, set_name = excluded.set_name,
       local_id = excluded.local_id, set_release_date = excluded.set_release_date,
       image_url = excluded.image_url, set_card_count_official = excluded.set_card_count_official,
       set_card_count_total = excluded.set_card_count_total, set_code = excluded.set_code`,
    v.id, v.name, base.set_id, base.set_name, base.local_id, base.set_release_date, photo(v.productId),
    base.set_card_count_official, base.set_card_count_total, base.set_code, Date.now(),
  );
  if (v.baseImage) add("UPDATE en_cards SET image_url = ? WHERE id = ?", photo(v.baseProductId), v.baseId);
  // A saved copy of a picture the row no longer points at is the wrong art: drop it,
  // scripts/save-pictures.mjs saves the new one (own_image_src != image_url).
  add("UPDATE en_cards SET own_image_url = '', own_tile_url = '', own_image_src = '' WHERE id IN (?, ?) AND own_image_src <> '' AND own_image_src <> image_url", v.id, v.baseId);
  add("INSERT OR REPLACE INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES (?, ?, ?, 'pokemon')", v.productId, v.groupId, v.id);
  add("INSERT OR REPLACE INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES (?, ?, ?, 'pokemon')", v.baseProductId, v.groupId, v.baseId);

  // Once only: the move copies while the twin has no series and deletes only an exact copy,
  // the restart drops only history from before the fix ran (10-17).
  if (MOVE[v.baseId]) {
    add(
      `INSERT INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
         SELECT ?, game, variant, source, currency, start_day, prices, updated_day
           FROM price_series WHERE card_id = ? AND source = 'tcgplayer'
            AND NOT EXISTS (SELECT 1 FROM price_series WHERE card_id = ? AND source = 'tcgplayer')`,
      v.id, v.baseId, v.id,
    );
    add(
      `DELETE FROM price_series AS b WHERE card_id = ? AND source = 'tcgplayer' AND EXISTS (
         SELECT 1 FROM price_series t WHERE t.card_id = ? AND t.source = b.source AND t.game = b.game
            AND t.variant = b.variant AND t.start_day = b.start_day AND t.prices = b.prices)`,
      v.baseId, v.id,
    );
    // The guard's inputs read off the twin's product too: its cheapest listing and the eBay
    // referee's asks ($884 / ~$450 against Pikachu's $187 flagged it "looks off", 10-17).
    for (const t of ["listing_lows", "ebay_asks"]) add(`UPDATE OR IGNORE ${t} SET card_id = ? WHERE card_id = ? AND day <= '2026-10-17'`, v.id, v.baseId);
  }
  if (RESTART[v.baseId]) add("DELETE FROM price_series WHERE card_id IN (?, ?) AND source = 'tcgplayer' AND start_day < '2026-10-17'", v.baseId, v.id);

  // Today's point for both cards. A 1st Edition card takes only its stamped variants (refresh rule).
  for (const [cardId, productId] of [[v.id, v.productId], [v.baseId, v.baseProductId]]) {
    for (const r of groupPrices.get(v.groupId).filter((p) => p.productId === productId)) {
      const variant = variantKey(r.subTypeName);
      if (cardId.endsWith("-1st") && !variant.startsWith("1stEdition")) continue;
      if (r.marketPrice == null || !(r.marketPrice > 0)) continue;
      const price = Math.round(listingCap(r.marketPrice, r.lowPrice ?? null) * 100) / 100;
      stmts.push({ seed: true, cardId, variant, price });
      console.log(`${cardId.padEnd(24)} ${variant.padEnd(16)} $${price}`);
    }
  }
}

const ids = versions.flatMap((v) => [v.id, v.baseId]);
const purge = `DELETE FROM card_cache WHERE ${ids.map(() => "payload LIKE ?").join(" OR ")}`;
const purgeArgs = ids.map((id) => `%"${id}"%`);

/** Today's point into a series (lib/priceSeries.ts setDay): gaps fill null, today overwrites. */
function withToday(existing, price) {
  if (!existing) return { start_day: day, prices: [price] };
  const prices = JSON.parse(existing.prices);
  const i = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${existing.start_day}T00:00:00Z`)) / 86_400_000);
  if (i < 0) return { start_day: day, prices: [price] };
  while (prices.length < i) prices.push(null);
  prices[i] = price;
  return { start_day: existing.start_day, prices };
}
const SERIES_GET = "SELECT start_day, prices FROM price_series WHERE card_id = ? AND game = 'pokemon' AND variant = ? AND source = 'tcgplayer'";
const SERIES_PUT = `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
                    VALUES (?, 'pokemon', ?, 'tcgplayer', 'USD', ?, ?, ?)`;

// Local
local.exec("BEGIN");
for (const s of stmts) {
  if (s.seed) {
    const next = withToday(local.prepare(SERIES_GET).get(s.cardId, s.variant), s.price);
    local.prepare(SERIES_PUT).run(s.cardId, s.variant, next.start_day, JSON.stringify(next.prices), day);
  } else local.prepare(s[0]).run(...s[1]);
}
local.prepare(purge).run(...purgeArgs);
local.exec("COMMIT");
console.log(`local: ${versions.length} art versions synced`);

// Prod: in order, so a move lands before today's point is written over it.
if (prod) {
  for (const s of stmts) {
    if (s.seed) {
      const row = (await prod.execute({ sql: SERIES_GET, args: [s.cardId, s.variant] })).rows[0];
      const next = withToday(row ? { start_day: row.start_day, prices: row.prices } : null, s.price);
      await prod.execute({ sql: SERIES_PUT, args: [s.cardId, s.variant, next.start_day, JSON.stringify(next.prices), day] });
    } else await prod.execute({ sql: s[0], args: s[1] });
  }
  await prod.execute({ sql: purge, args: purgeArgs });
  console.log(`prod: ${versions.length} art versions synced`);
}
