// Read-only (10-22): Pokémon cards with 2+ TCGplayer products mapped (tcgplayer_products), with product names from
// tcgcsv (public) and our current TCGplayer USD price, to measure the "Staff/Prerelease stamp priced the plain card" slip
// found on Entei SM219 (201942 Staff $205 vs 201943 plain $22). node scripts/_dup-products.mjs
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await c.execute("SELECT card_id, group_id, product_id FROM tcgplayer_products WHERE game = 'pokemon'")).rows;
const byCard = new Map();
for (const r of rows) { const a = byCard.get(r.card_id) ?? []; a.push(r); byCard.set(r.card_id, a); }
const dups = [...byCard.entries()].filter(([, a]) => a.length > 1);
console.log(`${byCard.size} mapped cards, ${dups.length} with 2+ products`);
const groups = new Set(dups.flatMap(([, a]) => a.map((r) => r.group_id)));
const names = new Map();
for (const gid of groups) {
  try {
    const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${gid}/products`, { headers: { "user-agent": "cardflip-dup-check" } });
    const list = (await res.json()).results ?? [];
    for (const p of list) names.set(p.productId, p.name);
  } catch (e) { console.log(`group ${gid}: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 400));
}
// tcgcsv market per product (default subtype line: Normal/Holofoil), to see which product our price follows.
const pmarket = new Map();
for (const gid of groups) {
  try {
    const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${gid}/prices`, { headers: { "user-agent": "cardflip-dup-check" } });
    for (const p of (await res.json()).results ?? []) if (p.marketPrice != null) pmarket.set(p.productId + "|" + (p.subTypeName ?? "Normal"), p.marketPrice);
  } catch {}
  await new Promise((r) => setTimeout(r, 400));
}
const prices = new Map();
const ps = (await c.execute("SELECT card_id, variant, prices FROM price_series WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD'")).rows;
for (const r of ps) { try { const p = JSON.parse(r.prices); const last = [...p].reverse().find((v) => v != null); if (last != null) prices.set(r.card_id + "|" + r.variant, last); } catch {} }
const out = [];
for (const [cardId, a] of dups) {
  const mk = (pid) => [...pmarket.entries()].filter(([k]) => k.startsWith(pid + "|")).map(([k, v]) => `${k.split("|")[1]} $${v}`).join("/");
  const pn = a.map((r) => `${r.product_id} ${names.get(r.product_id) ?? "?"} {${mk(r.product_id) || "no price"}}`);
  const tagged = pn.filter((n) => /staff|prerelease|pre-release|league|championship|worlds|error|misprint|promo/i.test(n)).length;
  const ours = [...prices.entries()].filter(([k]) => k.startsWith(cardId + "|")).map(([k, v]) => `${k.split("|")[1]} $${v}`).join(", ");
  out.push({ cardId, n: a.length, tagged, ours, pn });
}
out.sort((x, y) => y.tagged - x.tagged || y.n - x.n);
console.log(`${out.filter((o) => o.tagged).length} of them have a Staff/Prerelease/League/Championship-tagged product`);
for (const o of out.slice(0, 80)) console.log(`${o.cardId}\t${o.n} products\t${o.ours}\t${o.pn.join(" | ")}`);
fs.writeFileSync(process.env.TEMP + "/dup-products.json", JSON.stringify(out));
