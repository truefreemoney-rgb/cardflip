// READ ONLY (prod): the frozen cards/leads of one TikTok slot (ids + prices), for the pre-post price check.
//   node scripts/_post-leads.mjs <morning|midday|evening> <YYYY-MM-DD>
import { createClient } from "@libsql/client";
import fs from "node:fs";
const j = JSON.parse(fs.readFileSync(new URL("../.env.migration.json", import.meta.url), "utf8").replace(/^﻿/, ""));
const db = createClient({ url: j.dbUrl, authToken: j.dbToken });
const key = `social_tiktok:${process.argv[2] ?? "morning"}:${process.argv[3]}`;
const r = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
const v = JSON.parse(String(r.rows[0].value));
console.log(key, "kind", v.kind);
for (const l of [...(v.leads ?? []), ...(v.cards ?? [])])
  console.log(JSON.stringify(Object.fromEntries(Object.entries(l).filter(([k]) => !/image|img|pic|art/i.test(k)))));
