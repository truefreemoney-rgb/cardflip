import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const cut = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
const t0 = Date.now();
const r = await c.execute({ sql: `SELECT c.set_id AS skey, MAX(c.set_name) AS name, SUM(v.p) AS total, COUNT(*) AS n FROM en_cards c JOIN (
   SELECT card_id, MAX(json_extract(prices, '$[#-1]')) AS p FROM price_series
    WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD' AND updated_day >= ?
      AND json_extract(prices, '$[#-1]') > 0
      AND NOT (json_extract(prices, '$[#-8]') > 0 AND json_extract(prices, '$[#-1]') >= 3 * json_extract(prices, '$[#-8]'))
    GROUP BY card_id) v ON v.card_id = c.id
  WHERE c.image_url <> '' GROUP BY c.set_id ORDER BY total DESC LIMIT 12`, args: [cut] });
console.log(`${Date.now() - t0} ms`);
for (const x of r.rows) console.log(`${x.name} | ${x.n} cards | $${Math.round(x.total).toLocaleString()}`);
