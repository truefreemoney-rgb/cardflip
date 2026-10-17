import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const cols = (await c.execute("PRAGMA table_info(mtg_cards)")).rows.map((r) => r.name);
const setCol = cols.includes("set_name") ? "m.set_name" : "m.set_code";
const rs = (await c.execute(`SELECT s.card_id, s.variant, s.prices, m.name, ${setCol} AS set_name, m.set_code, m.collector_number FROM price_series s JOIN mtg_cards m ON m.id = s.card_id WHERE s.game='mtg' AND s.source='tcgplayer' AND s.currency='USD' AND s.updated_day >= date('now','-3 day') ORDER BY random() LIMIT 600`)).rows;
const out = [];
for (const r of rs) {
  const p = JSON.parse(r.prices); let v = null; for (let i = p.length - 1; i >= 0 && v == null; i--) v = p[i];
  if (v == null || v < 5) continue;
  out.push(`${r.name} | ${r.set_name} (${r.set_code}) #${r.collector_number} [${r.variant}] $${v}`);
  if (out.length >= 16) break;
}
console.log(out.join("\n"));
