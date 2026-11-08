import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const r0 = (await db.execute("SELECT id, collector_number, promo_types, frame_effects, border_color FROM mtg_cards WHERE set_code='inr' AND name LIKE 'Gisela, the Broken Blade%'")).rows; console.log(JSON.stringify(r0));
for (const id of ["ygo-244965", ...r0.map(x => x.id)]) for (const r of (await db.execute({ sql: "SELECT card_id, variant, start_day, prices FROM price_series WHERE (card_id = ? OR card_id LIKE ?) AND source='tcgplayer'", args: [id, id + "-%"] })).rows) {
  const p = JSON.parse(r.prices); const s = new Date(r.start_day + "T00:00:00Z");
  console.log(`${r.card_id.slice(0,14)} ${r.variant} | ` + p.slice(-12).map((v, i) => new Date(s.getTime() + (p.length - 12 + i) * 864e5).toISOString().slice(5, 10) + ":" + v).join(" "));
}
