// Read-only day check: social_post_log for a day, error_events since a time, board archive size.
// usage: node scripts/_day-read.mjs 2026-11-07
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const day = process.argv[2];
const et = (ms) => new Date(Number(ms)).toLocaleString("en-US", { timeZone: "America/New_York" });

const log = (await db.execute({ sql: "SELECT site, slot, kind, game, format, url, at, deleted_at FROM social_post_log WHERE day = ? ORDER BY at, site", args: [day] })).rows;
console.log(`== social_post_log ${day}: ${log.length} rows`);
for (const r of log) console.log(`${r.slot} | ${r.kind} | ${r.game} | ${r.site} | ${r.format} | ${et(r.at)} | ${String(r.url).slice(0, 70)}${r.deleted_at ? " | DELETED" : ""}`);

const ecols = (await db.execute("PRAGMA table_info(error_events)")).rows.map((r) => r.name);
const tcol = ecols.find((c) => /^(at|created_at|ts|time)$/.test(c)) || ecols[1];
const since = Date.parse(day + "T04:00:00Z");
const errs = (await db.execute({ sql: `SELECT * FROM error_events WHERE ${tcol} >= ? ORDER BY ${tcol}`, args: [since] })).rows;
console.log(`\n== error_events since ${et(since)}: ${errs.length} (cols ${ecols.join(",")})`);
const counts = new Map();
for (const e of errs) {
  const msg = ecols.filter((c) => c !== tcol && c !== "id").map((c) => String(e[c] ?? "")).join(" | ").slice(0, 260);
  const key = msg.replace(/\d+/g, "#").slice(0, 120);
  if (!counts.has(key)) { counts.set(key, 0); console.log(`${et(e[tcol])} | ${msg}`); }
  counts.set(key, counts.get(key) + 1);
}
console.log("-- repeats:"); for (const [k, n] of counts) if (n > 1) console.log(n + "x " + k);

const arch = (await db.execute("SELECT length(value) AS n FROM settings WHERE key='board_completed_archive'")).rows[0];
console.log(`\n== board_completed_archive bytes: ${arch ? arch.n : "none"}`);
const keys = (await db.execute({ sql: "SELECT key, substr(value,1,90) AS v FROM settings WHERE key LIKE ? OR key LIKE ? ORDER BY key", args: [`social_video:%:${day}`, `social_video:%:2026-11-08`] })).rows;
console.log("\n== registered videos"); for (const k of keys) console.log(k.key + " = " + k.v);
