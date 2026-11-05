import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const t = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%card%' OR name LIKE '%price%')")).rows.map(r => r.name);
console.log(t.join(", "));
for (const tb of t) {
  const cols = (await db.execute(`PRAGMA table_info(${tb})`)).rows.map(r => r.name);
  const k = cols.includes("card_id") ? "card_id" : cols.includes("id") ? "id" : null;
  if (!k) continue;
  try { const rows = (await db.execute({ sql: `SELECT * FROM ${tb} WHERE ${k} = ? LIMIT 3`, args: ["xyp-XY96"] })).rows;
    for (const r of rows) console.log(tb, JSON.stringify(r).slice(0, 700)); } catch (e) { }
}