import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const leb = (await db.execute("SELECT id FROM mtg_cards WHERE set_code='leb' AND name='Lifeforce'")).rows[0].id; console.log("leb", leb);
console.log(JSON.stringify((await db.execute("SELECT product_id FROM tcgplayer_products WHERE card_id='hgss1-16'")).rows));
for (const id of ["ygo-80791", leb, "hgss1-16"]) for (const r of (await db.execute({ sql: "SELECT card_id, source, variant, start_day, prices FROM price_series WHERE (card_id = ? OR card_id LIKE ?) AND source='tcgplayer'", args: [id, id + "-%"] })).rows) {
  const p = JSON.parse(r.prices); const s = new Date(r.start_day + "T00:00:00Z");
  console.log(`${r.card_id.slice(0,14)} ${r.variant} | ` + p.slice(-12).map((v, i) => new Date(s.getTime() + (p.length - 12 + i) * 864e5).toISOString().slice(5, 10) + ":" + v).join(" "));
}
