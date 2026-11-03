import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const cols = (await db.execute("PRAGMA table_info(social_comments)")).rows.map((r) => r.name);
console.log(cols.join(", "));
const t = cols.find((c) => /^(at|created_at|seen_at|first_seen_at)$/.test(c)) || "rowid";
const rows = (await db.execute(`SELECT * FROM social_comments ORDER BY ${t} DESC LIMIT 8`)).rows;
for (const r of rows) console.log(cols.map((c) => c + "=" + String(r[c]).replace(/\s+/g, " ").slice(0, 90)).join(" | "));
