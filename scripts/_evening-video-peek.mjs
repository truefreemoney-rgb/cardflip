import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const v = JSON.parse((await db.execute("SELECT value FROM settings WHERE key='social_video:pokemon:thennow:2026-11-06'")).rows[0].value);
console.log(JSON.stringify(v.cards), "plan", v.plan, "rendered", new Date(v.renderedAt).toLocaleString("en-US", { timeZone: "America/New_York" }));
const rows = (await db.execute("SELECT site, url, at FROM social_post_log WHERE day='2026-11-06' AND slot='evening'")).rows;
for (const r of rows) console.log(r.site, r.url);