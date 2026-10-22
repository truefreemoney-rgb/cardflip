// Read-only (10-22): the active hand-set prices (price_checked, off_day IS NULL) with card name / set / number, our
// checked price vs TCGplayer's current number, for the TCGplayer-first hand redo.
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_checks-named.mjs
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const { db } = await import("../src/lib/db.ts");
const { loadCardRecord } = await import("../src/lib/server/cardPages.ts");
const rows = await db.prepare("SELECT game, card_id, variant, usd, n, day, note, tcg_usd, tcg_day FROM price_checked WHERE off_day IS NULL ORDER BY usd DESC").all();
console.log(`${rows.length} active checks`);
for (const r of rows) {
  let label = "?";
  try {
    const rec = await loadCardRecord(r.game, r.card_id);
    if (rec) label = `${rec.facts.name} · ${rec.facts.setName ?? rec.facts.setSlug} ${rec.facts.number ?? ""}`;
  } catch {}
  const ratio = r.tcg_usd ? (r.tcg_usd / r.usd).toFixed(2) : "-";
  console.log(`${r.game}\t${r.card_id}\t${r.variant}\tours $${r.usd} (n ${r.n}, ${r.day})\tTCG $${r.tcg_usd ?? "-"} (${r.tcg_day ?? "-"}) x${ratio}\t${label}\t${(r.note ?? "").slice(0, 60)}`);
}
process.exit(0);
