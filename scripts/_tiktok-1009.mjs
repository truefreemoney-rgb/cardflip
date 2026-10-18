import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const r = await c.execute("SELECT at, views, likes, comments, shares, substr(replace(text, char(10), ' '), 1, 90) t FROM social_posts WHERE site='tiktok' AND at >= '2026-10-08' AND at < '2026-10-12' ORDER BY at");
for (const row of r.rows) console.log(String(row.at).slice(0, 16), "views", row.views, "likes", row.likes, "|", row.t);
