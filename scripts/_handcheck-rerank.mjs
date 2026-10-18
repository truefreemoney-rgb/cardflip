// Read-only: the open Hand check queue re-ranked against TODAY's TCGplayer number (the queue was read 10-15..17).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = (await c.execute("SELECT a.game, a.card_id, a.variant, a.price_usd, a.median_usd, a.n, a.label, s.prices FROM ebay_asks a LEFT JOIN price_series s ON s.card_id = a.card_id AND s.variant = a.variant AND s.source = 'tcgplayer' AND s.currency = 'USD' WHERE a.verdict = 'check' AND a.manual IS NULL")).rows;
const checked = new Set((await c.execute("SELECT card_id || '|' || variant k FROM price_checked WHERE off_day IS NULL")).rows.map((r) => r.k));
const out = [];
for (const r of q) {
  if (checked.has(`${r.card_id}|${r.variant}`)) continue;
  let now = null;
  if (r.prices) { const a = JSON.parse(String(r.prices)); for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) { now = a[i]; break; } }
  const cur = now ?? Number(r.price_usd);
  const ratio = cur / Number(r.median_usd);
  out.push({ ...r, cur, ratio, excess: cur - 1.25 * Number(r.median_usd) });
}
const still = out.filter((x) => x.ratio >= 1.5 && Number(x.n) >= 3).sort((a, b) => b.excess - a.excess);
console.log(`open ${q.length}, not yet checked ${out.length}, still >=1.5x asks with 3+ asks: ${still.length}, dropped below 1.5x since: ${out.filter((x) => x.ratio < 1.5).length}`);
for (const x of still.slice(0, 25)) console.log(`${x.game} ${x.card_id} ${x.variant} now $${x.cur} (queue $${x.price_usd}) asks med $${x.median_usd} n${x.n} x${x.ratio.toFixed(2)} | ${String(x.label).slice(0, 55)}`);
