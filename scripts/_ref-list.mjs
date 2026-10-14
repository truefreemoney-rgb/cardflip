// LOCAL: list the eBay referee's rows of one verdict (debugging). 10-13.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("data/cardflip.db", { readOnly: true });
for (const r of db.prepare("SELECT price_usd, label, median_usd, q75_usd, n_nm FROM ebay_asks WHERE verdict = ? ORDER BY price_usd DESC LIMIT 200 OFFSET ?").all(process.argv[2] ?? "high", Number(process.argv[3] ?? 0)))
  console.log(`$${r.price_usd} | ${r.label.slice(0, 70)} | mid ${r.median_usd} up ${r.q75_usd} n ${r.n_nm}`);
