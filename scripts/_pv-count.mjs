// Read-only: page views per day for the last 7 days (sizing the /pics rate-limit cost). 10-13.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const cols = (await c.execute("PRAGMA table_info(page_views)")).rows.map((r) => r.name);
console.log(cols.join(","));
const tcol = cols.find((n) => /^(at|ts|created_at|viewed_at|time)$/.test(n));
const since = Date.now() - 7 * 864e5;
if (tcol) console.log((await c.execute({ sql: `SELECT COUNT(*) n FROM page_views WHERE ${tcol} >= ?`, args: [since] })).rows);
