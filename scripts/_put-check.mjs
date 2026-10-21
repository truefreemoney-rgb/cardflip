// ONE hand eBay sold check (lib/server/checkedPrices.ts): records it (off_day cleared) and fixes the trailing wrong stretch of
// its TCGplayer series now, the way seed-price-checks.mjs does for its list (re-running that list would switch every retired
// check back on). First used 10-21 ~3:30am ET: Base Set Charizard base1-4 blank ("looks off") after its 10-18 check retired
// on one in-band read. Local db by default; --prod = Turso; --dry = print, write nothing.
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_put-check.mjs <game> <cardId> <variant> <usd> <n> "<note>" [--prod] [--dry]
import fs from "node:fs";
import { createClient } from "@libsql/client";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { correctTail } = await import(at("lib/server/checkedPrices.ts"));
const { todayUtc } = await import(at("lib/priceSeries.ts"));

const prod = process.argv.includes("--prod");
const dry = process.argv.includes("--dry");
const [game, cardId, variant, usdArg, nArg, note] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const usd = Number(usdArg);
const n = Number(nArg);
if (!game || !cardId || !variant || !(usd > 0) || !(n >= 0) || !note) throw new Error('usage: _put-check.mjs <game> <cardId> <variant> <usd> <n> "<note>" [--prod] [--dry]');
const c = prod
  ? (() => {
      const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
      return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
    })()
  : createClient({ url: "file:data/cardflip.db" });

const today = todayUtc();
const check = { game, cardId, variant, usd, n, day: today, note: note.slice(0, 300) };
const before = (await c.execute({ sql: "SELECT * FROM price_checked WHERE game = ? AND card_id = ? AND variant = ?", args: [game, cardId, variant] })).rows[0];
console.log("check before:", before ? JSON.stringify(before) : "none");
const r = (await c.execute({ sql: "SELECT start_day, prices FROM price_series WHERE card_id = ? AND game = ? AND variant = ? AND source = 'tcgplayer' AND currency = 'USD'", args: [cardId, game, variant] })).rows[0];
const prices = r ? JSON.parse(String(r.prices)) : [];
const fixed = r ? correctTail(String(r.start_day), prices, check, today) : { prices, changed: false, raw: null };
const changed = fixed.prices.filter((v, i) => v !== prices[i]).length;
console.log(`${cardId} ${variant} -> $${usd} (${today}): ${changed} points fixed; tail ${JSON.stringify(prices.slice(-6))} -> ${JSON.stringify(fixed.prices.slice(-6))}`);
if (dry) {
  console.log("dry run: nothing written");
  process.exit(0);
}
await c.execute({
  sql: `INSERT OR REPLACE INTO price_checked (game, card_id, variant, usd, n, day, note, tcg_usd, tcg_day, off_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  args: [game, cardId, variant, usd, n, today, check.note, fixed.raw, fixed.raw == null ? null : today],
});
if (fixed.changed) {
  await c.execute({
    sql: "UPDATE price_series SET prices = ? WHERE card_id = ? AND game = ? AND variant = ? AND source = 'tcgplayer' AND currency = 'USD'",
    args: [JSON.stringify(fixed.prices), cardId, game, variant],
  });
}
console.log("check after:", JSON.stringify((await c.execute({ sql: "SELECT * FROM price_checked WHERE game = ? AND card_id = ? AND variant = ?", args: [game, cardId, variant] })).rows[0]));
