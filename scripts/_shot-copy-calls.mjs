// LOCAL ONLY write (prod is read with SELECT): copy a few prod admin calls + their TCGplayer series into data/cardflip.db
// so a local /admin/prices shot shows real cases (10-21, 387e78ef shots). Neither table is in push-catalog's list.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const local = new DatabaseSync("data/cardflip.db");
const ids = process.argv.slice(2);
for (const id of ids) {
  for (const r of (await prod.execute({ sql: "SELECT * FROM ebay_asks WHERE card_id = ?", args: [id] })).rows) {
    const cols = Object.keys(r);
    local.prepare(`INSERT OR REPLACE INTO ebay_asks (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((k) => r[k]));
    console.log("ask", id, r.variant, r.manual, r.manual_price);
  }
  for (const r of (await prod.execute({ sql: "SELECT * FROM price_series WHERE card_id = ? AND source = 'tcgplayer'", args: [id] })).rows) {
    const cols = Object.keys(r);
    local.prepare(`INSERT OR REPLACE INTO price_series (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((k) => r[k]));
    console.log("series", id, r.variant);
  }
}
