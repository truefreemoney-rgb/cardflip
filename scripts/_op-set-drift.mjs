// Read-only (10-24): regular One Piece set prices (optcgapi) vs TCGplayer market, matched by set name -> group,
// card number, and alt-art-or-not; only 1:1 matches are compared. -> data/op-set-drift-2026-10-24.json
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const H = { headers: { "User-Agent": "CardFlip/1.0 (support@cardflip.io)" } };
const API = "https://tcgcsv.com/tcgplayer/68";
const groups = (await (await fetch(`${API}/groups`, H)).json()).results;
const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const groupBy = new Map(groups.map((g) => [fold(g.name), g.groupId]));
const rows = (await db.execute("SELECT id, name, set_name, collector_number, variant, price_usd FROM tcg_cards WHERE game='onepiece' AND set_code NOT IN ('PROMO','DON')")).rows;
const bySet = new Map();
let noGroup = 0;
for (const r of rows) { const g = groupBy.get(fold(r.set_name)); if (!g) { noGroup++; continue; } (bySet.get(g) ?? bySet.set(g, []).get(g)).push(r); }
const ALT = /alternate art|parallel|manga|special/i;
const out = [];
let unmatched = 0;
for (const [g, list] of bySet) {
  const products = (await (await fetch(`${API}/${g}/products`, H)).json()).results ?? [];
  const prices = (await (await fetch(`${API}/${g}/prices`, H)).json()).results ?? [];
  const mkt = new Map();
  for (const p of prices) if (p.marketPrice != null) mkt.set(p.productId, Math.max(mkt.get(p.productId) ?? 0, p.marketPrice));
  for (const r of list) {
    const alt = r.variant === "parallel" || ALT.test(r.variant ?? "");
    const cands = products.filter((p) => p.extendedData?.find((e) => e.name === "Number")?.value === r.collector_number && ALT.test(p.name) === alt && !/reprint|pre-release|jolly|pirate foil|treasure/i.test(p.name));
    if (cands.length !== 1 || r.variant === "reprint") { unmatched++; continue; }
    out.push({ id: r.id, name: r.name, set: r.set_name, num: r.collector_number, variant: r.variant, ours: r.price_usd, tcg: mkt.get(cands[0].productId) ?? null, product: cands[0].name });
  }
  await new Promise((res) => setTimeout(res, 250));
}
const both = out.filter((o) => o.ours != null && o.tcg != null);
const off = both.filter((o) => Math.abs(o.ours - o.tcg) / o.tcg > 0.25 && Math.max(o.ours, o.tcg) >= 5);
console.log(`set rows ${rows.length}; no group ${noGroup}; matched 1:1 ${out.length}; unmatched ${unmatched}`);
console.log(`both priced ${both.length}; off >25% at $5+: ${off.length}; ours blank but TCGplayer priced: ${out.filter((o) => o.ours == null && o.tcg != null).length}`);
for (const o of off.sort((a, b) => Math.abs(b.tcg - b.ours) - Math.abs(a.tcg - a.ours)).slice(0, 12)) console.log(`  ${o.id} ${o.name} ${o.num} [${o.product}]: ours ${o.ours} vs TCG ${o.tcg}`);
fs.writeFileSync("data/op-set-drift-2026-10-24.json", JSON.stringify(out, null, 1));
