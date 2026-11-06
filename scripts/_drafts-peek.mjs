import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const v = JSON.parse((await db.execute("SELECT value FROM settings WHERE key='social_drafts:pokemon:2026-11-06'")).rows[0].value);
console.log("at", new Date(v.at).toLocaleString("en-US", { timeZone: "America/New_York" }));
for (const d of v.drafts) console.log(d.kind, "|", d.title, "|", (d.caption || "").slice(0, 120).replace(/\n/g, " "));