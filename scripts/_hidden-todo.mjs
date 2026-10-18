// Read-only: "Hidden by eBay" cards (verdict high, no manual call), today's TCGplayer number vs the asks, most valuable first.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = (await c.execute("SELECT a.game, a.card_id, a.variant, a.price_usd, a.median_usd, a.q75_usd, a.n, a.label, a.day, s.prices FROM ebay_asks a LEFT JOIN price_series s ON s.card_id = a.card_id AND s.variant = a.variant AND s.source = 'tcgplayer' AND s.currency = 'USD' WHERE a.verdict = 'high' AND a.manual IS NULL")).rows;
const checked = new Set((await c.execute("SELECT card_id || '|' || variant k FROM price_checked WHERE off_day IS NULL")).rows.map((r) => r.k));
const out = [];
for (const r of q) {
  if (checked.has(`${r.card_id}|${r.variant}`)) continue;
  const a = r.prices ? JSON.parse(String(r.prices)).filter((v) => v != null) : [];
  const cur = a.length ? a[a.length - 1] : Number(r.price_usd);
  out.push({ game: r.game, id: r.card_id, variant: r.variant, cur, med: r.median_usd, q75: r.q75_usd, n: r.n, label: String(r.label), day: r.day });
}
out.sort((a, b) => b.cur - a.cur);
fs.writeFileSync("data/hidden-todo.json", JSON.stringify(out, null, 1));
const by = {};
for (const x of out) by[x.game] = (by[x.game] ?? 0) + 1;
console.log(`hidden, not yet fixed: ${out.length}`, JSON.stringify(by));
for (const x of out.slice(0, 40)) console.log(`${x.game} ${x.id} ${x.variant} $${x.cur} asks med $${x.med} q75 $${x.q75} n${x.n} | ${x.label.slice(0, 70)}`);
