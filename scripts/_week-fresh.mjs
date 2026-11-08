// Read-only: builds the Sunday week mail's facts fresh from PROD (no cache write), prints the card rows.
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const { weekFacts } = await import("../src/lib/server/campaignData.ts");
const t = Date.now();
const p = await weekFacts(Date.now(), false, true);
console.log("built in", Date.now() - t, "ms");
const fmt = (m) => `${m.game} | ${m.name} | ${m.set} ${m.number} ${m.printing ?? ""} | ${m.before} -> ${m.price} (${Math.round(m.pct)}%) | ${m.url}`;
for (const m of p.moves) console.log("MOVE", fmt(m));
console.log("JUMP", p.jump ? fmt(p.jump) : null);
console.log("SET", JSON.stringify(p.set));
if (p.sleeper) console.log("SLEEPER", fmt(p.sleeper));
for (const g of p.games) console.log("GAME", JSON.stringify(g).slice(0, 300));
process.exit(0);
