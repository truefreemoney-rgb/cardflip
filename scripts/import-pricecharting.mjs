// PriceCharting nightly import (10-18; ready before the subscription, see docs/PRICECHARTING-DAY1.md).
// Reads a price-guide CSV (a file, or downloaded with the link from pricecharting.com > Subscriptions >
// API/Download, set as PRICECHARTING_CSV_URL_<GAME> in .env.local), matches each product to our printing
// (lib/pricecharting.ts planPcImport) and writes today's ungraded price to price_series source 'pricecharting'
// (our own history: PriceCharting only serves current values) plus one pc_products row per product.
// Screens ignore source 'pricecharting' until the PC-first switch is made on purpose (priceHistory.ts / enCards.ts).
//
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs \
//   scripts/import-pricecharting.mjs --game pokemon|mtg|yugioh [--file guide.csv] [--dry] [--prod --fenced] [--day YYYY-MM-DD]
// --prod needs --fenced: only after the commit that hides 'pricecharting' rows from the readers is live.
// Their limits: one CSV download per 10 minutes, regenerated every 24 h. Data must be purged if the subscription ends.
import fs from "node:fs";
import { createClient } from "@libsql/client";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { readPriceGuide, planPcImport, lorcanaKey } = await import(at("lib/pricecharting.ts"));
const { setDay, todayUtc, decodePrices, encodePrices } = await import(at("lib/priceSeries.ts"));

const args = process.argv.slice(2);
const arg = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const game = arg("--game");
const prod = args.includes("--prod");
const dry = args.includes("--dry");
if (!["pokemon", "mtg", "yugioh", "lorcana", "onepiece"].includes(game)) throw new Error("--game pokemon|mtg|yugioh|lorcana|onepiece");
if (prod && !args.includes("--fenced")) throw new Error("--prod needs --fenced: push the reader fence first (priceHistory.ts / enCards.ts ignore source 'pricecharting')");
const day = arg("--day") ?? todayUtc();

const c = prod
  ? (() => {
      const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
      return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
    })()
  : createClient({ url: "file:data/cardflip.db" });

async function csvText() {
  const file = arg("--file");
  if (file) return fs.readFileSync(file, "utf8");
  try {
    process.loadEnvFile(".env.local");
  } catch {
    /* no .env.local */
  }
  const url = process.env[`PRICECHARTING_CSV_URL_${game.toUpperCase()}`];
  if (!url) throw new Error(`no --file and no PRICECHARTING_CSV_URL_${game.toUpperCase()} (copy the CSV link from pricecharting.com > Subscriptions > API/Download)`);
  const res = await fetch(url, { headers: { "user-agent": "CardFlip price import (support@cardflip.io)" } });
  if (!res.ok) throw new Error(`PriceCharting CSV: HTTP ${res.status}`);
  const text = await res.text();
  if (!dry) fs.writeFileSync(`data/pricecharting-${game}-${day}.csv`, text); // kept locally for re-runs and the day-1 rescore
  return text;
}

const products = readPriceGuide(await csvText());
console.log(`${prod ? "PROD" : "local"}${dry ? " (dry run)" : ""} ${game} ${day}: ${products.length} PriceCharting products`);

