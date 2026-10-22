// Read-only SELECT on prod (Turso) or the local db: node scripts/_sql-ro.mjs [--prod] "SELECT ..." ["SELECT ..."]
// Refuses anything that is not a single SELECT/PRAGMA statement.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const prod = process.argv.includes("--prod");
const sqls = process.argv.slice(2).filter((a) => a !== "--prod");
const c = prod
  ? (() => { const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, "")); return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken }); })()
  : createClient({ url: "file:data/cardflip.db" });
for (const sql of sqls) {
  if (!/^\s*(select|pragma|with)\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error(`refused (read-only): ${sql}`);
  const r = await c.execute(sql);
  console.log(`-- ${sql.slice(0, 120)}\n${r.rows.length} row(s)`);
  for (const row of r.rows.slice(0, 200)) console.log(JSON.stringify(row));
}
