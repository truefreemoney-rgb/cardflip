// Scratch: read-only. Waits until 6:42pm ET 11-08 (23:42 UTC), then reports tonight's Sunday mail sends.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const at = Date.UTC(2026, 10, 8, 23, 42);
if (Date.now() < at) await new Promise((r) => setTimeout(r, at - Date.now()));
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const since = Date.UTC(2026, 10, 8, 22, 0);
const rows = (await db.execute({ sql: "SELECT campaign, status, COUNT(*) n, MIN(sent_at) a, MAX(sent_at) b FROM email_sends WHERE sent_at >= ? GROUP BY 1, 2", args: [since] })).rows;
const et = (ms) => new Date(Number(ms)).toLocaleString("en-US", { timeZone: "America/New_York" });
for (const r of rows) console.log(r.campaign, r.status, r.n, et(r.a), et(r.b));
if (!rows.length) console.log("no sends since 5pm ET");
const errs = (await db.execute({ sql: "SELECT error, COUNT(*) n FROM email_sends WHERE sent_at >= ? AND error IS NOT NULL GROUP BY 1", args: [since] })).rows;
for (const e of errs) console.log("ERROR", e.n, String(e.error).slice(0, 200));
process.exit(0);
