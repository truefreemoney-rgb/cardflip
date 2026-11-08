import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const id of ["5cdcc324-1427-453c-9940-c21f5d04c997","e4dbd98c-5d78-4a15-995e-6baee2116f5d","gym1-63-1st","base1-31-1st"]) {
  for (const r of (await db.execute({ sql: "SELECT source, variant, start_day, prices FROM price_series WHERE card_id = ?", args: [id] })).rows) {
    const p = JSON.parse(r.prices); const s = new Date(r.start_day + "T00:00:00Z");
    const tail = p.slice(-16).map((v, i) => new Date(s.getTime() + (p.length - 16 + i) * 864e5).toISOString().slice(5, 10) + ":" + v).join(" ");
    console.log(`${id.slice(0, 12)} ${r.source} ${r.variant} | ${tail}`);
  }
}
