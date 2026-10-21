// READ ONLY (prod): price_history_meta values by key (LIKE patterns ok). node scripts/_meta-peek.mjs daily_last_result 'mtg%'
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const k of process.argv.slice(2)) {
  const rows = (await c.execute({ sql: "SELECT key, value FROM price_history_meta WHERE key LIKE ?", args: [k] })).rows;
  for (const r of rows) console.log(`${r.key}: ${String(r.value).slice(0, 3000)}`);
}
