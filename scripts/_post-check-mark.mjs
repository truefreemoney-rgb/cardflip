// One-off (10-21): record "Looks right" marks on PROD for the post cards I checked myself (TCGplayer first, eBay sold
// fallback), the same write /api/admin/post-check does on "ok". Lists today's + tomorrow's post cards; --mark marks the
// unchecked ones of the day given (default tomorrow ET) as ok.
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_post-check-mark.mjs [--mark] [--day YYYY-MM-DD]
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const mark = process.argv.includes("--mark");
const dayArg = process.argv[process.argv.indexOf("--day") + 1];

const { postSlots, setMark } = await import("../src/lib/server/postCheck.ts");
const slots = await postSlots();
const tomorrow = slots.find((s) => s.label.startsWith("Tomorrow"))?.day;
const day = process.argv.includes("--day") ? dayArg : tomorrow;
for (const s of slots) {
  console.log(`${s.label} (${s.day} ${s.slot}${s.past ? ", past" : ""}): ${s.title}`);
  for (const c of s.cards) console.log(`  [${c.status}] ${c.game} ${c.cardId} ${c.variant} · ${c.label} · $${c.price}`);
}
if (!mark) { console.log("(list only; --mark to record)"); process.exit(0); }
let n = 0;
for (const s of slots.filter((s) => s.day === day)) {
  for (const c of s.cards.filter((c) => c.status === "unchecked")) {
    await setMark(day, c.game, c.cardId, c.variant, true);
    n++;
    console.log(`marked ok: ${c.game} ${c.cardId} ${c.variant}`);
  }
}
console.log(`marked ${n} for ${day}`);
process.exit(0);
