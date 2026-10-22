// Read-only (prod): scan_usage rows since a day, model + cost per read kind. node scripts/_scan-usage-peek.mjs [YYYY-MM-DD]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const since = process.argv[2] ?? "2026-10-22";
const cols = (await c.execute("PRAGMA table_info(scan_usage)")).rows.map((r) => r.name);
console.log("cols:", cols.join(", "));
// `at` is a ms epoch.
const rows = (await c.execute({ sql: "SELECT * FROM scan_usage WHERE at >= ? ORDER BY at DESC LIMIT 400", args: [Date.parse(`${since}T00:00:00Z`)] })).rows;
console.log(`rows since ${since}: ${rows.length}`);
const by = new Map();
for (const r of rows) {
  const k = `${r.model ?? "?"} | ${String(r.read ?? r.kind ?? "").slice(0, 40)}`;
  const e = by.get(k) ?? { n: 0, cost: 0, inTok: 0 };
  e.n++;
  e.cost += Number(r.cost_micros ?? 0);
  e.inTok += Number(r.input_tokens ?? 0);
  by.set(k, e);
}
for (const [k, e] of [...by].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(e.n).padStart(4)}  avg $${(e.cost / e.n / 1e6).toFixed(4)}  avg in ${(e.inTok / e.n).toFixed(0)}  ${k}`);
console.log("newest 3:", JSON.stringify(rows.slice(0, 3)));
