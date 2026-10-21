// Set one account's non-Near-Mint scans to Near Mint (Chris 10-21: "change her cards to near mint" after the photo
// condition bug, ae3c1f32). Sold rows are left alone. Writes a backup of every changed row first.
//   node scripts/_cond-to-nm.mjs <email> [--since=<ms>] [--go]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const email = process.argv[2]?.toLowerCase();
const since = Number(process.argv.find((a) => a.startsWith("--since="))?.slice(8) ?? 0);
const go = process.argv.includes("--go");
const u = (await c.execute({ sql: "SELECT id FROM users WHERE lower(email) = ?", args: [email] })).rows[0];
if (!u) throw new Error("no account " + email);
const rows = (await c.execute({ sql: "SELECT id, card_name, condition, status, price, price_locked, created_at FROM cards WHERE user_id = ? AND condition != 'Near Mint' AND status != 'sold' AND created_at >= ? ORDER BY created_at", args: [u.id, since] })).rows;
const tally = {}; for (const r of rows) tally[`${r.condition} / ${r.status}${r.price_locked ? " / locked" : ""}`] = (tally[`${r.condition} / ${r.status}${r.price_locked ? " / locked" : ""}`] || 0) + 1;
console.log(`${email}: ${rows.length} rows to set Near Mint`, JSON.stringify(tally));
for (const r of rows.slice(0, 5)) console.log("  e.g.", r.card_name, "|", r.condition, "|", r.status, "| $" + r.price);
if (!go || !rows.length) process.exit(0);
const file = `.cond-backup-${email.split("@")[0]}-${Date.now()}.json`;
fs.writeFileSync(file, JSON.stringify(rows, null, 1));
const ids = rows.map((r) => r.id);
const res = await c.execute({ sql: `UPDATE cards SET condition = 'Near Mint' WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`, args: [u.id, ...ids] });
console.log(`updated ${res.rowsAffected} rows; backup ${file}`);
