// Local end-to-end run of the nightly eBay referee against the LOCAL database (data/cardflip.db), small call cap. 10-13.
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_ref-run.mjs [maxCalls]
import fs from "node:fs";
for (const l of fs.readFileSync(".env.ebay.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l.trim());
  if (m && m[2]) process.env[m[1]] = m[2].trim();
}
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
const { runEbayReferee, refereeCandidates, listAsks, askCounts } = await import("../src/lib/server/ebayReferee.ts");
const cands = await refereeCandidates();
const byGame = cands.reduce((m, c) => ((m[c.card.game] = (m[c.card.game] ?? 0) + 1), m), {});
console.log("candidates", cands.length, byGame);
const run = await runEbayReferee({ maxCalls: Number(process.argv[2] ?? 60) });
console.log("run", run);
console.log("counts", await askCounts());
for (const k of ["high", "check"]) for (const r of await listAsks(k, 15)) console.log(k, `$${r.price}`, r.label, "|", r.reason, "| mid", r.median, "upper", r.q75, "n", r.nNm);
process.exit(0);
