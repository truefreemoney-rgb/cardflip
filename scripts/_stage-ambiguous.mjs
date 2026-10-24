// Read-only (10-24): which TCG stage cards ambiguousByNumber sits out, per game. Prod reads only.
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_stage-ambiguous.mjs
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const { getGameStageCards } = await import("../src/lib/server/stageCards.ts");
const { ambiguousByNumber } = await import("../src/lib/server/social.ts");
const { db } = await import("../src/lib/db.ts");
for (const game of ["yugioh", "onepiece", "lorcana"]) {
  const cards = (await getGameStageCards(game)).cards.filter((c) => c.imageUrl && c.price != null && c.price > 0 && c.id);
  const pool = game === "onepiece" ? cards.filter((c) => c.lead) : cards;
  const nums = [...new Set(pool.map((c) => c.number).filter(Boolean))];
  const twins = nums.length ? await db.prepare(`SELECT id, set_name, collector_number, COALESCE(price_usd, price_usd_foil) AS price FROM tcg_cards WHERE game = ? AND collector_number IN (${nums.map(() => "?").join(",")})`).all(game, ...nums) : [];
  const out = pool.filter((c) => ambiguousByNumber(game, { id: c.id, setName: c.setName, price: c.price }, twins.filter((t) => t.collector_number === c.number).map((t) => ({ id: t.id, setName: t.set_name, price: t.price }))));
  console.log(`${game}: pool ${pool.length}, sits out ${out.length}, keeps ${pool.length - out.length}`);
  for (const c of out.slice(0, 6)) console.log(`   out: ${c.name} ${c.setName} ${c.number} $${c.price}`);
}
process.exit(0);
