import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const ids = { BAD: ["sv06-025", "base1-27", "dp3-38", "dp7-90"], GOOD: ["xy12-51", "bw1-65", "dp6-35"] };
for (const [tag, list] of Object.entries(ids)) for (const id of list) {
  const rows = (await db.execute({ sql: "SELECT variant, source, start_day, updated_day, prices FROM price_series WHERE card_id = ?", args: [id] })).rows;
  console.log(`== ${tag} ${id}`);
  for (const r of rows) { const p = JSON.parse(r.prices); console.log(`  ${r.source}/${r.variant} upd ${r.updated_day} n=${p.length} last14: ${p.slice(-14).map(x => x ?? "-").join(" ")}`); }
}