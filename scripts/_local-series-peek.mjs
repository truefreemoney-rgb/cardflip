// LOCAL READ ONLY: every price_series row for one card id in data/cardflip.db (compare with _series-peek.mjs on prod).
//   node scripts/_local-series-peek.mjs <card-id>
import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("data/cardflip.db");
for (const r of d.prepare("SELECT source, variant, start_day, prices FROM price_series WHERE card_id = ?").all(process.argv[2])) {
  const p = JSON.parse(String(r.prices));
  console.log(`${r.source}/${r.variant} start ${r.start_day} len ${p.length} | last ${JSON.stringify(p.slice(-6))}`);
}
