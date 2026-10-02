// One-off (10-01): held rows whose scan_price is the scanner's quick-sale price (88% of market)
// instead of the market ask. Inventory compared it to today's market ask and showed a 13.6% gain
// the market never made (Chris's 1st Edition Charizard: "added at $8,799.99", flat $10,000 chart).
//
//   node scripts/repair-quick-scan-prices.mjs            (dry: lists the rows)
//   node scripts/repair-quick-scan-prices.mjs --write    (prod: sets scan_price to NULL)
//
// NULL is the "not stored" state: the Inventory live refresh (lib/server/livePrices.ts) fills it
// once from the series on the add day, through the same condition math as today's price.
// The old values are written to scripts/repair-quick-scan-prices.backup.json before any write.
import { createClient } from "@libsql/client";
import fs from "node:fs";

const write = process.argv.includes("--write");
const j = JSON.parse(fs.readFileSync(new URL("../.env.migration.json", import.meta.url), "utf8"));
const db = createClient({ url: j.dbUrl, authToken: j.dbToken });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

const MULT = { "Near Mint": 1, "Lightly Played": 0.85, "Moderately Played": 0.7, "Heavily Played": 0.55, Damaged: 0.4 };
const DAY_MS = 86_400_000;
const onDay = (startDay, prices, day) => {
  const i = Math.min(Math.round((Date.parse(day) - Date.parse(startDay)) / DAY_MS), prices.length - 1);
  for (let k = i; k >= 0; k--) if (prices[k] != null) return prices[k];
  for (let k = Math.max(i, 0); k < prices.length; k++) if (prices[k] != null) return prices[k];
  return null;
};

const rows = await q("SELECT id, card_name, catalog_card_id, variant, condition, status, price, scan_price, created_at FROM cards WHERE status != 'sold' AND kind = 'card' AND catalog_card_id IS NOT NULL AND scan_price IS NOT NULL");
const hits = [];
let noSeries = 0;
for (const r of rows) {
  const series = await q("SELECT variant, start_day, prices FROM price_series WHERE card_id = ? AND source = 'tcgplayer' AND currency = 'USD'", [r.catalog_card_id]);
  if (series.length === 0) { noSeries++; continue; }
  const day = new Date(Number(r.created_at)).toISOString().slice(0, 10);
  // Any variant of the card: the row is a hit when its scan price sits at 88% of one of them that day.
  const hit = series.find((s) => {
    const then = onDay(s.start_day, JSON.parse(s.prices), day);
    if (then == null) return false;
    const conditioned = then * (MULT[r.condition] ?? 1);
    return conditioned >= 5 && Math.abs(r.scan_price - conditioned * 0.88) <= Math.max(0.06, conditioned * 0.005);
  });
  if (hit) hits.push({ id: r.id, name: r.card_name, card: r.catalog_card_id, status: r.status, price: r.price, scan_price: r.scan_price });
}
console.log(`${rows.length} held rows with a scan price, ${noSeries} without a series, ${hits.length} carry the quick-sale number`);
for (const h of hits) console.log(`  ${h.name} (${h.card}) ${h.status}: scan ${h.scan_price} vs price ${h.price}`);
if (write && hits.length) {
  fs.writeFileSync(new URL("./repair-quick-scan-prices.backup.json", import.meta.url), JSON.stringify(hits, null, 1) + "\n");
  for (const h of hits) await db.execute({ sql: "UPDATE cards SET scan_price = NULL WHERE id = ? AND scan_price = ?", args: [h.id, h.scan_price] });
  console.log(`cleared ${hits.length}; backup in scripts/repair-quick-scan-prices.backup.json`);
}
