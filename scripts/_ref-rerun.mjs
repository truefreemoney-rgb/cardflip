// One-off PROD referee re-run with the clean eBay reads (ungraded + plain Buy It Now), Chris 10-21: "you can use all the
// calls you need under 5,000" for 10-21 only. Backs up ebay_asks first, reads eBay's Browse headroom, keeps >= 1,000 calls
// for sellers, never touches CALLS_PER_DAY in code.
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_ref-rerun.mjs [maxCalls] [--dry]
import fs from "node:fs";
for (const l of fs.readFileSync(".env.ebay.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l.trim());
  if (m && m[2]) process.env[m[1]] = m[2].trim();
}
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const dry = process.argv.includes("--dry");
const want = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 0);

const { db } = await import("../src/lib/db.ts");
const { fetchRateLimits, summarizeRateLimits } = await import("../src/lib/server/ebayRateLimits.ts");
const { runEbayReferee, askCounts } = await import("../src/lib/server/ebayReferee.ts");

const rows = await db.prepare("SELECT * FROM ebay_asks").all();
const stamp = Date.now();
const backup = `.ebay-asks-backup-${stamp}.json`;
fs.writeFileSync(backup, JSON.stringify(rows));
console.log(`backup ${backup}: ${rows.length} rows, manual: ${rows.filter((r) => r.manual).length}`);

const limits = summarizeRateLimits(await fetchRateLimits(), ["Browse"]);
console.log("Browse today:", JSON.stringify(limits));
const browse = limits[0];
const remaining = browse ? browse.remaining : null;
const headroom = remaining == null ? 0 : remaining - 1000;
// runEbayReferee's maxCalls is the UTC day's TOTAL (it stops when today's spent count reaches it), so a second run after
// eBay's 11pm ET window reset adds tonight's new headroom on top of what the first run already spent.
const { todayUtc } = await import("../src/lib/priceSeries.ts");
const spentRow = await db.prepare("SELECT value FROM price_history_meta WHERE key = ?").get(`ebay_referee_${todayUtc()}`);
const spent = Number(spentRow?.value ?? 0);
const add = Math.max(0, Math.min(want || 4000, headroom));
const maxCalls = spent + add;
console.log(`remaining ${remaining}, keeping 1000 for sellers -> ${add} more calls (spent today ${spent}, maxCalls ${maxCalls})`);
if (dry || add < 50) {
  console.log(dry ? "dry: not running" : "too little headroom: not running");
  process.exit(0);
}
const run = await runEbayReferee({ maxCalls, runMs: 100 * 60_000 });
console.log("run", JSON.stringify(run));
console.log("counts", JSON.stringify(await askCounts()));
fs.writeFileSync(`.ebay-asks-after-${stamp}.json`, JSON.stringify(await db.prepare("SELECT * FROM ebay_asks").all()));
process.exit(0);
