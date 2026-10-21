// READ ONLY (prod): the app's cached search answers (card_cache, mostly pokemontcg.io's TCGplayer numbers) vs our stored
// TCGplayer line (price_series, tcgcsv) for the same printing. 10-21: Kyogre ex4-3 app $542.60 vs line $290 x5 days.
// node scripts/_cache-vs-series.mjs [maxRows]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const max = Number(process.argv[2] ?? 5000);
const rows = (await c.execute({ sql: "SELECT key, payload, cached_at FROM card_cache ORDER BY cached_at DESC LIMIT ?", args: [max] })).rows;
const quotes = new Map(); // id|variant -> {market, at}
for (const r of rows) {
  let p; try { p = JSON.parse(String(r.payload)); } catch { continue; }
  const cards = Array.isArray(p) ? p : Array.isArray(p?.cards) ? p.cards : [];
  for (const card of cards) for (const pr of card?.prices ?? []) {
    if (pr.source !== "tcgplayer" || pr.currency !== "USD" || !(pr.market > 0)) continue;
    const k = `${card.id}|${pr.variant}`;
    if (!quotes.has(k)) quotes.set(k, { market: pr.market, at: Number(r.cached_at), name: `${card.name} | ${card.setName} ${card.number}` });
  }
}
const ids = [...new Set([...quotes.keys()].map((k) => k.split("|")[0]))];
const last = new Map();
for (let i = 0; i < ids.length; i += 300) {
  const chunk = ids.slice(i, i + 300);
  const s = (await c.execute({ sql: `SELECT card_id, variant, start_day, prices FROM price_series WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD' AND card_id IN (${chunk.map(() => "?").join(",")})`, args: chunk })).rows;
  for (const x of s) { const p = JSON.parse(String(x.prices)); for (let j = p.length - 1; j >= 0; j--) if (p[j] != null) { last.set(`${x.card_id}|${x.variant}`, { v: p[j], idx: j, start: x.start_day, len: p.length }); break; } }
}
let both = 0, off10 = 0, off25 = 0; const big = [];
for (const [k, q] of quotes) {
  const s = last.get(k); if (!s) continue; both++;
  const off = Math.abs(q.market - s.v) / s.v;
  if (off > 0.1) off10++;
  if (off > 0.25) { off25++; big.push({ k, name: q.name, app: q.market, line: s.v, cached: new Date(q.at).toISOString().slice(0, 10), off: Math.round(off * 100) }); }
}
console.log(`cache rows ${rows.length}, priced printings ${quotes.size}, with a stored line ${both}, >10% apart ${off10}, >25% apart ${off25}`);
big.sort((a, b) => Math.max(b.app, b.line) - Math.max(a.app, a.line));
for (const b of big.slice(0, 25)) console.log(`${b.k}\tapp ${b.app}\tline ${b.line}\toff ${b.off}%\tcached ${b.cached}\t${b.name}`);
