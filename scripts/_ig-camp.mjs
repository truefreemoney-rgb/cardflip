// READ ONLY: what ad-campaign visitors did on the site (page_views + signups by campaign).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const since = process.argv[2] ?? "2026-10-28";
const camps = (await c.execute({ sql: "SELECT camp, src, device, COUNT(DISTINCT visitor) v FROM page_views WHERE day >= ? AND camp LIKE 'ig%' GROUP BY camp, src, device ORDER BY camp", args: [since] })).rows;
console.log("== landings by campaign"); for (const r of camps) console.log(r.camp, r.src, r.device, r.v);
const paths = (await c.execute({ sql: `SELECT p.visitor, l.camp, COUNT(DISTINCT p.path) n, group_concat(p.path, ' > ') ps, MIN(p.at) a, MAX(p.at) b
  FROM page_views p JOIN (SELECT DISTINCT day, visitor, camp FROM page_views WHERE day >= ? AND camp LIKE 'ig%') l ON l.day = p.day AND l.visitor = p.visitor
  GROUP BY p.visitor, l.camp ORDER BY a`, args: [since] })).rows;
console.log("== each ad visitor's pages");
for (const r of paths) console.log(r.camp, new Date(Number(r.a)).toLocaleTimeString("en-US", { timeZone: "America/New_York" }), `${Math.round((Number(r.b) - Number(r.a)) / 1000)}s`, r.n, "|", String(r.ps).slice(0, 200));
const cols = (await c.execute("PRAGMA table_info(users)")).rows.map((r) => r.name);
const campCol = cols.find((n) => /camp/.test(n));
if (campCol) {
  const s = (await c.execute({ sql: `SELECT ${campCol} camp, COUNT(*) n FROM users WHERE created_at >= ? AND ${campCol} LIKE 'ig%' GROUP BY 1`, args: [since] })).rows;
  console.log("== signups by campaign"); for (const r of s) console.log(r.camp, r.n);
} else console.log("users columns:", cols.join(","));
