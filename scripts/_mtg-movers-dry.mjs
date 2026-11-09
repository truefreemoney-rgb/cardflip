// Read-only dry run on PROD data with the local code: Magic movers both ways, no cache written.
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const { topMovers } = await import("../src/lib/server/social.ts");
const day = process.argv[2] ?? "2026-11-09";
for (const direction of ["up", "down"]) {
  const t = Date.now();
  const r = await topMovers("mtg", day, { direction, limit: 12 });
  console.log(`\n${day} ${direction}: ${r.length} in ${Date.now() - t} ms`);
  for (const m of r) console.log(`  ${m.name} | ${m.setName} ${m.number} | ${m.from} -> ${m.to} (${Math.round(m.pct)}%) | ${m.cardId}`);
}
process.exit(0);
