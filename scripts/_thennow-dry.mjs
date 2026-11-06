import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl; process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const S = await import("../src/lib/server/social.ts");
const { ensureSchedule } = await import("../src/lib/server/socialSchedule.ts");
await ensureSchedule();
const day = process.argv[2] ?? "2026-11-06";
for (const game of ["pokemon", "mtg"]) {
  const trace = [];
  const t0 = Date.now();
  const m = await S.thenNow(game, day, { trace });
  console.log("==", game, day, "pick:", m ? m.name + " " + m.cardId + " " + m.from.toFixed(2) + " -> " + m.to.toFixed(2) : "none", (Date.now() - t0) + " ms");
  for (const t of trace) console.log("  ", t.cardId, t.variant, "then", t.then.toFixed(2), "now", t.now.toFixed(2), "x" + t.ratio.toFixed(2), "| mid", t.mid ?? "-", "mkt/mid", t.mid ? (t.now / t.mid).toFixed(2) : "-", "| ask", t.medianAsk ?? "-", "|", t.why || "OK");
}
process.exit(0);