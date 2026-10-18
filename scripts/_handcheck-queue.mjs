import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const r = await c.execute("SELECT verdict, manual IS NULL AS open, COUNT(*) n FROM ebay_asks GROUP BY verdict, open");
console.log(JSON.stringify(r.rows));
const q = await c.execute("SELECT game, card_id, variant, price_usd, median_usd, q75_usd, n, n_nm, label, day FROM ebay_asks WHERE verdict = 'check' AND manual IS NULL ORDER BY price_usd DESC LIMIT 40");
for (const x of q.rows) console.log(`${x.game} ${x.card_id} ${x.variant} $${x.price_usd} | asks med $${x.median_usd} q75 $${x.q75_usd} n${x.n}/${x.n_nm} | ${String(x.label).slice(0, 60)} | ${x.day}`);
