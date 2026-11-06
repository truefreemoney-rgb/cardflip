import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl; process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const S = await import("../src/lib/server/social.ts");
const { ensureSchedule } = await import("../src/lib/server/socialSchedule.ts");
await ensureSchedule();
const r = await S.cachedSocialDrafts("pokemon", "2026-11-06", { fresh: true, kinds: ["movers", "thennow", "versus"] });
for (const d of r.drafts) console.log(d.kind, "|", (d.caption || "").slice(0, 110).replace(/\n/g, " "));
process.exit(0);