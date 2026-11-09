import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const et = (ms) => new Date(Number(ms)).toLocaleString("en-US", { timeZone: "America/New_York" });
const rows = (await db.execute({ sql: "SELECT day, visitor, path, at, ref, device, country, src, camp FROM page_views WHERE at >= ?", args: [Date.now() - 16 * 864e5] })).rows;
const days = [...new Set(rows.map((r) => r.day))].sort();
for (const d of days) {
  const dr = rows.filter((r) => r.day === d);
  const tally = (f) => { const m = new Map(); for (const r of dr) { const k = String(f(r) || "-").slice(0, 28); m.set(k, (m.get(k) ?? 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k}:${n}`).join(" "); };
  console.log(d, "views", dr.length, "visitors", new Set(dr.map((r) => r.visitor)).size, "| src", tally((r) => r.src), "| ref", tally((r) => r.ref), "| country", tally((r) => r.country));
}
const last = rows.sort((a, b) => Number(b.at) - Number(a.at)).slice(0, 8);
for (const r of last) console.log(et(r.at), r.path, r.device, r.country, r.src, r.ref);
const hv = (await db.execute({ sql: "SELECT day, COUNT(*) n FROM heat_views WHERE at >= ? GROUP BY day ORDER BY day", args: [Date.now() - 16 * 864e5] })).rows;
console.log("heat_views", hv.map((r) => `${String(r.day).slice(5)}=${r.n}`).join(" "));
const se = (await db.execute({ sql: "SELECT created_at a FROM sessions WHERE created_at >= ?", args: [Date.now() - 16 * 864e5] })).rows;
const m = new Map(); for (const r of se) { const d = new Date(Number(r.a)).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); m.set(d, (m.get(d) ?? 0) + 1); }
console.log("sessions created", [...m].sort().map(([d, n]) => `${d.slice(5)}=${n}`).join(" "));
for (const k of ["pokemon:top", "pokemon:dips", "mtg:sleepers"]) {
  const r = (await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [`social_video:${k}:2026-11-09`] })).rows[0];
  console.log(k, "rendered", et(JSON.parse(r.value).renderedAt));
}
const pk = (await db.execute("SELECT slot, kind, game, site, format, at FROM social_posts WHERE at >= '2026-11-09' ORDER BY at")).rows;
console.log("social_posts today", pk.length);
process.exit(0);
