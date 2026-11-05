import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const r of (await db.execute("SELECT key, substr(value,1,200) v FROM settings WHERE key LIKE 'social_video:%2026-11-05%' OR key LIKE 'social_tiktok:midday:2026-11-05%'")).rows) console.log(r.key, "=", r.v);