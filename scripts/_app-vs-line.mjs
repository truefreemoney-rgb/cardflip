// READ ONLY: the app's live /api/search-card?id= quote (pokemontcg.io when it answers in time, else our own line) vs the
// stored TCGplayer line (tcgcsv) for a sample of $100+ Pokémon printings. 10-21: Kyogre ex4-3 app $542.60 vs line $290.
// node scripts/_app-vs-line.mjs [n] [minUsd]   (one request every 2 s)
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const n = Number(process.argv[2] ?? 30), minUsd = Number(process.argv[3] ?? 100);
const rows = (await c.execute("SELECT card_id, variant, prices FROM price_series WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD' AND updated_day >= date('now','-3 days')")).rows;
const lines = new Map();
for (const r of rows) { const p = JSON.parse(String(r.prices)); let v = null; for (let j = p.length - 1; j >= 0; j--) if (p[j] != null) { v = p[j]; break; } if (v != null) lines.set(`${r.card_id}|${r.variant}`, v); }
const pool = [...new Set([...lines].filter(([, v]) => v >= minUsd).map(([k]) => k.split("|")[0]))];
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
let compared = 0, apart = 0, live = 0;
for (const id of pool.slice(0, n)) {
  const res = await fetch(`https://cardflip.io/api/search-card?id=${encodeURIComponent(id)}`);
  const j = await res.json().catch(() => null);
  for (const p of j?.cards?.[0]?.prices ?? []) {
    if (p.source !== "tcgplayer" || p.currency !== "USD" || !(p.market > 0)) continue;
    const line = lines.get(`${id}|${p.variant}`); if (line == null) continue;
    compared++; const isLive = p.low != null || p.high != null; if (isLive) live++;
    const off = Math.abs(p.market - line) / line;
    if (off > 0.1) { apart++; console.log(`${id}|${p.variant}\tapp ${p.market}\tline ${line}\toff ${Math.round(off * 100)}%\t${isLive ? "pokemontcg.io" : "own"}\t${p.untrusted ? "FLAGGED " + p.untrusted.reason : ""}`); }
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`sampled ${Math.min(n, pool.length)} cards of ${pool.length}, ${compared} printings compared, ${live} from pokemontcg.io, ${apart} more than 10% off the line`);
