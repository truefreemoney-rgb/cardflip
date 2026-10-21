// LOCAL READ ONLY: the ebay_asks and price_checked rows of one card in data/cardflip.db.
//   node scripts/_local-ask-row.mjs <card-id>
import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("data/cardflip.db");
const id = process.argv[2];
console.log("ebay_asks", JSON.stringify(d.prepare("SELECT game, variant, price_usd, median_usd, n, day, manual, manual_price, manual_day FROM ebay_asks WHERE card_id = ?").all(id)));
console.log("price_checked", JSON.stringify(d.prepare("SELECT * FROM price_checked WHERE card_id = ?").all(id)));
