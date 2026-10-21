// READ ONLY (prod + public tcgcsv.com): Pokémon TCGplayer lines that stopped updating (last point before yesterday), and
// what today's TCGCSV file says about their product: listed with no market price (no sale in TCGplayer's window: the
// 10-21 carry fixes these), listed WITH a price (something else drops it), or not in the file at all.
// node scripts/_stopped-lines-measure.mjs
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const stopped = (await q(`SELECT card_id, variant, updated_day, prices FROM price_series WHERE game='pokemon' AND source='tcgplayer' AND currency='USD' AND updated_day < ? AND updated_day >= '2026-07-01' AND card_id NOT LIKE 'sealed-%' AND card_id NOT LIKE 'tcgp-sealed-%'`, [yesterday]));
const map = await q("SELECT product_id, group_id, card_id FROM tcgplayer_products WHERE game='pokemon'");
const byCard = new Map();
for (const m of map) (byCard.get(String(m.card_id)) ?? byCard.set(String(m.card_id), []).get(String(m.card_id))).push({ pid: Number(m.product_id), gid: Number(m.group_id) });
// TCGplayer subtype -> our variant key (lib/tcgcsv.ts tcgplayerVariantKey, simplified for the common names).
const key = (s) => { const t = String(s ?? "Normal"); if (/^1st Edition Holofoil$/i.test(t)) return "1stEditionHolofoil"; if (/^1st Edition/i.test(t)) return "1stEditionNormal"; if (/Unlimited Holofoil/i.test(t)) return "unlimitedHolofoil"; if (/Reverse Holofoil/i.test(t)) return "reverseHolofoil"; if (/Holofoil/i.test(t)) return "holofoil"; return "normal"; };
const groups = new Map();
const last = (p) => { const a = JSON.parse(String(p)).filter((v) => v != null); return a[a.length - 1] ?? 0; };
const rows = stopped.map((r) => { const id = String(r.card_id); const base = id.endsWith("-1st") ? id.slice(0, -4) : id; return { id, variant: r.variant, upd: r.updated_day, last: last(r.prices), products: byCard.get(id) ?? byCard.get(base) ?? [] }; });
for (const r of rows) for (const p of r.products) groups.set(p.gid, null);
let n = 0;
for (const gid of groups.keys()) {
  const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${gid}/prices`, { headers: { "User-Agent": "CardFlip price check (support@cardflip.io)" } });
  groups.set(gid, res.ok ? ((await res.json()).results ?? []) : null);
  if (++n % 10 === 0) process.stdout.write(`${n}/${groups.size} groups\r`);
  await new Promise((r) => setTimeout(r, 300));
}
const out = { listedNoSale: [], listedWithPrice: [], notInFile: [], noProduct: [] };
for (const r of rows) {
  if (!r.products.length) { out.noProduct.push(r); continue; }
  const hits = r.products.flatMap((p) => (groups.get(p.gid) ?? []).filter((x) => x.productId === p.pid));
  const mine = hits.filter((h) => key(h.subTypeName) === r.variant || (r.variant === "1stEditionHolofoil" && /1st Edition Holofoil/i.test(h.subTypeName ?? "")));
  const pick = mine.length ? mine : hits;
  if (!pick.length) out.notInFile.push(r);
  else if (pick.every((h) => h.marketPrice == null)) out.listedNoSale.push({ ...r, low: pick[0].lowPrice, mid: pick[0].midPrice });
  else out.listedWithPrice.push({ ...r, market: pick.map((h) => `${h.subTypeName}:${h.marketPrice}`).join(",") });
}
console.log(`\nstopped lines: ${rows.length} (groups fetched ${groups.size})`);
for (const [k, v] of Object.entries(out)) {
  console.log(`${k}: ${v.length} (${v.filter((x) => x.last >= 100).length} at $100+)`);
  for (const x of v.sort((a, b) => b.last - a.last).slice(0, 8)) console.log(`   ${x.id} ${x.variant} last $${x.last} (${x.upd})${x.low != null ? ` low ${x.low} mid ${x.mid}` : ""}${x.market ? ` market ${x.market}` : ""}`);
}
