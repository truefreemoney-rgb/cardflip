import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const id of process.argv.slice(2)) {
  const rows = (await db.execute({ sql: "SELECT variant, source, start_day, updated_day, prices FROM price_series WHERE card_id = ? AND source='tcgplayer'", args: [id] })).rows;
  for (const r of rows) { const p = JSON.parse(r.prices); console.log(id, r.variant, r.updated_day, "last 14:", p.slice(-14).join(" ")); }
  const pc = (await db.execute({ sql: "SELECT * FROM price_checked WHERE card_id = ?", args: [id] })).rows;
  for (const r of pc) console.log("  checked", JSON.stringify(r).slice(0, 250));
}