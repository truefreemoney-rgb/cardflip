// Hand eBay sold checks (lib/server/checkedPrices.ts): records each check and fixes the trailing wrong stretch of its
// TCGplayer series now (the nightly writers keep it fixed from then on). Local db by default; --prod = Turso
// (.env.migration.json); --dry = print before/after, write nothing.
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/seed-price-checks.mjs [--prod] [--dry]
import fs from "node:fs";
import { createClient } from "@libsql/client";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { correctTail } = await import(at("lib/server/checkedPrices.ts"));
const { todayUtc } = await import(at("lib/priceSeries.ts"));

const prod = process.argv.includes("--prod");
const dry = process.argv.includes("--dry");
const c = prod
  ? (() => {
      const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
      return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
    })()
  : createClient({ url: "file:data/cardflip.db" });

const DAY = "2026-10-18";
// eBay sold, raw only (no slabs), checked by hand in the pane 10-18.
const CHECKS = [
  { game: "pokemon", cardId: "xy0-26", variant: "normal", usd: 43, n: 3, note: "Snorlax Kalos Starter Set: NM sold 42.42/45/45.44, LP 25-30; TCGplayer 64.88" },
  { game: "pokemon", cardId: "gym2-3-1st", variant: "1stEditionHolofoil", usd: 200, n: 0, note: "Brock's Ninetales 1st Ed: NM sold steady 175-255 for two months; TCGplayer 260.50" },
  { game: "pokemon", cardId: "hgssp-HGSS17", variant: "holofoil", usd: 23.33, n: 5, note: "Minun HGSS17: NM sold 23.33 x5 this week, 29.99; TCGplayer 39.25 (79.95 before)" },
  { game: "pokemon", cardId: "bw10-105", variant: "holofoil", usd: 122, n: 9, note: "Rare Candy Plasma Blast 105: Oct sold 66.64-149.99, median 121.99; TCGplayer 191.88 flat for months" },
];

await c.execute(`CREATE TABLE IF NOT EXISTS price_checked (
    game TEXT NOT NULL,
    card_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    usd REAL NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    day TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    tcg_usd REAL,
    tcg_day TEXT,
    off_day TEXT,
    PRIMARY KEY (game, card_id, variant)
  )`);

const today = todayUtc();
console.log(`${prod ? "PROD" : "local"}${dry ? " (dry run)" : ""}, today ${today}`);
for (const k of CHECKS) {
  const check = { ...k, day: DAY };
  const r = (await c.execute({ sql: "SELECT start_day, prices FROM price_series WHERE card_id = ? AND game = ? AND variant = ? AND source = 'tcgplayer' AND currency = 'USD'", args: [k.cardId, k.game, k.variant] })).rows[0];
  if (!r) {
    console.log(`  ${k.cardId} ${k.variant}: NO TCGplayer series, check recorded only`);
  }
  const prices = r ? JSON.parse(String(r.prices)) : [];
  const fixed = r ? correctTail(String(r.start_day), prices, check, today) : { prices, changed: false, raw: null };
  const n = fixed.prices.filter((v, i) => v !== prices[i]).length;
  console.log(`  ${k.cardId} ${k.variant} -> $${k.usd}: ${n} points fixed; tail ${JSON.stringify(prices.slice(-8))} -> ${JSON.stringify(fixed.prices.slice(-8))}`);
  if (dry) continue;
  await c.execute({
    sql: `INSERT OR REPLACE INTO price_checked (game, card_id, variant, usd, n, day, note, tcg_usd, tcg_day, off_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    args: [k.game, k.cardId, k.variant, k.usd, k.n, DAY, k.note, fixed.raw, fixed.raw == null ? null : today],
  });
  if (fixed.changed) {
    await c.execute({
      sql: "UPDATE price_series SET prices = ? WHERE card_id = ? AND game = ? AND variant = ? AND source = 'tcgplayer' AND currency = 'USD'",
      args: [JSON.stringify(fixed.prices), k.cardId, k.game, k.variant],
    });
  }
}
console.log(dry ? "dry run: nothing written" : "done");
