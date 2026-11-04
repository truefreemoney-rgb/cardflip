import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const v = JSON.parse((await db.execute("SELECT value FROM settings WHERE key = 'social_video:pokemon:sleepers:2026-11-03'")).rows[0].value);
console.log(new Date(v.renderedAt).toLocaleString("en-US", { timeZone: "America/New_York" }), v.url);
for (const c of v.cards) console.log(JSON.stringify(c));
console.log(Object.keys(v).join(", "));
if (v.hand) console.log("hand:", JSON.stringify(v.hand).slice(0, 400));
