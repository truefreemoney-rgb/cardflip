// Read-only (10-22): Pokémon TCGplayer USD prices that are suspiciously round (whole dollars, multiple of 5, $50+),
// the "69 round-number prices" from the 10-13 sweep, with card name / set / number for a TCGplayer-sales re-read.
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_round-prices.mjs [min]
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const min = Number(process.argv[2] ?? 50);
const { db } = await import("../src/lib/db.ts");
const { loadCardRecord } = await import("../src/lib/server/cardPages.ts");
const rows = await db.prepare("SELECT card_id, variant, prices FROM price_series WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD'").all();
const out = [];
for (const r of rows) {
  let p;
  try { p = JSON.parse(r.prices); } catch { continue; }
  const last = [...p].reverse().find((v) => v != null);
  if (!(last >= min) || !Number.isInteger(last) || last % 5 !== 0) continue;
  const flat = [...p].reverse().findIndex((v) => v != null && v !== last);
  out.push({ game: "pokemon", id: r.card_id, variant: r.variant, ours: last, flatDays: flat < 0 ? p.length : flat });
}
out.sort((a, b) => b.ours - a.ours);
for (const c of out) {
  try {
    const rec = await loadCardRecord("pokemon", c.id);
    if (rec) { c.name = rec.facts.name; c.set = rec.facts.setName ?? rec.facts.setSlug; c.number = String(rec.facts.number ?? ""); }
  } catch {}
}
console.log(`${out.length} round Pokémon prices >= $${min}`);
for (const c of out) console.log(`${c.id}\t${c.variant}\t$${c.ours}\tflat ${c.flatDays}d\t${c.name ?? "?"} · ${c.set ?? "?"} ${c.number ?? ""}`);
fs.writeFileSync(process.env.TEMP + "/round-pokemon.json", JSON.stringify(out));
process.exit(0);
