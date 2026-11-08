import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
console.log((await db.execute("PRAGMA table_info(mtg_cards)")).rows.map(r=>r.name).join(","));
for (const id of ["5cdcc324-1427-453c-9940-c21f5d04c997","e4dbd98c-5d78-4a15-995e-6baee2116f5d"]) {
  const r = (await db.execute({ sql: "SELECT * FROM mtg_cards WHERE id = ?", args: [id] })).rows[0];
  console.log(JSON.stringify(r, (k, v) => typeof v === "string" && v.length > 120 ? v.slice(0, 120) : v).slice(0, 900));
}
