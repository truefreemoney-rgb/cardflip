import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const et = (ms) => new Date(Number(ms)).toLocaleString("en-US", { timeZone: "America/New_York" });
const dayEt = (ms) => new Date(Number(ms)).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
for (const t of ["page_views", "heat_views", "sessions", "help_messages", "price_reports", "pending_watches", "wishlist_items", "card_photos", "price_checked"]) {
  const cols = (await db.execute(`PRAGMA table_info("${t}")`)).rows.map((r) => r.name);
  console.log(t, "cols:", cols.join(","));
}
const pvCols = (await db.execute(`PRAGMA table_info(page_views)`)).rows.map((r) => r.name);
const c = pvCols.find((x) => /^(at|ts|created_at|viewed_at)$/.test(x));
if (c) {
  const rows = (await db.execute({ sql: `SELECT "${c}" a FROM page_views WHERE "${c}" >= ?`, args: [Date.now() - 14 * 864e5] })).rows;
  const by = new Map(); for (const r of rows) { const d = dayEt(r.a); by.set(d, (by.get(d) ?? 0) + 1); }
  console.log("page_views/day", [...by].sort().map(([d, n]) => `${d.slice(5)}=${n}`).join(" "));
} else {
  const s = (await db.execute("SELECT * FROM page_views ORDER BY rowid DESC LIMIT 3")).rows; console.log(s);
}
const set = (await db.execute("SELECT key, substr(value,1,180) v FROM settings WHERE key LIKE '%cron%' OR key LIKE '%last%' OR key LIKE '%health%' OR key LIKE '%uptime%' OR key LIKE '%alert%' OR key LIKE 'tiktok%' OR key LIKE 'social_autopilot%' ORDER BY key LIMIT 70")).rows;
for (const r of set) console.log("setting", r.key, "=", r.v);
const today = "2026-11-09";
const sv = (await db.execute({ sql: "SELECT key, substr(value,1,260) v FROM settings WHERE key LIKE ?", args: [`social_video:%:${today}`] })).rows;
for (const r of sv) console.log(r.key, r.v);
const sp = (await db.execute("PRAGMA table_info(social_posts)")).rows.map((r) => r.name); console.log("social_posts", sp.join(","));
process.exit(0);
