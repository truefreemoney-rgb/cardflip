// READ ONLY: today's sleeper candidates (Pokémon) with the two proposed tests: 7-day peak / today, TCGplayer market / mid listing.
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl; process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const { topMovers, SLEEPER_MIN, SLEEPER_MAX } = await import("../src/lib/server/social.ts");
const { db } = await import("../src/lib/db.ts");
const { tcgcsvFetch } = await import("../src/lib/server/tcgcsv.ts");
const game = process.argv[2] ?? "pokemon"; const cat = game === "mtg" ? 1 : 3;
const list = (await topMovers(game, undefined, { direction: "up", limit: 30, minPrice: SLEEPER_MIN, band: [SLEEPER_MIN, SLEEPER_MAX] })).filter(m => m.to < 5 && m.pct >= 15);
const ids = list.map(m => m.cardId);
const prod = (await db.prepare(`SELECT card_id, product_id, group_id FROM tcgplayer_products WHERE game = ? AND card_id IN (${ids.map(() => "?").join(",")})`).all(game, ...ids));
const groups = new Map();
const SUB = { normal: "Normal", holofoil: "Holofoil", reverseHolofoil: "Reverse Holofoil", nonfoil: "Normal", foil: "Foil", "1stEdition": "1st Edition", "1stEditionHolofoil": "1st Edition Holofoil" };
for (const m of list) {
  const s = await db.prepare("SELECT prices FROM price_series WHERE card_id = ? AND variant = ? AND source = 'tcgplayer'").get(m.cardId, m.variant);
  const p = s ? JSON.parse(s.prices).slice(-8).filter(x => x != null) : [];
  const peak = Math.max(...p); const pr = (peak / m.to).toFixed(2);
  const pp = prod.filter(r => r.card_id === m.cardId);
  let mid = null;
  for (const r of pp) {
    if (!groups.has(r.group_id)) { const res = await tcgcsvFetch(`https://tcgcsv.com/tcgplayer/${cat}/${r.group_id}/prices`); groups.set(r.group_id, res.ok ? (await res.json()).results : []); }
    const hit = groups.get(r.group_id).find(x => x.productId === Number(r.product_id) && x.subTypeName === SUB[m.variant]);
    if (hit) mid = hit.midPrice;
  }
  console.log(`${m.cardId.padEnd(14)} ${m.variant.padEnd(16)} ${m.from.toFixed(2)} -> ${m.to.toFixed(2)} +${m.pct.toFixed(0)}%  peak/to ${pr}  mid ${mid ?? "?"}  mkt/mid ${mid ? (m.to / mid).toFixed(2) : "?"}  | ${m.name} (${m.setName})`);
}
process.exit(0);