import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const id of ["ex7-3","dp5-8"]) console.log(id, JSON.stringify((await db.execute({ sql: "SELECT product_id FROM tcgplayer_products WHERE card_id = ?", args: [id] })).rows));
for (const id of ["8d693da0-039d-462b-a5cb-d2bb179df65e","1eb501cc-0f83-40ca-8987-424bbee5f584","ex7-3","dp5-8"]) {
  for (const r of (await db.execute({ sql: "SELECT source, variant, start_day, prices FROM price_series WHERE card_id = ?", args: [id] })).rows) {
    const p = JSON.parse(r.prices); const s = new Date(r.start_day + "T00:00:00Z");
    console.log(`${id.slice(0, 12)} ${r.source} ${r.variant} | ` + p.slice(-12).map((v, i) => new Date(s.getTime() + (p.length - 12 + i) * 864e5).toISOString().slice(5, 10) + ":" + v).join(" "));
  }
}
