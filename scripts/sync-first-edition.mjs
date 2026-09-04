#!/usr/bin/env node
// 1st Edition twins in the English mirror (Chris, 09-04: "a 1st Edition
// Charizard must be a totally different card from the normal one — its own
// price, its own stock image").
//
//   node scripts/sync-first-edition.mjs [--prod]
//
// For every card in a WotC-era set that had a 1st Edition print run, this
// writes a twin catalog row: id `<id>-1st`, set "<set> (1st Edition)", same
// number and totals. The twin is what the scanner matches when vision reads
// the stamp, what "By set" lists under its own set, and what the ledger row
// points at — so the unlimited card and the stamped card never share a price.
//
// Images: Base Set 1st Edition cards are the shadowless print, which
// TCGplayer sells as its own product line ("Base Set (Shadowless)", group
// 1663) with product photos that show the stamp — those become the twin's
// stock image, and the products are mapped to the twin so their "1st Edition
// Holofoil" prices land on it (lib/server/pokemonPriceRefresh.ts). Jungle
// through Neo Destiny share one TCGplayer product per card (1st Edition is a
// variant), so those twins keep the TCGdex image and the refresh routes the
// 1st Edition variants to the twin by id.
//
// Also moves any 1st Edition price series already recorded under a base card
// onto its twin, so history isn't lost. Idempotent; safe to re-run after
// `npm run sync:en` (which only sweeps sets that vanished upstream).
// --prod applies the same writes to Turso (.env.migration.json).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { createClient } from "@libsql/client";

const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "application/json" };
const prodFlag = process.argv.includes("--prod");
const dataDir = path.join(process.cwd(), "data");
const local = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(dataDir, "cardflip.db"));
local.exec("PRAGMA journal_mode = WAL");
let prod = null;
if (prodFlag) {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".env.migration.json"), "utf8").replace(/^﻿/, ""));
  prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
}

/** TCGdex set name → TCGplayer group whose product photos are the 1st Edition print (Base Set only). */
const SETS = {
  "Base Set": { shadowlessGroup: 1663 },
  Jungle: {},
  Fossil: {},
  "Team Rocket": {},
  "Gym Heroes": {},
  "Gym Challenge": {},
  "Neo Genesis": {},
  "Neo Discovery": {},
  "Neo Revelation": {},
  "Neo Destiny": {},
};
const SUFFIX = " (1st Edition)";

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

const normNum = (v) => String(v ?? "").split("/")[0].trim().replace(/^0+(?=\d)/, "").toLowerCase();

const UPSERT_CARD = `
  INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url,
                        set_card_count_official, set_card_count_total, set_code, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, set_id = excluded.set_id, set_name = excluded.set_name,
    local_id = excluded.local_id, set_release_date = excluded.set_release_date,
    image_url = excluded.image_url, set_card_count_official = excluded.set_card_count_official,
    set_card_count_total = excluded.set_card_count_total, set_code = excluded.set_code,
    synced_at = excluded.synced_at`;
const UPSERT_PRODUCT = `INSERT OR REPLACE INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES (?, ?, ?, 'pokemon')`;
// Move 1st Edition series recorded under a base card onto its twin.
const MOVE_SERIES = [
  `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
     SELECT card_id || '-1st', game, variant, source, currency, start_day, prices, updated_day
       FROM price_series
      WHERE game = 'pokemon' AND variant LIKE '1stEdition%' AND card_id NOT LIKE '%-1st'
        AND (card_id || '-1st') IN (SELECT id FROM en_cards)`,
  `DELETE FROM price_series
      WHERE game = 'pokemon' AND variant LIKE '1stEdition%' AND card_id NOT LIKE '%-1st'
        AND (card_id || '-1st') IN (SELECT id FROM en_cards)`,
];

const now = Date.now();
const cardRows = [];
const productRows = [];

for (const [setName, opts] of Object.entries(SETS)) {
  const base = local
    .prepare(
      `SELECT id, name, set_id, set_name, local_id, set_release_date, image_url,
              set_card_count_official, set_card_count_total, set_code
         FROM en_cards WHERE set_name = ? AND id NOT LIKE '%-1st'`,
    )
    .all(setName);
  if (base.length === 0) {
    console.error(`No rows for set "${setName}" in en_cards — is the mirror synced? (npm run sync:en)`);
    process.exit(1);
  }

  let shadowless = new Map();
  if (opts.shadowlessGroup) {
    const products = (await getJson(`https://tcgcsv.com/tcgplayer/3/${opts.shadowlessGroup}/products`)).results ?? [];
    for (const p of products) {
      const number = (p.extendedData ?? []).find((e) => e.name === "Number")?.value;
      if (!number) continue;
      shadowless.set(normNum(number), p);
    }
  }

  let withOwnImage = 0;
  for (const row of base) {
    // Base Set Machamp shipped stamped in every 2-Player Starter Set — the
    // stamp carries no premium there, so it gets no twin (lib/listing.ts
    // canBeFirstEdition carves it out the same way).
    if (setName === "Base Set" && row.name === "Machamp") continue;
    const twinId = `${row.id}-1st`;
    let image = row.image_url;
    const product = shadowless.get(normNum(row.local_id));
    if (product) {
      image = `https://tcgplayer-cdn.tcgplayer.com/product/${product.productId}_in_1000x1000.jpg`;
      productRows.push([product.productId, opts.shadowlessGroup, twinId]);
      withOwnImage++;
    }
    cardRows.push([
      twinId, row.name, `${row.set_id}-1st`, `${row.set_name}${SUFFIX}`, row.local_id, row.set_release_date,
      image, row.set_card_count_official, row.set_card_count_total, row.set_code, now,
    ]);
  }
  console.log(`${setName}: ${base.length} cards → twins${opts.shadowlessGroup ? ` (${withOwnImage} with shadowless photos)` : ""}`);
}

// Local
const upsertCard = local.prepare(UPSERT_CARD);
const upsertProduct = local.prepare(UPSERT_PRODUCT);
local.exec("BEGIN");
for (const r of cardRows) upsertCard.run(...r);
for (const r of productRows) upsertProduct.run(...r);
for (const sql of MOVE_SERIES) local.exec(sql);
local.exec("COMMIT");
console.log(`local: ${cardRows.length} twin rows, ${productRows.length} shadowless products mapped`);

// Prod
if (prod) {
  const stmts = [
    ...cardRows.map((args) => ({ sql: UPSERT_CARD, args })),
    ...productRows.map((args) => ({ sql: UPSERT_PRODUCT, args })),
  ];
  for (let i = 0; i < stmts.length; i += 200) {
    await prod.batch(stmts.slice(i, i + 200), "write");
    process.stdout.write(`prod ${Math.min(i + 200, stmts.length)}/${stmts.length}\r`);
  }
  for (const sql of MOVE_SERIES) await prod.execute(sql);
  console.log(`\nprod: ${cardRows.length} twin rows, ${productRows.length} shadowless products mapped`);
}
