// Read-only: the registered social videos for a day, with their frozen cards.
// usage: node scripts/_videos-day.mjs 2026-11-08
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const day = process.argv[2];
const et = (ms) => new Date(Number(ms)).toLocaleString("en-US", { timeZone: "America/New_York" });
const rows = (await db.execute({ sql: "SELECT key, value FROM settings WHERE key LIKE ? ORDER BY key", args: [`social_video:%:${day}`] })).rows;
for (const r of rows) {
  const v = JSON.parse(String(r.value));
  console.log(`\n== ${r.key}  made ${v.at ? et(v.at) : "?"}  ${String(v.url).split("/").pop()}`);
  const { url, at, ...rest } = v;
  console.log(JSON.stringify(rest, null, 1).slice(0, 3000));
}
const ref = JSON.parse(String((await db.execute("SELECT value FROM price_history_meta WHERE key = 'ebay_referee_last'")).rows[0].value));
const { sellerFloor, ...r2 } = ref;
console.log("\n== referee last: " + JSON.stringify(r2).slice(0, 700));
