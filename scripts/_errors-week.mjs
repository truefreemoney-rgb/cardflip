// READ ONLY: prod error_events, last 7 days, grouped by message head.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const cols = (await c.execute("PRAGMA table_info(error_events)")).rows.map((r) => r.name);
console.log("cols:", cols.join(","));
const tcol = cols.find((n) => /^(at|created_at|ts|last_at|last_seen)$/.test(n)) ?? cols.find((n) => /_at$/.test(n));
const since = Date.now() - 7 * 86400e3;
const rows = (await c.execute({ sql: `SELECT * FROM error_events WHERE ${tcol} >= ? ORDER BY ${tcol} DESC`, args: [since] })).rows;
const et = (t) => new Date(Number(t)).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const g = {};
for (const r of rows) {
  const msg = String(r.message ?? r.msg ?? r.error ?? JSON.stringify(r)).replace(/\s+/g, " ").slice(0, 110);
  const k = msg.replace(/\/cards\/[^ "]+/g, "/cards/…");
  g[k] ??= { n: 0, last: 0, first: Infinity, ex: msg };
  g[k].n += Number(r.count ?? 1); g[k].last = Math.max(g[k].last, Number(r[tcol])); g[k].first = Math.min(g[k].first, Number(r[tcol]));
}
console.log(`rows since ${et(since)}: ${rows.length}`);
for (const [k, v] of Object.entries(g).sort((a, b) => b[1].last - a[1].last)) console.log(`${v.n}x  last ${et(v.last)}  first ${et(v.first)} | ${v.ex}`);
