// READ ONLY (prod): social_comments by status and kind, the latest replies sent, and what waits ("Needs You").
//   node scripts/_comments-peek.mjs
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(new URL("../.env.migration.json", import.meta.url), "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
console.log("by status/kind:", JSON.stringify(await q("SELECT status, kind, COUNT(*) n FROM social_comments GROUP BY status, kind ORDER BY n DESC")));
console.log("auto reply setting:", JSON.stringify(await q("SELECT value FROM settings WHERE key = 'social_auto_reply'")));
for (const r of await q("SELECT site, at, author, substr(text,1,80) t, substr(reply_text,1,120) r FROM social_comments WHERE status = 'replied' ORDER BY acted_at DESC LIMIT 8"))
  console.log("REPLIED", r.site, r.at, r.author, "|", r.t, "=>", r.r);
for (const r of await q("SELECT site, at, kind, author, substr(text,1,90) t FROM social_comments WHERE status = 'new' ORDER BY at DESC LIMIT 15"))
  console.log("WAITING", r.site, r.at, r.kind, r.author, "|", r.t);
