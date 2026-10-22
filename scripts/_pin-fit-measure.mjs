// READ ONLY: how each cached draft fits Pinterest's 500 chars (TASKS B: the pack pin kept only 1-2 of the 5 cards).
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_pin-fit-measure.mjs
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const { db } = await import("../src/lib/db.ts");
const { fitText } = await import("../src/lib/server/socialPublish.ts");
const { pinterestFields, PINTEREST_MAX_CHARS } = await import("../src/lib/server/sites/pinterest.ts");
const rows = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'social_drafts:%'").all();
for (const r of rows) {
  let v;
  try { v = JSON.parse(r.value); } catch { continue; }
  const drafts = Array.isArray(v) ? v : v.drafts ?? [];
  console.log(`\n== ${r.key} (${drafts.length} drafts)`);
  for (const d of drafts) {
    const fitted = fitText(d, PINTEREST_MAX_CHARS, Infinity, false);
    const { description } = pinterestFields(fitted);
    const priceLines = (t) => t.split("\n").filter((l) => /\$\d/.test(l)).length;
    console.log(`${d.kind} | ${d.title} | caption ${d.caption.length} (${priceLines(d.caption)} $lines) | short ${d.shortCaption?.length} (${priceLines(d.shortCaption ?? "")} $lines) | fitted ${fitted.length} (${priceLines(fitted)} $lines) | desc ${description.length}`);
  }
}
process.exit(0);
