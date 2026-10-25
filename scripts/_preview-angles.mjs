// READ ONLY preview of what an angle would post on a day, from prod data (the same builders the render uses).
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_preview-angles.mjs <YYYY-MM-DD> <kind:game> [kind:game ...]
//   kinds: thennow, guess, top, versus, sleepers, set (game: pokemon | mtg | lorcana | onepiece | yugioh)
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const [day, ...picks] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "") || !picks.length) { console.error("usage: <day> <kind:game> ..."); process.exit(2); }
const S = await import("../src/lib/server/social.ts");
const { ensureSchedule } = await import("../src/lib/server/socialSchedule.ts");
await ensureSchedule();
const row = (m) => `${m.name} | ${m.setName} ${m.number} ${m.variant ?? ""} | ${m.cardId} | from ${m.from} to ${m.to} pct ${Math.round((m.pct ?? 0) * 10) / 10}${m.unsettled ? " (no week)" : ""}${m.thenDay ? ` then ${m.thenDay}` : ""}`;
for (const p of picks) {
  const [kind, game] = p.split(":");
  try {
    if (kind === "thennow") { const m = await S.thenNow(game, day); console.log(`${p}: ${m ? row(m) : "none"}`); if (m) console.log(S.thenNowCaption(game, m)); }
    else if (kind === "guess") { const m = await S.guessCard(game, day); console.log(`${p}: ${m ? row(m) : "none"}`); if (m) console.log(S.guessCaption(game, [m])); }
    else if (kind === "top") { const ms = await S.topByPrice(game, day); console.log(`${p}: ${ms.length} cards`); ms.forEach((m) => console.log("  " + row(m))); if (ms.length) console.log(S.topCaption(game, ms)); }
    else if (kind === "versus") { const pr = await S.pair(game, day); console.log(`${p}: ${pr ? row(pr.a) + "  VS  " + row(pr.b) : "none"}`); if (pr) console.log(S.versusCaption(game, pr)); }
    else if (kind === "sleepers") { const ms = await S.sleepers(game, day); console.log(`${p}: ${ms.length} cards`); ms.forEach((m) => console.log("  " + row(m))); }
    else if (kind === "set") { const sp = await S.setSpotlight(game, day); console.log(`${p}: ${sp ? sp.setName : "none"}`); sp?.cards.forEach((m) => console.log("  " + row(m))); }
    else console.log(`${p}: unknown kind`);
  } catch (e) { console.log(`${p}: ERROR ${e instanceof Error ? e.message : e}`); }
  console.log("");
}
process.exit(0);
