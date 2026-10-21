// READ ONLY: is the 10-21 wave still going (error_events per 10 min, newest), and which of its IPs are Tor exits.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const et = (t) => new Date(Number(t)).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const since = Date.now() - 3 * 3600_000;
const ev = await c.execute({ sql: "SELECT at, level, message FROM error_events WHERE at > ? ORDER BY at", args: [since] });
const buckets = new Map();
for (const r of ev.rows) {
  const b = Math.floor(Number(r.at) / 600_000) * 600_000;
  const kind = /Cannot find module|Failed to handle/.test(r.message) ? "encoded-path" : /shut out/.test(r.message) ? "shut-out" : "other";
  const x = buckets.get(b) ?? { "encoded-path": 0, "shut-out": 0, other: 0 };
  x[kind]++;
  buckets.set(b, x);
}
console.log(`error_events last 3 h: ${ev.rows.length}; newest ${ev.rows.length ? et(ev.rows.at(-1).at) : "-"} ET; now ${et(Date.now())} ET`);
for (const [b, x] of buckets) console.log(" ", et(b), JSON.stringify(x));
const others = ev.rows.filter((r) => !/Cannot find module|Failed to handle|shut out/.test(r.message));
console.log("other kinds:", [...new Set(others.map((r) => String(r.message).slice(0, 90)))].slice(0, 12));
const paths = new Map();
for (const r of ev.rows) {
  const m = /Failed to handle (\S+)/.exec(r.message);
  if (m) paths.set(m[1], (paths.get(m[1]) ?? 0) + 1);
}
console.log("encoded paths:", JSON.stringify([...paths].sort((a, b) => b[1] - a[1]).slice(0, 20)));

const ips = process.argv.slice(2);
if (ips.length) {
  const res = await fetch("https://check.torproject.org/torbulkexitlist", { signal: AbortSignal.timeout(15000) });
  const tor = new Set((await res.text()).split(/\s+/).filter(Boolean));
  console.log(`\nTor exit list: ${tor.size} IPs`);
  for (const ip of ips) console.log(" ", ip, tor.has(ip) ? "TOR EXIT" : "not tor");
}
