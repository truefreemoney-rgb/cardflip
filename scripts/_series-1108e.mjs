import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
console.log("xyp-XY153", JSON.stringify((await db.execute("SELECT product_id FROM tcgplayer_products WHERE card_id = 'xyp-XY153'")).rows));
for (const id of ["ygo-58640","lea-8","xyp-XY153"]) for (const r of (await db.execute({ sql: "SELECT card_id, source, variant, start_day, prices FROM price_series WHERE card_id = ? OR card_id LIKE ?", args: [id, id + "%"] })).rows) {
  const p = JSON.parse(r.prices); const s = new Date(r.start_day + "T00:00:00Z");
  console.log(`${r.card_id} ${r.source} ${r.variant} | ` + p.slice(-14).map((v, i) => new Date(s.getTime() + (p.length - 14 + i) * 864e5).toISOString().slice(5, 10) + ":" + v).join(" "));
}
const m = (await db.execute("SELECT id, set_code, collector_number FROM mtg_cards WHERE set_code='lea' AND name='Blue Ward'")).rows; console.log(JSON.stringify(m));
