// READ ONLY (prod): one SELECT / WITH statement, refused otherwise. node scripts/_sql-ro.mjs "SELECT ..."
import fs from "node:fs";
import { createClient } from "@libsql/client";
const sql = (process.argv[2] ?? "").trim();
if (!/^(select|with)\b/i.test(sql) || /;\s*\S/.test(sql) || /\b(insert|update|delete|drop|alter|replace|create|attach|pragma|vacuum)\b/i.test(sql)) {
  console.error("refused: one SELECT/WITH only");
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await c.execute(sql)).rows;
for (const r of rows.slice(0, 200)) console.log(JSON.stringify(r));
console.log(`${rows.length} rows`);