// Matching context.
const variants = new Map();
for (const r of (await c.execute({ sql: "SELECT card_id, variant FROM price_series WHERE game = ? AND source = 'tcgplayer' AND currency = 'USD'", args: [game] })).rows) {
  const id = String(r.card_id);
  if (!variants.has(id)) variants.set(id, new Set());
  variants.get(id).add(String(r.variant));
}
const byTcg = new Map();
const addTcg = (tcg, cardId) => {
  const k = String(tcg);
  if (!byTcg.has(k)) byTcg.set(k, []);
  if (!byTcg.get(k).includes(cardId)) byTcg.get(k).push(cardId);
};
let cards;
if (game === "pokemon") {
  for (const r of (await c.execute("SELECT product_id, card_id FROM tcgplayer_products WHERE game = 'pokemon'")).rows) addTcg(r.product_id, String(r.card_id));
  cards = new Set((await c.execute("SELECT id FROM en_cards")).rows.map((r) => String(r.id)));
} else if (game === "mtg") {
  // Scryfall uuid -> TCGplayer id, rebuilt nightly on Chris's PC (scripts/mtg-tcgplayer-ids.mjs).
  const ids = JSON.parse(fs.readFileSync("data/mtg-tcgplayer-ids.json", "utf8"));
  for (const [uuid, tcg] of Object.entries(ids)) addTcg(tcg, uuid);
  cards = new Set(Object.keys(ids));
} else if (game === "yugioh") {
  cards = new Set((await c.execute("SELECT id FROM tcg_cards WHERE game = 'yugioh'")).rows.map((r) => String(r.id)));
} else {
  // Lorcana / One Piece: by name (lib/pricecharting.ts lorcanaKey; One Piece "code|printing tag").
  const rows = (await c.execute({ sql: "SELECT id, name, subtitle, set_name, collector_number, variant FROM tcg_cards WHERE game = ?", args: [game] })).rows;
  cards = new Set(rows.map((r) => String(r.id)));
  for (const r of rows) {
    const key = game === "lorcana"
      ? lorcanaKey(String(r.set_name), String(r.collector_number), `${r.name}${r.subtitle ? ` - ${r.subtitle}` : ""}`)
      : `${r.collector_number}|${r.variant ?? ""}`;
    addTcg(key, String(r.id));
  }
}
const ctx = { cardsOfTcg: (t) => byTcg.get(String(t)) ?? [], cardsOfKey: (k) => byTcg.get(k) ?? [], variantsOf: (id) => variants.get(id) ?? new Set(), hasCard: (id) => cards.has(id) };

const { writes, skipped } = planPcImport(game, products, ctx);
console.log(`matched ${writes.length}; skipped ${JSON.stringify(skipped)}`);
for (const w of writes.slice(0, 5)) console.log(`  e.g. ${w.cardId} ${w.variant} $${w.usd} (pc ${w.pcId}, ${w.salesVolume} sales/yr)`);
if (dry) process.exit(0);

await c.execute(`CREATE TABLE IF NOT EXISTS pc_products (
  pc_id TEXT PRIMARY KEY, game TEXT NOT NULL, card_id TEXT NOT NULL, variant TEXT NOT NULL, tcg_id TEXT,
  loose REAL, graded9 REAL, psa10 REAL, sales_volume INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL)`);
await c.execute("CREATE INDEX IF NOT EXISTS idx_pc_products_card ON pc_products(card_id, variant)");

// Today's point onto each printing's PriceCharting series.
const existing = new Map();
for (const r of (await c.execute({ sql: "SELECT card_id, variant, start_day, prices FROM price_series WHERE game = ? AND source = 'pricecharting'", args: [game] })).rows) {
  existing.set(`${r.card_id}|${r.variant}`, { startDay: String(r.start_day), prices: decodePrices(String(r.prices)) });
}
const BATCH = 400;
let seriesWritten = 0;
for (let i = 0; i < writes.length; i += BATCH) {
  const chunk = writes.slice(i, i + BATCH);
  const rows = chunk.map((w) => {
    const row = setDay(existing.get(`${w.cardId}|${w.variant}`) ?? null, day, w.usd);
    return [w.cardId, game, w.variant, "pricecharting", "USD", row.startDay, encodePrices(row.prices), day];
  });
  await c.execute({
    sql: `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
    args: rows.flat(),
  });
  await c.execute({
    sql: `INSERT OR REPLACE INTO pc_products (pc_id, game, card_id, variant, tcg_id, loose, graded9, psa10, sales_volume, day) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
    args: chunk.flatMap((w) => [w.pcId, game, w.cardId, w.variant, w.tcgId, w.usd, w.graded9, w.psa10, w.salesVolume, day]),
  });
  seriesWritten += chunk.length;
}
console.log(`wrote ${seriesWritten} PriceCharting series points + products for ${day}`);
