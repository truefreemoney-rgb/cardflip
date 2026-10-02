// Read-only on prod: how many cards the price guard marks STALE today (flat 45+ days, shown with a note since 10-02),
// the evidence for a paid sold-price feed later. One full read of the TCGplayer USD series (billed row reads: run by hand, not on a cron).
//   node --experimental-strip-types --no-warnings scripts/.stale-count-tmp.mjs [game]
import fs from "node:fs";
import { createClient } from "@libsql/client";
import { priceTrust } from "../src/lib/server/priceTrust.ts";
import { decodePrices } from "../src/lib/priceSeries.ts";

const game = process.argv[2] ?? "pokemon";
const j = JSON.parse(fs.readFileSync(new URL("../.env.migration.json", import.meta.url), "utf8"));
const db = createClient({ url: j.dbUrl, authToken: j.dbToken });
const rows = (await db.execute({ sql: "SELECT card_id, variant, prices FROM price_series WHERE game = ? AND source = 'tcgplayer' AND currency = 'USD'", args: [game] })).rows;
const last = (p) => { for (let i = p.length - 1; i >= 0; i--) if (p[i] != null) return p[i]; return null; };
const stale = [];
let priced100 = 0;
for (const r of rows) {
  const prices = decodePrices(String(r.prices));
  const to = last(prices);
  if (to == null || to < 100) continue;
  priced100++;
  // Series only (no Cardmarket, no siblings): the hard tests that need them cannot fire here, so this is the upper bound of the stale pool.
  const v = priceTrust({ to, prices });
  if (v.stale != null) stale.push({ id: String(r.card_id), variant: String(r.variant), price: to, days: v.stale });
}
stale.sort((a, b) => b.price - a.price);
console.log(`${game}: ${rows.length} USD series, ${priced100} at $100+, ${stale.length} stale (flat 45+ days)`);
for (const s of stale.slice(0, 25)) console.log(`  ${s.id} ${s.variant} $${s.price} flat ${s.days}d`);
