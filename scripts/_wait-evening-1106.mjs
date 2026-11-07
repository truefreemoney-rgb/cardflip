import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const stop = Date.now() + 30 * 60_000;
for (;;) {
  const rows = (await db.execute("SELECT site, slot FROM social_post_log WHERE day = '2026-11-06' AND slot = 'evening'")).rows;
  if (rows.length >= 5 || Date.now() > stop) {
    console.log("evening rows:", rows.length, rows.map(r => r.site).join(", "));
    const cols = (await db.execute("PRAGMA table_info(social_post_log)")).rows.map(r => r.name);
    const full = (await db.execute("SELECT * FROM social_post_log WHERE day = '2026-11-06' AND slot = 'evening'")).rows;
    for (const r of full) console.log(cols.map(c => c + "=" + String(r[c]).replace(/\s+/g, " ").slice(0, 90)).join(" | "));
    break;
  }
  await new Promise(r => setTimeout(r, 60_000));
}
process.exit(0);