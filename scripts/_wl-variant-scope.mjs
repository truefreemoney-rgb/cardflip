// READ ONLY (prod): watchlist rows whose saved price matches a different printing than the default one now quoted
// (10-21: Legendary Collection Pikachu saved at the reverse holo $1,574.99, now read as the Normal $6.70 = "down 100%").
//   node scripts/_wl-variant-scope.mjs
import { createClient } from "@libsql/client";
import fs from "node:fs";
const j = JSON.parse(fs.readFileSync(new URL("../.env.migration.json", import.meta.url), "utf8").replace(/^﻿/, ""));
const db = createClient({ url: j.dbUrl, authToken: j.dbToken });
const rows = (await db.execute("SELECT id, user_id, card_id, game, card_name, set_name, card_number, price, alert_price, added_at FROM wishlist_items WHERE card_id IS NOT NULL AND price > 0")).rows;
const ids = [...new Set(rows.map((r) => String(r.card_id)))];
const latest = new Map(); // card_id -> [{variant, price}]
for (let i = 0; i < ids.length; i += 300) {
  const chunk = ids.slice(i, i + 300);
  const s = await db.execute({ sql: `SELECT card_id, variant, prices FROM price_series WHERE currency = 'USD' AND source <> 'pricecharting' AND card_id IN (${chunk.map(() => "?").join(",")})`, args: chunk });
  for (const r of s.rows) {
    let arr;
    try { arr = JSON.parse(String(r.prices)); } catch { continue; }
    let last = null;
    for (let k = arr.length - 1; k >= 0; k--) if (arr[k] != null) { last = arr[k]; break; }
    if (last == null) continue;
    const list = latest.get(String(r.card_id)) ?? [];
    list.push({ variant: String(r.variant), price: Number(last) });
    latest.set(String(r.card_id), list);
  }
}
const ORDER = ["normal", "holofoil", "reverseHolofoil"];
let checked = 0;
const bad = [];
for (const r of rows) {
  const vs = latest.get(String(r.card_id));
  if (!vs || vs.length < 2) continue;
  checked++;
  const saved = Number(r.price);
  const def = [...vs].sort((a, b) => ((ORDER.indexOf(a.variant) + 1) || 99) - ((ORDER.indexOf(b.variant) + 1) || 99))[0];
  const near = [...vs].sort((a, b) => Math.abs(Math.log(a.price / saved)) - Math.abs(Math.log(b.price / saved)))[0];
  if (near.variant !== def.variant && Math.abs(Math.log(def.price / saved)) > Math.log(3) && Math.abs(Math.log(near.price / saved)) < Math.log(1.6))
    bad.push({ card: r.card_id, name: `${r.card_name} ${r.set_name} ${r.card_number}`, saved, default: `${def.variant} $${def.price}`, matches: `${near.variant} $${near.price}`, alert: r.alert_price, owner: String(r.user_id).slice(0, 6) });
}
console.log(`rows ${rows.length}, multi-printing ${checked}, saved on another printing ${bad.length}, with an alert set ${bad.filter((b) => b.alert != null).length}`);
for (const b of bad) console.log(JSON.stringify(b));
