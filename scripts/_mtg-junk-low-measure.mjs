// READ ONLY (prod): Magic printings whose cheapest live listing (listing_lows) sits far under the uncapped TCGplayer
// market (Scryfall mtg_cards), so the 10-13 listing cap takes the price down to that listing (AUDIT-10-16: "no floor
// on a junk $1 listing"). node scripts/_mtg-junk-low-measure.mjs [minRatio=5]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const minRatio = Number(process.argv[2] ?? 5);
const lows = (await c.execute("SELECT l.card_id, l.variant, l.low_usd, l.day, m.name, m.set_code, m.collector_number, m.price_usd, m.price_usd_foil, m.price_eur, m.price_eur_foil, m.set_release_date FROM listing_lows l JOIN mtg_cards m ON m.id = l.card_id WHERE l.game = 'mtg' AND l.day >= date('now', '-3 days')")).rows;
const rows = [];
for (const r of lows) {
  const market = r.variant === "foil" ? r.price_usd_foil : r.price_usd;
  if (market == null || !(Number(market) >= 10) || !(Number(r.low_usd) > 0)) continue;
  const ratio = Number(market) / Number(r.low_usd);
  if (ratio >= 1.5) rows.push({ ...r, market: Number(market), low: Number(r.low_usd), ratio });
}
const big = rows.filter((x) => x.ratio >= minRatio).sort((a, b) => b.market - a.market);
console.log(`capped Magic printings (market >= $10, >= 1.5x the low): ${rows.length}; of them >= ${minRatio}x the low: ${big.length}`);
const band = (lo, hi) => rows.filter((x) => x.ratio >= lo && x.ratio < hi).length;
console.log(`ratio bands: 1.5-2x ${band(1.5, 2)} | 2-3x ${band(2, 3)} | 3-5x ${band(3, 5)} | 5-10x ${band(5, 10)} | 10x+ ${band(10, Infinity)}`);
console.log(`low under $2 with market $20+: ${rows.filter((x) => x.low < 2 && x.market >= 20).length}`);
// The row holds the CAPPED number, so the uncapped market is gone; Cardmarket (EUR, ~1.1 USD) is the outside check.
const eurOf = (r) => Number(r.variant === "foil" ? r.price_eur_foil : r.price_eur) || 0;
const atLow = lows.map((r) => ({ ...r, price: Number(r.variant === "foil" ? r.price_usd_foil : r.price_usd), low: Number(r.low_usd), eurUsd: eurOf(r) * 1.1 })).filter((r) => r.price > 0 && r.price >= 10 && (Math.abs(r.price - r.low) < 0.005 || Math.abs(r.price - Math.round(r.low * 145) / 100) < 0.005));
const under = atLow.filter((r) => r.eurUsd >= 3 * r.price).sort((a, b) => b.eurUsd - a.eurUsd);
console.log(`\nprices sitting AT the cap (= the low, or 1.45x it), $10+: ${atLow.length}; Cardmarket says 3x+ more: ${under.length}`);
for (const x of under.slice(0, 20)) console.log(`  ours $${x.price} (low $${x.low}) vs Cardmarket ~$${x.eurUsd.toFixed(2)}  ${x.name} | ${x.set_code} ${x.collector_number} [${x.variant}]`);
const cheap = lows.map((r) => ({ ...r, price: Number(r.variant === "foil" ? r.price_usd_foil : r.price_usd), low: Number(r.low_usd), eurUsd: eurOf(r) * 1.1 })).filter((r) => r.price > 0 && r.price < 10 && Math.abs(r.price - r.low) < 0.005 && r.eurUsd >= 10 && r.eurUsd >= 4 * r.price);
console.log(`\ncapped UNDER $10 (cap only starts at $10 market) and Cardmarket $10+ and 4x+: ${cheap.length}`);
for (const x of cheap.sort((a, b) => b.eurUsd - a.eurUsd).slice(0, 15)) console.log(`  ours $${x.price} (low $${x.low}) vs Cardmarket ~$${x.eurUsd.toFixed(2)}  ${x.name} | ${x.set_code} ${x.collector_number} [${x.variant}]`);
for (const x of big.slice(0, 25)) console.log(`${x.ratio.toFixed(1)}x  market $${x.market} -> low $${x.low}  ${x.name} | ${x.set_code} ${x.collector_number} [${x.variant}] ${x.set_release_date}`);
