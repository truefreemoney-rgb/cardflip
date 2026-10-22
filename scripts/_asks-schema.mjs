// Read-only: ebay_asks schema + verdict counts by day (prod). node scripts/_asks-schema.mjs
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
console.log((await c.execute("SELECT sql FROM sqlite_master WHERE name = 'ebay_asks'")).rows[0]?.sql);
const cols = (await c.execute("PRAGMA table_info(ebay_asks)")).rows.map((r) => r.name);
console.log("cols:", cols.join(", "));
const dayCol = cols.find((n) => /day|date/.test(n)) ?? cols[0];
const verdictCol = cols.find((n) => /verdict/.test(n));
if (verdictCol) {
  const r = await c.execute(`SELECT ${dayCol} d, ${verdictCol} v, COUNT(*) n FROM ebay_asks GROUP BY 1, 2 ORDER BY 1 DESC, 2 LIMIT 40`);
  for (const x of r.rows) console.log(x.d, x.v, x.n);
}
console.log("total", (await c.execute("SELECT COUNT(*) n FROM ebay_asks")).rows[0].n);
console.log("sample", JSON.stringify((await c.execute("SELECT * FROM ebay_asks ORDER BY rowid DESC LIMIT 2")).rows));
