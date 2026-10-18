// Read-only: TCGplayer series still being written but FLAT for 30+ priced days ($50+), with any second source for contrast.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await c.execute(`SELECT game, card_id, variant, prices FROM price_series
  WHERE source = 'tcgplayer' AND currency = 'USD' AND updated_day >= '2026-10-16' AND json_extract(prices, '$[#-1]') >= 50`)).rows;
const checked = new Set((await c.execute("SELECT card_id || '|' || variant k FROM price_checked WHERE off_day IS NULL")).rows.map((r) => r.k));
const flat = [];
for (const r of rows) {
  if (checked.has(`${r.card_id}|${r.variant}`)) continue;
  const a = JSON.parse(String(r.prices)).filter((v) => v != null);
  if (a.length < 30) continue;
  const last = a[a.length - 1];
  let run = 0;
  for (let i = a.length - 1; i >= 0 && a[i] === last; i--) run++;
  if (run >= 30) flat.push({ game: r.game, id: r.card_id, variant: r.variant, usd: last, run });
}
flat.sort((x, y) => y.usd - x.usd);
const ids = [...new Set(flat.map((f) => f.id))];
const alt = new Map();
for (let i = 0; i < ids.length; i += 300) {
  const ch = ids.slice(i, i + 300);
  const q = (await c.execute({ sql: `SELECT card_id, variant, source, currency, prices FROM price_series WHERE source IN ('cardmarket','cardmarket-converted','cardtrader') AND updated_day >= '2026-10-11' AND card_id IN (${ch.map(() => "?").join(",")})`, args: ch })).rows;
  for (const x of q) { const a = JSON.parse(String(x.prices)).filter((v) => v != null); if (a.length) alt.set(`${x.card_id}|${x.variant}|${x.source}`, `${x.source}/${x.variant} ${x.currency} ${a[a.length - 1]}`); }
}
const names = new Map();
for (let i = 0; i < ids.length; i += 300) {
  const ch = ids.slice(i, i + 300);
  for (const t of ["en_cards", "tcg_cards", "mtg_cards"]) {
    try { const q = (await c.execute({ sql: `SELECT id, name, set_name FROM ${t} WHERE id IN (${ch.map(() => "?").join(",")})`, args: ch })).rows; for (const x of q) names.set(x.id, `${x.name} | ${x.set_name}`); } catch {}
  }
}
const byGame = {};
for (const f of flat) byGame[f.game] = (byGame[f.game] ?? 0) + 1;
console.log("flat 30+ days, $50+:", flat.length, JSON.stringify(byGame));
const out = flat.map((f) => ({ ...f, name: names.get(f.id) ?? "", alt: [...alt].filter(([k]) => k.startsWith(f.id + "|") && (k.split("|")[1] === f.variant || k.split("|")[1] === "average")).map(([, v]) => v).join("; ") }));
fs.writeFileSync("data/frozen-todo.json", JSON.stringify(out, null, 1));
for (const f of out.slice(0, 45)) console.log(`${f.game} ${f.id.slice(0, 18)} ${f.variant} $${f.usd} flat ${f.run}d | ${f.name.slice(0, 50)} | ${f.alt}`);

