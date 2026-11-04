import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const x of (await db.execute("SELECT key, substr(value,1,300) v FROM settings WHERE (key LIKE '%2026-11-03%' OR key LIKE 'social_hand%') ORDER BY key")).rows) console.log(x.key, "=", x.v);
