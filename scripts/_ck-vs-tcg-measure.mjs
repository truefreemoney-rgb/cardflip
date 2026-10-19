// Card Kingdom retail (official public price list) vs TCGplayer market on the same Magic printings, local mirror, read-only.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [dbPath, ckPath] = process.argv.slice(2);
const db = new DatabaseSync(dbPath, { readOnly: true });
const ck = JSON.parse(fs.readFileSync(ckPath, "utf8"));
const list = ck.data ?? ck;
console.log("card kingdom rows:", list.length, "sample keys:", Object.keys(list[0]).join(","));
const byScry = new Map();
for (const r of list) {
  const sid = r.scryfall_id;
  if (!sid) continue;
  const retail = Number(r.price_retail);
  if (!(retail > 0)) continue;
  byScry.set(`${sid}|${r.is_foil === "true" || r.is_foil === true ? "foil" : "plain"}`, { retail, buy: Number(r.price_buy) || null, qty: Number(r.qty_retail) || 0 });
}
console.log("with scryfall id + retail price:", byScry.size);
const rows = db.prepare("SELECT id, price_usd, price_usd_foil, set_release_date d, set_code FROM mtg_cards WHERE lang='en' AND (price_usd > 0 OR price_usd_foil > 0)").all();
const pairs = [];
for (const r of rows) {
  const p = byScry.get(`${r.id}|plain`);
  if (p && r.price_usd > 0) pairs.push({ tcg: r.price_usd, ck: p.retail, buy: p.buy, qty: p.qty, d: r.d, kind: "plain" });
  const f = byScry.get(`${r.id}|foil`);
  if (f && r.price_usd_foil > 0) pairs.push({ tcg: r.price_usd_foil, ck: f.retail, buy: f.buy, qty: f.qty, d: r.d, kind: "foil" });
}
console.log("price pairs:", pairs.length);
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const report = (label, ps, key = "ck") => {
  const rs = ps.filter((p) => p[key] > 0).map((p) => p[key] / p.tcg).sort((a, b) => a - b);
  if (!rs.length) return;
  const within = rs.filter((x) => x >= 0.75 && x <= 1.25).length / rs.length;
  const lower = rs.filter((x) => x < 1).length / rs.length;
  console.log(`${label.padEnd(22)} n=${String(rs.length).padStart(6)}  ${key.toUpperCase()}/TCG median ${q(rs, 0.5).toFixed(2)}  p25 ${q(rs, 0.25).toFixed(2)}  p75 ${q(rs, 0.75).toFixed(2)}  within±25% ${(within * 100).toFixed(0)}%  lower ${(lower * 100).toFixed(0)}%`);
};
for (const [label, lo, hi] of [["<$1", 0, 1], ["$1-5", 1, 5], ["$5-20", 5, 20], ["$20-100", 20, 100], ["$100+", 100, 1e9]]) report(`retail ${label}`, pairs.filter((p) => p.tcg >= lo && p.tcg < hi));
report("retail in stock only", pairs.filter((p) => p.qty > 0 && p.tcg >= 1));
report("retail pre-2010 $5+", pairs.filter((p) => p.d && p.d < "2010-01-01" && p.tcg >= 5));
for (const [label, lo, hi] of [["$1-5", 1, 5], ["$5-20", 5, 20], ["$20-100", 20, 100], ["$100+", 100, 1e9]]) report(`buylist ${label}`, pairs.filter((p) => p.tcg >= lo && p.tcg < hi), "buy");
