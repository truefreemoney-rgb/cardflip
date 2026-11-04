// HOLD (11-03 12:52pm ET): mark the midday slot as done on the 5 auto sites so the 1:05pm run skips it
// (its video shows Sunflora +74% / Poke Healer + +64% from one outlier sale each). Undo: node this --undo (back to 2026-11-02).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const undo = process.argv[2] === "--undo";
const val = undo ? "2026-11-02" : "2026-11-03";
const logged = (await db.execute("SELECT site FROM social_post_log WHERE day = '2026-11-03' AND slot = 'midday'")).rows.map((r) => r.site);
console.log("midday log rows before:", logged.join(",") || "none");
for (const s of ["bluesky", "x", "facebook", "instagram", "threads"]) {
  await db.execute({ sql: "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", args: [`social_slot:${s}:midday`, val, Date.now()] });
}
for (const r of (await db.execute("SELECT key, value FROM settings WHERE key LIKE 'social_slot:%:midday' AND key NOT LIKE '%claim%' AND key NOT LIKE '%failed%'")).rows) console.log(r.key, "=", r.value);
