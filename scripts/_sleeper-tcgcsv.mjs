import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
console.log((await db.execute("PRAGMA table_info(tcgplayer_products)")).rows.map(r => r.name).join(","));
const want = { "sv06-025": "holofoil", "base1-27": "normal", "dp3-38": "normal", "dp7-90": "normal", "xy12-51": "normal", "bw1-65": "holofoil", "dp6-35": "normal" };
const rows = (await db.execute(`SELECT * FROM tcgplayer_products WHERE card_id IN (${Object.keys(want).map(k => `'${k}'`).join(",")})`)).rows;
const H = { "User-Agent": "cardflip-price-check" };
const groups = new Map();
for (const r of rows) { const g = r.group_id; if (!groups.has(g)) groups.set(g, (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${g}/prices`, { headers: H })).json()).results); }
for (const r of rows) {
  const ps = groups.get(r.group_id).filter(p => p.productId === Number(r.product_id));
  console.log(r.card_id, want[r.card_id], ps.map(p => `${p.subTypeName}: low ${p.lowPrice} mid ${p.midPrice} mkt ${p.marketPrice} dlow ${p.directLowPrice}`).join(" | "));
}