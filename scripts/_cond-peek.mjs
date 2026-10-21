// READ ONLY: condition of recent scans on prod for the owner + named accounts (Chris 10-21: "everything is showing up lightly played").
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const sample = (await c.execute("SELECT created_at, typeof(created_at) t FROM cards ORDER BY rowid DESC LIMIT 2")).rows;
console.log("created_at sample:", JSON.stringify(sample));
const emails = ["truefreemoney@gmail.com", "wageleymarketing@gmail.com", "jporter1421@gmail.com"];
const since = typeof sample[0]?.created_at === "number" ? Date.now() - 3 * 864e5 : new Date(Date.now() - 3 * 864e5).toISOString();
for (const e of emails) {
  const u = (await c.execute({ sql: "SELECT id FROM users WHERE lower(email) = ?", args: [e] })).rows[0];
  if (!u) { console.log(e, "no account"); continue; }
  const rows = (await c.execute({ sql: "SELECT condition, COUNT(*) n, MAX(created_at) last FROM cards WHERE user_id = ? AND created_at >= ? GROUP BY condition", args: [u.id, since] })).rows;
  const ever = (await c.execute({ sql: "SELECT condition, COUNT(*) n FROM cards WHERE user_id = ? GROUP BY condition", args: [u.id] })).rows;
  console.log(`${e}: last 3 days ${JSON.stringify(rows.map((r) => [r.condition, r.n, r.last]))} | all time ${JSON.stringify(ever.map((r) => [r.condition, r.n]))}`);
}
const all = (await c.execute({ sql: "SELECT condition, COUNT(*) n FROM cards WHERE created_at >= ? GROUP BY condition ORDER BY n DESC", args: [since] })).rows;
console.log("ALL users, last 3 days:", JSON.stringify(all.map((r) => [r.condition, r.n])));
// timeline: per ET hour, conditions (all users, last 3 days)
const tl = (await c.execute({ sql: "SELECT created_at, condition, user_id FROM cards WHERE created_at >= ? ORDER BY created_at", args: [since] })).rows;
const byHour = {};
for (const r of tl) { const k = new Date(Number(r.created_at)).toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "numeric" }); byHour[k] ??= {}; const s = (r.condition || "?").split(" ").map((w) => w[0]).join(""); byHour[k][s] = (byHour[k][s] || 0) + 1; }
console.log("\nper ET hour:"); for (const [k, v] of Object.entries(byHour)) console.log(" ", k, JSON.stringify(v));
