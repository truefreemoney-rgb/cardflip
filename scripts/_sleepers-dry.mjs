// READ ONLY: what today's sleepers pick would be with the new guards (prod data, tcgcsv mids).
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl; process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const { sleepers } = await import("../src/lib/server/social.ts");
for (const g of ["pokemon", "mtg"]) { const t = Date.now(); const l = await sleepers(g); console.log(g, `${Date.now() - t} ms`, l.map((m) => `${m.name} ${m.from.toFixed(2)} -> ${m.to.toFixed(2)} +${m.pct.toFixed(0)}%`).join(" | ")); }
process.exit(0);