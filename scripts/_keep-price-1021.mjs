// One-off 10-21 ~4:05am ET (Chris: "handle it in your own recommendation"): the keeps made in /admin/prices bind to the
// referee's last-read price (manual_price = price_usd, +-10%); Codie and Palkia were eBay-checked at TCGplayer's price
// today, which has moved off that read. Point the keep at the price the check confirmed.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const SET = [["mtg", "53015f09-fcb8-448e-baf3-36524f4217a7", "foil", 198.05], ["pokemon", "col1-SL8", "holofoil", 289.99]];
for (const [g, id, v, p] of SET) {
  const r = await c.execute({ sql: "UPDATE ebay_asks SET manual_price = ? WHERE game = ? AND card_id = ? AND variant = ? AND manual = 'keep'", args: [p, g, id, v] });
  console.log(id, v, "->", p, "rows", r.rowsAffected);
}
for (const id of ["col1-33", "ex10-105", "3ae4a761-6203-419c-8d49-499b6e74252c", "53015f09-fcb8-448e-baf3-36524f4217a7", "col1-SL8"]) {
  const r = (await c.execute({ sql: "SELECT card_id, variant, price_usd, manual, manual_price, manual_day FROM ebay_asks WHERE card_id = ? AND manual IS NOT NULL", args: [id] })).rows;
  console.log(JSON.stringify(r));
}
