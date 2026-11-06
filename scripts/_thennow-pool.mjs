import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl; process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const S = await import("../src/lib/server/social.ts");
const { tcgplayerMids } = await import("../src/lib/server/tcgplayerMids.ts");
const { ensureSchedule } = await import("../src/lib/server/socialSchedule.ts");
await ensureSchedule();
const day = process.argv[2] ?? "2026-11-06";
const empty = async () => new Map();
let t0 = Date.now(); await S.thenNow("mtg", day, { mids: empty, asks: empty }); console.log("mtg no checks", Date.now() - t0, "ms");
t0 = Date.now(); const r = await tcgplayerMids("mtg", [{ cardId: "4fe22cd8-31e6-491b-bce2-db257668eb92", variant: "nonfoil" }]); console.log("mtg mids", Date.now() - t0, "ms", [...r]);
for (const game of ["pokemon"]) {
  const ex = new Set();
  for (let i = 0; i < 8; i++) {
    const trace = [];
    const m = await S.thenNow(game, day, { trace, exclude: ex });
    for (const t of trace) { console.log("  ", t.cardId, t.variant, "then", t.then.toFixed(2), "now", t.now.toFixed(2), "x" + t.ratio.toFixed(2), "| mid", t.mid ?? "-", "mkt/mid", t.mid ? (t.now / t.mid).toFixed(2) : "-", "| ask", t.medianAsk ?? "-", "|", t.why || "OK"); ex.add(t.cardId); }
    if (!m) break;
  }
}
process.exit(0);