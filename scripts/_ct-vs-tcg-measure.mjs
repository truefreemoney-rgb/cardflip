// Read-only measurement (10-19): CardTrader's cheapest NM English listing vs TCGplayer market on the SAME Magic
// printings, from the local mirror (data/cardflip.db) + live CardTrader calls (2 per expansion). Answers "where does
// CardTrader belong in the price order?" before any code changes it.
// node --experimental-strip-types --no-warnings --import ./scripts/lib/register-alias.mjs scripts/_ct-vs-tcg-measure.mjs [set codes...]
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { cardtraderMtgPrices } = await import(at("lib/server/cardtrader.ts"));

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const token = env.CARDTRADER_TOKEN;
if (!token) throw new Error("CARDTRADER_TOKEN missing in .env.local");

const db = new DatabaseSync("data/cardflip.db", { readOnly: true });
const fx = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='fx_rates'").get().value);
const usdPerEur = 1 / fx.rates.EUR;
console.log("usd per eur:", usdPerEur.toFixed(4), "(ECB", fx.date + ")");

const sets = process.argv.slice(2).length ? process.argv.slice(2) : ["mh3", "dsk", "dom", "ktk", "mm2", "c19", "lea", "2x2"];
const rows = db
  .prepare(`SELECT id, name, set_code, collector_number, finishes, price_usd, price_usd_foil, set_release_date FROM mtg_cards WHERE lang='en' AND set_code IN (${sets.map(() => "?").join(",")}) AND (price_usd > 0 OR price_usd_foil > 0)`)
  .all(...sets);
console.log("printings with a TCGplayer price in", sets.join(","), ":", rows.length);

const ct = await cardtraderMtgPrices(
  rows.map((r) => ({ id: r.id, name: r.name, setCode: r.set_code, number: r.collector_number, finishes: r.finishes })),
  token,
  usdPerEur,
  240_000,
);
const byId = new Map(ct.map((c) => [c.id, c]));
const pairs = [];
for (const r of rows) {
  const c = byId.get(r.id);
  if (!c) continue;
  if (c.usd != null && r.price_usd > 0) pairs.push({ set: r.set_code, tcg: r.price_usd, ct: c.usd, kind: "plain", d: r.set_release_date });
  if (c.foil != null && r.price_usd_foil > 0) pairs.push({ set: r.set_code, tcg: r.price_usd_foil, ct: c.foil, kind: "foil", d: r.set_release_date });
}
console.log("matched on CardTrader:", ct.length, "printings;", pairs.length, "price pairs");
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const report = (label, ps) => {
  const rs = ps.map((p) => p.ct / p.tcg).sort((a, b) => a - b);
  if (!rs.length) return;
  const within = rs.filter((x) => x >= 0.75 && x <= 1.25).length / rs.length;
  const lower = rs.filter((x) => x < 1).length / rs.length;
  console.log(`${label.padEnd(14)} n=${String(rs.length).padStart(5)}  CT/TCG median ${q(rs, 0.5).toFixed(2)}  p25 ${q(rs, 0.25).toFixed(2)}  p75 ${q(rs, 0.75).toFixed(2)}  within±25% ${(within * 100).toFixed(0)}%  CT lower ${(lower * 100).toFixed(0)}%`);
};
for (const [label, lo, hi] of [["<$1", 0, 1], ["$1-5", 1, 5], ["$5-20", 5, 20], ["$20-100", 20, 100], ["$100+", 100, 1e9]]) report(label, pairs.filter((p) => p.tcg >= lo && p.tcg < hi));
report("plain only", pairs.filter((p) => p.kind === "plain"));
report("foil only", pairs.filter((p) => p.kind === "foil"));
for (const s of sets) report(`set ${s}`, pairs.filter((p) => p.set === s));
fs.writeFileSync("data/ct-vs-tcg-measure.json", JSON.stringify({ day: new Date().toISOString().slice(0, 10), usdPerEur, sets, pairs }, null, 1));
console.log("written data/ct-vs-tcg-measure.json");
