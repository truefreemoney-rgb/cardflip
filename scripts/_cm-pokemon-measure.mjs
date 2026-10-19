// Read-only: Cardmarket (EUR average, or our converted USD) vs TCGplayer's latest USD point on the same Pokémon card,
// local mirror data/cardflip.db. Pokémon twin of _cm-vs-tcg-measure.mjs (Magic). 10-19.
import { DatabaseSync } from "node:sqlite";
import { decodePrices } from "../src/lib/priceSeries.ts";
const db = new DatabaseSync("data/cardflip.db", { readOnly: true });
const fx = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='fx_rates'").get().value);
const usdPerEur = 1 / fx.rates.EUR;
console.log(db.prepare("SELECT game, source, currency, COUNT(*) n FROM price_series WHERE source<>'tcgplayer' GROUP BY game, source, currency").all());
const last = (prices) => { const p = decodePrices(prices); for (let i = p.length - 1; i >= 0; i--) if (p[i] != null && p[i] > 0) return p[i]; return null; };
const PREF = ["normal", "holofoil", "reverseHolofoil", "unlimited", "unlimitedHolofoil"];
const tcg = new Map();
for (const r of db.prepare("SELECT card_id, variant, prices FROM price_series WHERE game='pokemon' AND source='tcgplayer' AND currency='USD'").all()) {
  const v = last(r.prices); if (v == null) continue;
  const cur = tcg.get(r.card_id); const rank = PREF.indexOf(r.variant); if (rank < 0) continue;
  if (!cur || rank < cur.rank) tcg.set(r.card_id, { usd: v, rank, variant: r.variant });
}
const cm = new Map();
for (const r of db.prepare("SELECT card_id, source, currency, prices FROM price_series WHERE game='pokemon' AND source IN ('cardmarket','cardmarket-converted')").all()) {
  const v = last(r.prices); if (v == null) continue;
  cm.set(r.card_id, r.currency === "EUR" ? v * usdPerEur : v);
}
const pairs = [];
for (const [id, t] of tcg) { const c = cm.get(id); if (c) pairs.push({ tcg: t.usd, cm: c, variant: t.variant }); }
console.log("pokemon cards with TCGplayer:", tcg.size, "with Cardmarket:", cm.size, "pairs:", pairs.length);
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const report = (label, ps) => {
  const rs = ps.map((p) => p.cm / p.tcg).sort((a, b) => a - b); if (!rs.length) return;
  const within = rs.filter((x) => x >= 0.75 && x <= 1.25).length / rs.length; const lower = rs.filter((x) => x < 1).length / rs.length;
  console.log(`${label.padEnd(10)} n=${String(rs.length).padStart(6)}  CM/TCG median ${q(rs, 0.5).toFixed(2)}  p25 ${q(rs, 0.25).toFixed(2)}  p75 ${q(rs, 0.75).toFixed(2)}  within±25% ${(within * 100).toFixed(0)}%  CM lower ${(lower * 100).toFixed(0)}%`);
};
for (const [label, lo, hi] of [["<$1", 0, 1], ["$1-5", 1, 5], ["$5-20", 5, 20], ["$20-100", 20, 100], ["$100+", 100, 1e9]]) report(label, pairs.filter((p) => p.tcg >= lo && p.tcg < hi));
