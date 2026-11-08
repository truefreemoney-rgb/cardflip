import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const r of (await db.execute("SELECT key, substr(value,1,160) v FROM settings WHERE key LIKE '%2026-11-08%' OR key LIKE 'social_plan%' OR key LIKE '%cap_pause%' ORDER BY key")).rows) console.log(r.key, "=", r.v);
