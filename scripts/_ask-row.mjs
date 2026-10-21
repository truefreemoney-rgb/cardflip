// READ ONLY (prod): the full ebay_asks + price_checked + price_checks rows for card ids. node scripts/_ask-row.mjs id...
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const id of process.argv.slice(2)) {
  for (const t of ["ebay_asks", "price_checked", "price_checks"]) {
    try {
      const rows = (await c.execute({ sql: `SELECT * FROM ${t} WHERE card_id = ?`, args: [id] })).rows;
      console.log(`${id} ${t}: ${JSON.stringify(rows)}`);
    } catch (e) { console.log(`${id} ${t}: ERR ${e.message}`); }
  }
}
