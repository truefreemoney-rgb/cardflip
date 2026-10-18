// Read-only: open Hand check cards still >= 1.5x their eBay asks today, ordered: Lorcana/One Piece/Yu-Gi-Oh new sets,
// then prices frozen 21+ days, then the rest by dollars over.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = (await c.execute("SELECT a.game, a.card_id, a.variant, a.price_usd, a.median_usd, a.n, a.label, a.query, s.prices FROM ebay_asks a LEFT JOIN price_series s ON s.card_id = a.card_id AND s.variant = a.variant AND s.source = 'tcgplayer' AND s.currency = 'USD' WHERE a.verdict = 'check' AND a.manual IS NULL")).rows;
const checked = new Set((await c.execute("SELECT card_id || '|' || variant k FROM price_checked WHERE off_day IS NULL")).rows.map((r) => r.k));
const out = [];
for (const r of q) {
  if (checked.has(`${r.card_id}|${r.variant}`)) continue;
  const a = r.prices ? JSON.parse(String(r.prices)) : [];
  const vals = a.filter((v) => v != null);
  const cur = vals.length ? vals[vals.length - 1] : Number(r.price_usd);
  let flat = 0;
  for (let i = vals.length - 1; i >= 0 && vals[i] === cur; i--) flat++;
  const ratio = cur / Number(r.median_usd);
  if (ratio < 1.5 || Number(r.n) < 3) continue;
  const tier = r.game === "lorcana" || r.game === "onepiece" ? 0 : flat >= 21 ? 1 : 2;
  out.push({ tier, game: r.game, id: r.card_id, variant: r.variant, cur, med: r.median_usd, n: r.n, flat, ratio: +ratio.toFixed(2), label: String(r.label), query: String(r.query ?? "") });
}
out.sort((a, b) => a.tier - b.tier || b.cur - b.med * 1.25 - (a.cur - a.med * 1.25));
fs.writeFileSync("data/handcheck-todo.json", JSON.stringify(out, null, 1));
console.log(`todo ${out.length}: tier0 ${out.filter((x) => x.tier === 0).length}, frozen ${out.filter((x) => x.tier === 1).length}, rest ${out.filter((x) => x.tier === 2).length}`);
for (const x of out.slice(0, 30)) console.log(`${x.tier} ${x.game} ${x.id} ${x.variant} $${x.cur} asks $${x.med} n${x.n} flat${x.flat} | ${x.label.slice(0, 70)} || ${x.query.slice(0, 70)}`);
