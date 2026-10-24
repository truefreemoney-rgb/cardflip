// Read-only (10-24): One Piece promo prices (optcgapi) vs TCGplayer market (tcgcsv cat 68 group 17675), matched by
// product name + card number. Measures how far the feed drifts before anything is changed. -> data/op-promo-drift-2026-10-24.json
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const H = { headers: { "User-Agent": "CardFlip/1.0 (support@cardflip.io)" } };
const API = "https://tcgcsv.com/tcgplayer/68/17675";
const products = (await (await fetch(`${API}/products`, H)).json()).results;
const prices = (await (await fetch(`${API}/prices`, H)).json()).results;
const fold = (s) => String(s).toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
const numOf = (p) => p.extendedData?.find((e) => e.name === "Number")?.value ?? "";
const byKey = new Map();
for (const p of products) {
  const k = `${fold(p.name)}|${numOf(p)}`;
  (byKey.get(k) ?? byKey.set(k, []).get(k)).push(p.productId);
}
const mkt = new Map();
for (const p of prices) if (p.marketPrice != null) mkt.set(p.productId, Math.max(mkt.get(p.productId) ?? 0, p.marketPrice));
const rows = (await db.execute("SELECT id, name, collector_number, price_usd FROM tcg_cards WHERE game='onepiece' AND set_code='PROMO'")).rows;
const out = [];
let unmatched = 0, ambiguous = 0;
for (const r of rows) {
  const ids = byKey.get(`${fold(r.name)}|${r.collector_number}`);
  if (!ids) { unmatched++; continue; }
  if (ids.length > 1) { ambiguous++; continue; }
  const tcg = mkt.get(ids[0]) ?? null;
  out.push({ id: r.id, name: r.name, num: r.collector_number, ours: r.price_usd, tcg, productId: ids[0] });
}
const both = out.filter((o) => o.ours != null && o.tcg != null);
const off = both.filter((o) => Math.abs(o.ours - o.tcg) / o.tcg > 0.25);
const big = off.filter((o) => Math.max(o.ours, o.tcg) >= 20);
console.log(`promo rows ${rows.length}; matched 1:1 ${out.length}, unmatched ${unmatched}, ambiguous ${ambiguous}`);
console.log(`both priced ${both.length}; off >25%: ${off.length} (${big.length} of them $20+); ours blank but TCGplayer priced: ${out.filter((o) => o.ours == null && o.tcg != null).length}`);
for (const o of big.sort((a, b) => Math.abs(b.tcg - b.ours) - Math.abs(a.tcg - a.ours)).slice(0, 15)) console.log(`  ${o.id} ${o.name} ${o.num}: ours ${o.ours} vs TCG ${o.tcg}`);
fs.writeFileSync("data/op-promo-drift-2026-10-24.json", JSON.stringify(out, null, 1));
