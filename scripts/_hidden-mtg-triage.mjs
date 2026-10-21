// READ ONLY (local mirror + data/hidden-todo.json): Magic "Hidden by eBay" cards sorted into
// markets agree (TCGplayer vs Cardmarket within 40%: the referee's asks were the cheap printing, keep)
// vs disagree / no Cardmarket (needs an eBay sold check). Cardmarket USD ~ eur x 1.08 FX x 1.12 lift (approximate, triage only).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const c = createClient({ url: "file:data/cardflip.db" });
const list = JSON.parse(fs.readFileSync("data/hidden-todo.json", "utf8")).filter((x) => x.game === "mtg");
const agree = [], disagree = [], none = [];
for (const x of list) {
  const r = (await c.execute({ sql: "SELECT name, set_code, collector_number, price_eur, price_eur_foil, promo_types, frame_effects FROM mtg_cards WHERE id = ?", args: [x.id] })).rows[0];
  if (!r) { none.push({ x, why: "not in mirror" }); continue; }
  const eur = x.variant === "foil" ? r.price_eur_foil : r.price_eur;
  const tag = `${r.name} ${String(r.set_code).toUpperCase()} ${r.collector_number} ${x.variant} [${r.promo_types || r.frame_effects || "-"}]`;
  if (eur == null) { none.push({ x, tag }); continue; }
  const cm = Number(eur) * 1.08 * 1.12;
  const ratio = x.cur / cm;
  (ratio <= 1.4 && ratio >= 0.6 ? agree : disagree).push({ x, tag, cm, ratio });
}
const line = (o) => `$${o.x.cur} vs CM ~$${o.cm ? o.cm.toFixed(0) : "-"} (${o.ratio ? o.ratio.toFixed(2) + "x" : "-"}) asks $${o.x.med} | ${o.tag ?? o.why}`;
console.log(`AGREE ${agree.length} (keep candidates), DISAGREE ${disagree.length}, NO CARDMARKET ${none.length}`);
console.log("--- DISAGREE (TCGplayer far from Cardmarket), most valuable first:");
for (const o of disagree.sort((a, b) => b.x.cur - a.x.cur).slice(0, 25)) console.log(line(o));
console.log("--- NO CARDMARKET, most valuable first:");
for (const o of none.sort((a, b) => b.x.cur - a.x.cur).slice(0, 15)) console.log(line(o));
fs.writeFileSync("data/hidden-mtg-triage.json", JSON.stringify({ agree: agree.map((o) => ({ id: o.x.id, variant: o.x.variant, cur: o.x.cur, cm: Math.round(o.cm), tag: o.tag })), disagree: disagree.map((o) => ({ id: o.x.id, variant: o.x.variant, cur: o.x.cur, cm: Math.round(o.cm), tag: o.tag })), none: none.map((o) => ({ id: o.x.id, variant: o.x.variant, cur: o.x.cur, tag: o.tag ?? o.why })) }, null, 1));
