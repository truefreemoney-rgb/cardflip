// READ ONLY (prod): every price_series row for one card id (source, variant, start, last points).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await c.execute({ sql: "SELECT source, variant, currency, start_day, prices FROM price_series WHERE card_id = ?", args: [process.argv[2]] })).rows;
for (const r of rows) {
  const p = JSON.parse(String(r.prices));
  const priced = p.filter((v) => v != null);
  console.log(`${r.source}/${r.variant}/${r.currency} start ${r.start_day} len ${p.length} priced ${priced.length} | last ${JSON.stringify(p.slice(-6))}`);
}
const ask = (await c.execute({ sql: "SELECT variant, price_usd, median_usd, n, verdict, manual, day FROM ebay_asks WHERE card_id = ?", args: [process.argv[2]] })).rows;
console.log("ebay_asks:", JSON.stringify(ask));
