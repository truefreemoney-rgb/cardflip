// Cardmarket (EUR, Scryfall) vs TCGplayer (USD) on the same Magic printings, local mirror, read-only.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
let rate = Number(process.argv[3]) || 0;
try {
  const r = db.prepare("SELECT key, value FROM settings WHERE key LIKE '%eur%' OR key LIKE '%fx%'").all();
  console.log("settings fx rows:", r);
} catch (e) { console.log("no settings read:", e.message); }
if (!rate) rate = 1.17;
console.log("usd per eur used:", rate);
const rows = db.prepare("SELECT price_usd u, price_eur e, set_release_date d FROM mtg_cards WHERE lang='en' AND price_usd > 0 AND price_eur > 0").all();
const buckets = [["<$1", 0, 1], ["$1-5", 1, 5], ["$5-20", 5, 20], ["$20-100", 20, 100], ["$100+", 100, 1e9]];
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log("cards with both prices:", rows.length);
for (const [label, lo, hi] of buckets) {
  const rs = rows.filter((r) => r.u >= lo && r.u < hi).map((r) => (r.e * rate) / r.u).sort((a, b) => a - b);
  if (!rs.length) continue;
  const within = rs.filter((x) => x >= 0.75 && x <= 1.25).length / rs.length;
  const lower = rs.filter((x) => x < 1).length / rs.length;
  console.log(`${label.padEnd(8)} n=${String(rs.length).padStart(6)}  CM/TCG median ${q(rs, 0.5).toFixed(2)}  p25 ${q(rs, 0.25).toFixed(2)}  p75 ${q(rs, 0.75).toFixed(2)}  within±25% ${(within * 100).toFixed(0)}%  CM lower ${(lower * 100).toFixed(0)}%`);
}
const old = rows.filter((r) => r.d && r.d < "2010-01-01" && r.u >= 5).map((r) => (r.e * rate) / r.u).sort((a, b) => a - b);
console.log(`pre-2010 $5+   n=${old.length}  median ${q(old, 0.5).toFixed(2)}  p25 ${q(old, 0.25).toFixed(2)}  p75 ${q(old, 0.75).toFixed(2)}`);
const syn = db.prepare("SELECT MAX(synced_at) m FROM mtg_cards").get();
console.log("mirror synced:", new Date(syn.m).toISOString());
