import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const id of []) console.log(id, JSON.stringify((await db.execute({ sql: "SELECT product_id FROM tcgplayer_products WHERE card_id = ?", args: [id] })).rows));
for (const id of ["b7919474-db2b-441a-b368-9e430ddf70ab","5cdcc324-1427-453c-9940-c21f5d04c997"]) {
  for (const r of (await db.execute({ sql: "SELECT source, variant, start_day, prices FROM price_series WHERE card_id = ?", args: [id] })).rows) {
    const p = JSON.parse(r.prices); const s = new Date(r.start_day + "T00:00:00Z");
    console.log(`${id.slice(0, 12)} ${r.source} ${r.variant} | ` + p.slice(-20).map((v, i) => new Date(s.getTime() + (p.length - 20 + i) * 864e5).toISOString().slice(5, 10) + ":" + v).join(" "));
  }
}


