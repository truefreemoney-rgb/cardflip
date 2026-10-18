// Day-1 PriceCharting check (docs/PRICECHARTING-DAY1.md): the 10-17 eBay sold sample (docs/price-sim-2026-10-17,
// 94 scored cards) re-scored with the IMPORTED PriceCharting prices (price_series source 'pricecharting').
// Bar to beat: PriceCharting-first 78% within 25% of eBay sold (hand-copied PC prices), site 62%.
// Read-only. node scripts/pc-rescore.mjs [--prod]
import fs from "node:fs";
import { createClient } from "@libsql/client";

const prod = process.argv.includes("--prod");
const c = prod
  ? (() => {
      const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
      return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
    })()
  : createClient({ url: "file:data/cardflip.db" });

const within = (v, ebay) => v != null && v > 0 && Math.abs(v - ebay) <= 0.25 * ebay;
const last = (prices) => {
  const a = JSON.parse(prices);
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i];
  return null;
};
const totals = { n: 0, site: 0, pcHand: 0, handFirst: 0, imported: 0, importedHave: 0, pcFirst: 0 };
const perGame = {};
for (const game of ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"]) {
  const rows = JSON.parse(fs.readFileSync(`docs/price-sim-2026-10-17/result-${game}.json`, "utf8").replace(/^﻿/, "")).filter((r) => r.ebay > 0);
  const g = (perGame[game] = { n: 0, site: 0, pcHand: 0, handFirst: 0, imported: 0, importedHave: 0, pcFirst: 0 });
  for (const r of rows) {
    const s = (await c.execute({ sql: "SELECT prices FROM price_series WHERE card_id = ? AND variant = ? AND source = 'pricecharting'", args: [r.id, r.variant] })).rows[0];
    const imp = s ? last(String(s.prices)) : null;
    // "PC first" as it would run: the imported number where there is one, else our own.
    const first = imp ?? r.ours;
    for (const t of [g, totals]) {
      t.n++;
      if (within(r.ours, r.ebay)) t.site++;
      if (within(r.pc, r.ebay)) t.pcHand++;
      if (within(r.pc ?? r.ours, r.ebay)) t.handFirst++;
      if (imp != null) t.importedHave++;
      if (within(imp, r.ebay)) t.imported++;
      if (within(first, r.ebay)) t.pcFirst++;
    }
    if (imp != null && r.pc != null && Math.abs(imp - r.pc) > 0.25 * r.pc) console.log(`  differs from the hand copy: ${game} ${r.id} ${r.variant} imported $${imp} vs hand $${r.pc} (${r.pcTitle ?? ""})`);
  }
}
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
for (const [game, g] of [...Object.entries(perGame), ["ALL", totals]]) {
  console.log(`${game.padEnd(9)} n=${String(g.n).padStart(3)}  site ${pct(g.site, g.n).padStart(4)}  PC by hand ${pct(g.pcHand, g.n).padStart(4)} (PC-first by hand ${pct(g.handFirst, g.n).padStart(4)})  imported ${g.importedHave}/${g.n} matched, right ${pct(g.imported, g.importedHave).padStart(4)}  PC-first as built ${pct(g.pcFirst, g.n).padStart(4)}`);
}
console.log("Bar: PC-first must beat 78% overall (and not lose a game) before the switch.");
