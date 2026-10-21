// READ ONLY (prod): which One Piece catalog cards have no price, by set, with promo examples + their price_series rows.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;

const total = (await q("SELECT COUNT(*) n FROM tcg_cards WHERE game='onepiece'"))[0].n;
const unpriced = await q("SELECT id, name, subtitle, set_code, set_name, collector_number, rarity, variant, image_url, price_usd, price_usd_foil FROM tcg_cards WHERE game='onepiece' AND (price_usd IS NULL OR price_usd = 0) AND (price_usd_foil IS NULL OR price_usd_foil = 0)");
console.log("onepiece rows", total, "| unpriced (both null)", unpriced.length);
const zero = await q("SELECT COUNT(*) n FROM tcg_cards WHERE game='onepiece' AND (price_usd = 0 OR price_usd_foil = 0)");
console.log("rows with a 0 price:", zero[0].n);

const bySet = {};
for (const r of unpriced) { const k = `${r.set_code} | ${r.set_name}`; bySet[k] = (bySet[k] || 0) + 1; }
console.log("--- unpriced by set");
for (const [k, n] of Object.entries(bySet).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), k);

const byVar = {};
for (const r of unpriced) byVar[`${r.set_code}/${r.variant}`] = (byVar[`${r.set_code}/${r.variant}`] || 0) + 1;
console.log("--- unpriced by set_code/variant (top 40)");
for (const [k, n] of Object.entries(byVar).sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(String(n).padStart(4), k);

const promo = unpriced.filter((r) => r.set_code === "PROMO");
console.log("--- promo unpriced:", promo.length);
const withSeries = new Set((await q("SELECT DISTINCT card_id FROM price_series WHERE game='onepiece'")).map((r) => r.card_id));
const hasSeries = promo.filter((r) => withSeries.has(r.id)).length;
console.log("promo unpriced that have any price_series row:", hasSeries);
for (const r of promo.slice(0, 25)) console.log(JSON.stringify([r.id, r.name, r.collector_number, r.variant, r.rarity, r.image_url ? "pic" : "nopic"]));

// number-shape tally for promo gaps
const shape = {};
for (const r of promo) { const s = String(r.collector_number).replace(/\d+/g, "N"); shape[s] = (shape[s] || 0) + 1; }
console.log("promo gap collector_number shapes:", JSON.stringify(shape));
const vshape = {};
for (const r of promo) vshape[r.variant] = (vshape[r.variant] || 0) + 1;
console.log("promo gap variants:", JSON.stringify(vshape));

// how many promo rows are priced at all vs not
const pr = await q("SELECT COUNT(*) n, SUM(CASE WHEN (price_usd IS NULL OR price_usd = 0) AND (price_usd_foil IS NULL OR price_usd_foil = 0) THEN 1 ELSE 0 END) np FROM tcg_cards WHERE game='onepiece' AND set_code='PROMO'");
console.log("PROMO rows total / unpriced:", JSON.stringify(pr[0]));

// non-promo unpriced: examples
const other = unpriced.filter((r) => r.set_code !== "PROMO");
console.log("--- non-promo unpriced:", other.length);
for (const r of other.slice(0, 40)) console.log(JSON.stringify([r.id, r.name, r.set_code, r.set_name, r.collector_number, r.variant, r.rarity]));

// dump ids for the offline compare
fs.writeFileSync(process.env.OUT ?? "op-unpriced.json", JSON.stringify(unpriced.map((r) => ({ id: r.id, name: r.name, set_code: r.set_code, set_name: r.set_name, number: r.collector_number, variant: r.variant, rarity: r.rarity }))));

// --- second look: other readings of "no price" (213?)
console.log("=== other 'no price' readings");
const noSeries = await q("SELECT t.set_code, COUNT(*) n FROM tcg_cards t WHERE t.game='onepiece' AND NOT EXISTS (SELECT 1 FROM price_series p WHERE p.game='onepiece' AND p.card_id = t.id) GROUP BY t.set_code ORDER BY n DESC LIMIT 15");
console.log("no price_series row at all, by set_code:", JSON.stringify(noSeries), "sum", noSeries.reduce((a, r) => a + Number(r.n), 0));
const noSeriesTotal = await q("SELECT COUNT(*) n FROM tcg_cards t WHERE t.game='onepiece' AND NOT EXISTS (SELECT 1 FROM price_series p WHERE p.game='onepiece' AND p.card_id = t.id)");
console.log("no price_series total:", noSeriesTotal[0].n);
const tiny = await q("SELECT COUNT(*) n FROM tcg_cards WHERE game='onepiece' AND COALESCE(price_usd,0) < 0.05 AND COALESCE(price_usd_foil,0) < 0.05");
console.log("price < 5c both columns:", tiny[0].n);
const noSeriesAndZero = await q("SELECT COUNT(*) n FROM tcg_cards t WHERE t.game='onepiece' AND (t.price_usd IS NULL OR t.price_usd = 0) AND NOT EXISTS (SELECT 1 FROM price_series p WHERE p.game='onepiece' AND p.card_id = t.id)");
console.log("zero/null AND no series:", noSeriesAndZero[0].n);
const asks = await q("SELECT COUNT(*) n FROM ebay_asks WHERE card_id IN (SELECT id FROM tcg_cards WHERE game='onepiece' AND (price_usd IS NULL OR price_usd = 0))").catch((e) => [{ n: "err " + e.message }]);
console.log("zero/null cards that have an ebay_asks row:", asks[0].n);
const donZero = await q("SELECT set_code, COUNT(*) n FROM tcg_cards WHERE game='onepiece' AND COALESCE(price_usd,0) = 0 GROUP BY set_code");
console.log("zero by set_code:", JSON.stringify(donZero));
const other213 = await q("SELECT COUNT(*) n FROM tcg_cards WHERE game='onepiece' AND COALESCE(price_usd,0) < 0.10 AND COALESCE(price_usd_foil,0) < 0.10");
console.log("price < 10c both:", other213[0].n);

// --- the other ~67: priced in the column but no series row
console.log("=== priced in tcg_cards but no price_series row");
const gap = await q("SELECT t.id, t.name, t.set_code, t.variant, t.price_usd, t.price_usd_foil FROM tcg_cards t WHERE t.game='onepiece' AND COALESCE(t.price_usd,0) > 0 AND NOT EXISTS (SELECT 1 FROM price_series p WHERE p.game='onepiece' AND p.card_id = t.id)");
console.log("count:", gap.length);
const band = { lt005: 0, ge005: 0 };
for (const r of gap) (Number(r.price_usd) < 0.05 ? band.lt005++ : band.ge005++);
console.log("bands:", JSON.stringify(band));
for (const r of gap.filter((r) => Number(r.price_usd) >= 0.05).slice(0, 15)) console.log(JSON.stringify([r.id, r.name, r.set_code, r.variant, r.price_usd, r.price_usd_foil]));
console.log("sample <5c:", JSON.stringify(gap.filter((r) => Number(r.price_usd) < 0.05).slice(0, 8).map((r) => [r.id, r.price_usd])));
const distinctPrices = {};
for (const r of gap) distinctPrices[r.price_usd] = (distinctPrices[r.price_usd] || 0) + 1;
console.log("distinct prices:", JSON.stringify(distinctPrices));

// --- the 2 non-promo zero rows and their siblings
console.log("=== ST31 / ST33 zero rows and siblings");
for (const num of ["P-101", "OP12-046"]) {
  const rows = await q("SELECT id, name, set_code, set_name, collector_number, variant, rarity, price_usd, price_usd_foil FROM tcg_cards WHERE game='onepiece' AND collector_number = ?", [num]);
  for (const r of rows) console.log(JSON.stringify([r.id, r.name, r.set_code, r.set_name, r.variant, r.rarity, r.price_usd, r.price_usd_foil]));
}
