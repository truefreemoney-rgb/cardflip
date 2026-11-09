import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const cols = (await db.execute("PRAGMA table_info(email_sends)")).rows.map((r) => r.name); console.log(cols.join(","));
const t = cols.find((c) => /sent_at|at$|created/.test(c));
const rows = (await db.execute({ sql: `SELECT * FROM email_sends WHERE ${t} >= ? ORDER BY ${t}`, args: [Date.UTC(2026, 10, 8, 22, 0)] })).rows;
console.log("rows", rows.length);
const by = new Map();
for (const r of rows) { const k = cols.filter((c) => /campaign|kind|status|error/.test(c)).map((c) => String(r[c]).slice(0, 80)).join(" | "); by.set(k, (by.get(k) ?? 0) + 1); }
for (const [k, n] of by) console.log(n, k);
if (rows.length) console.log("first", new Date(Number(rows[0][t])).toLocaleString("en-US", { timeZone: "America/New_York" }), "last", new Date(Number(rows[rows.length - 1][t])).toLocaleString("en-US", { timeZone: "America/New_York" }));
process.exit(0);
