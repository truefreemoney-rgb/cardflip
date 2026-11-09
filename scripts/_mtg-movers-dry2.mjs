// Read-only dry run on PROD data with the local code: every Magic pick that reads the moves, so a pick that goes empty shows up.
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const S = await import("../src/lib/server/social.ts");
const line = (m) => `${m.name} | ${m.setName} ${m.number} | ${m.from} -> ${m.to} (${Math.round(m.pct)}%)${m.unsettled ? " unsettled" : ""}`;
for (const day of ["2026-11-09", "2026-11-10"]) {
  console.log(`\n== ${day}`);
  const sl = await S.sleepers("mtg", day).catch((e) => `ERR ${e}`);
  console.log("sleepers", Array.isArray(sl) ? sl.length : sl); if (Array.isArray(sl)) sl.forEach((m) => console.log("  ", line(m)));
  const p = await S.pair("mtg", day).catch((e) => `ERR ${e}`);
  console.log("pair", p && p.a ? `${line(p.a)} VS ${line(p.b)}` : p);
  const g = await S.gameGainer("mtg", day).catch((e) => `ERR ${e}`);
  console.log("gameGainer", g && g.name ? line(g) : g);
  const c = await S.cardOfTheDay("mtg", day).catch((e) => `ERR ${e}`);
  console.log("cardOfTheDay", c && c.name ? line(c) : c);
  const gs = await S.guessCard("mtg", day).catch((e) => `ERR ${e}`);
  console.log("guessCard", gs && gs.name ? line(gs) : gs);
}
process.exit(0);
