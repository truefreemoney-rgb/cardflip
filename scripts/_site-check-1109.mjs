import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const et = (ms) => new Date(Number(ms)).toLocaleString("en-US", { timeZone: "America/New_York" });
const dayEt = (ms) => new Date(Number(ms)).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const since = Date.now() - 4 * 864e5;
const games = (await db.execute("SELECT game, MAX(updated_day) d, COUNT(*) n FROM price_series GROUP BY game")).rows;
for (const g of games) {
  const f = (await db.execute({ sql: "SELECT COUNT(*) n FROM price_series WHERE game = ? AND updated_day = ?", args: [g.game, g.d] })).rows[0];
  console.log(`price_series ${g.game}: last day ${g.d}, rows ${g.n}, on last day ${f.n}`);
}
const ll = (await db.execute("SELECT game, MAX(day) d, COUNT(*) n FROM listing_lows GROUP BY game")).rows;
for (const g of ll) console.log(`listing_lows ${g.game}: last ${g.d}, rows ${g.n}`);
for (const [t, c] of [["users", "created_at"], ["signup_log", "at"], ["scan_usage", "at"], ["trial_scans", "at"]]) {
  const rows = (await db.execute({ sql: `SELECT "${c}" a FROM "${t}" WHERE "${c}" >= ?`, args: [Date.now() - 30 * 864e5] })).rows;
  const by = new Map();
  for (const r of rows) { const d = dayEt(r.a); by.set(d, (by.get(d) ?? 0) + 1); }
  console.log(`${t} last 30d (${rows.length}):`, [...by].sort().slice(-14).map(([d, n]) => `${d.slice(5)}=${n}`).join(" "));
}
const sc = (await db.execute("SELECT * FROM social_comments ORDER BY at DESC LIMIT 3")).rows;
for (const r of sc) console.log("comment", r.at, r.platform ?? r.site ?? "", String(r.text ?? r.body ?? "").slice(0, 60));
const errs = (await db.execute({ sql: "SELECT at, source, level, message FROM error_events WHERE at >= ? AND NOT message LIKE 'social:%' AND NOT message LIKE 'stage:%' ORDER BY at DESC LIMIT 60", args: [since] })).rows;
console.log("non-social errors 4d", errs.length);
for (const e of errs) console.log(et(e.at), "|", e.source, e.level, "|", String(e.message).replace(/\s+/g, " ").slice(0, 220));
const app = (await db.execute("SELECT key, substr(value,1,160) v FROM app_settings WHERE key LIKE '%cron%' OR key LIKE '%last_run%' OR key LIKE '%referee%' OR key LIKE '%refresh%' ORDER BY key LIMIT 40").catch(() => ({ rows: [] }))).rows;
for (const r of app) console.log("setting", r.key, r.v);
const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows.map((r) => r.name);
console.log(tables.join(" "));
process.exit(0);
