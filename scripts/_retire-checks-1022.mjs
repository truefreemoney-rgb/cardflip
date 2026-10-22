// One-off (10-22 12:10am ET, Chris "do whatever you think is best"): retire the 27 eBay-set checks that TCGplayer's own
// Near Mint sales contradict (docs/REPORT-CARD-2026-10-21.md §7). retireCheck = off_day set; the card goes back to
// TCGplayer's market from the next nightly write. --dry lists only.
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_retire-checks-1022.mjs [--dry]
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const dry = process.argv.includes("--dry");
const { retireCheck } = await import("../src/lib/server/checkedPrices.ts");
const { dropCardLists } = await import("../src/lib/server/cardPages.ts");
const { todayUtc } = await import("../src/lib/priceSeries.ts");
const LIST = [
  ["pokemon", "ex1-101", "holofoil"], ["pokemon", "sm3-150", "holofoil"], ["pokemon", "ecard3-145", "reverseHolofoil"],
  ["pokemon", "ex7-105", "normal"], ["pokemon", "hgss1-123", "reverseHolofoil"], ["pokemon", "dp3-3", "reverseHolofoil"],
  ["pokemon", "ex7-103", "holofoil"], ["pokemon", "sm8-227", "holofoil"], ["pokemon", "ex2-99", "holofoil"],
  ["mtg", "49852fa3-272c-4ca4-b0dc-0b80f2982fd9", "foil"], ["pokemon", "ex6-116", "holofoil"], ["pokemon", "hgss2-94", "holofoil"],
  ["pokemon", "bw10-105", "holofoil"], ["pokemon", "ex1-102", "holofoil"], ["pokemon", "bw7-142", "holofoil"],
  ["pokemon", "hgss2-95", "holofoil"], ["pokemon", "base1-15", "holofoil"], ["pokemon", "ex1-98", "holofoil"],
  ["pokemon", "2016xy-7", "holofoil"], ["pokemon", "col1-91", "holofoil"], ["pokemon", "ex11-11", "holofoil"],
  ["pokemon", "pop4-13", "holofoil"], ["pokemon", "ex1-3", "holofoil"], ["pokemon", "hgssp-HGSS17", "holofoil"],
  ["yugioh", "ygo-78160", "normal"], ["yugioh", "ygo-78073", "normal"], ["yugioh", "ygo-90812", "normal"],
];
// Second pass 12:25am (the 7 whose product match missed, looked up by product id): 6 of 7 lose to TCGplayer's sales too.
const LIST_B = [
  ["yugioh", "ygo-90821", "normal"], ["yugioh", "ygo-90811", "normal"], ["yugioh", "ygo-90819", "normal"],
  ["yugioh", "ygo-58774", "normal"], ["yugioh", "ygo-58739-1st", "normal"], ["pokemon", "dpp-DP28", "holofoil"],
];
const ACTIVE = process.argv.includes("--b") ? LIST_B : LIST;
console.log(`${ACTIVE.length} checks to retire${dry ? " (dry)" : ""}`);
let n = 0;
for (const [game, cardId, variant] of ACTIVE) {
  if (dry) { console.log(`would retire ${game} ${cardId} ${variant}`); continue; }
  const ok = await retireCheck(game, cardId, variant, todayUtc());
  if (ok) { n++; try { await dropCardLists(game, cardId); } catch {} }
  console.log(`${ok ? "retired" : "NOT active"} ${game} ${cardId} ${variant}`);
}
console.log(`retired ${n}`);
process.exit(0);
