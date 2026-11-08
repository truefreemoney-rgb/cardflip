import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const id = (await db.execute("SELECT id FROM mtg_cards WHERE set_code='ptk' AND name='Zodiac Horse'")).rows[0].id; console.log(id);
for (const r of (await db.execute({ sql: "SELECT variant, start_day, prices FROM price_series WHERE card_id = ? AND source='tcgplayer'", args: [id] })).rows) {
  const p = JSON.parse(r.prices); const s = new Date(r.start_day + "T00:00:00Z");
  console.log(`${r.variant} | ` + p.slice(-14).map((v, i) => new Date(s.getTime() + (p.length - 14 + i) * 864e5).toISOString().slice(5, 10) + ":" + v).join(" "));
}
