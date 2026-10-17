import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const flagged = new Set(JSON.parse(fs.readFileSync(process.argv[2], "utf8")).map((f) => f.id + "|" + f.variant));
const rs = (await c.execute("SELECT s.card_id, s.variant, s.prices, e.name, e.set_name, e.local_id FROM price_series s JOIN en_cards e ON e.id = s.card_id WHERE s.game='pokemon' AND s.source='tcgplayer' AND s.currency='USD' AND s.updated_day >= date('now','-3 day') ORDER BY random() LIMIT 400")).rows;
const out = [];
for (const r of rs) {
  const p = JSON.parse(r.prices); let v = null; for (let i = p.length - 1; i >= 0 && v == null; i--) v = p[i];
  if (v == null || v < 5 || flagged.has(r.card_id + "|" + r.variant)) continue;
  out.push(`${r.name} | ${r.set_name} ${r.local_id} [${r.variant}] $${v}  (${r.card_id})`);
  if (out.length >= 16) break;
}
console.log(out.join("\n"));
