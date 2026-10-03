/**
 * The /admin eBay call-cap readout (10-03): summarizeRateLimits turns eBay's
 * getRateLimits answer into one row per watched API, the tightest resource
 * deciding the row. No API call. Run: npm run test:ebayratelimits
 */
let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { summarizeRateLimits, WATCHED_APIS, GROWTH_CHECK_LINE } = await import(at("lib/server/ebayRateLimits.ts"));

// Shaped like eBay's real answer: apiContext/apiName/resources/rates.
const sample = {
  rateLimits: [
    { apiContext: "sell", apiName: "Inventory", apiVersion: "v1", resources: [
      { name: "sell.inventory", rates: [{ limit: 5000, remaining: 4100, reset: "2026-10-04T07:00:00.000Z", timeWindow: 86400 }] },
      { name: "sell.inventory.offer.publish", rates: [{ limit: 1000, remaining: 100, reset: "2026-10-04T07:00:00.000Z", timeWindow: 86400 }] },
    ] },
    { apiContext: "sell", apiName: "Fulfillment", apiVersion: "v1", resources: [{ name: "sell.fulfillment", rates: [{ limit: 2500000, remaining: 2499990, reset: "2026-10-04T07:00:00.000Z", timeWindow: 86400 }] }] },
    { apiContext: "buy", apiName: "Browse", apiVersion: "v1", resources: [{ name: "buy.browse", rates: [{ limit: 5000, remaining: 5000, timeWindow: 86400 }] }] },
    { apiContext: "sell", apiName: "Marketing", apiVersion: "v1", resources: [{ name: "sell.marketing", rates: [{ limit: 5000, remaining: 0, timeWindow: 86400 }] }] },
  ],
};
const rows = summarizeRateLimits(sample);
check("one row per watched API that eBay reported, in our order; Marketing (unused) left out", rows.map((r) => r.api), ["Inventory", "Fulfillment", "Browse"]);
check("Inventory's row is its tightest resource (publish: 900 of 1,000), not the roomy one", rows[0], { api: "Inventory", resource: "sell.inventory.offer.publish", limit: 1000, remaining: 100, used: 900, resetAt: Date.parse("2026-10-04T07:00:00.000Z"), windowSeconds: 86400 });
check("a grown-up cap reads as such; a missing reset is null", [rows[1].limit >= GROWTH_CHECK_LINE, rows[2].resetAt], [true, null]);
check("nothing reported → no rows, no throw", summarizeRateLimits({}), []);
check("a zero limit is skipped rather than divided by", summarizeRateLimits({ rateLimits: [{ apiName: "Inventory", resources: [{ name: "x", rates: [{ limit: 0, remaining: 0 }] }] }] }), []);
check("the watched list names the APIs CardFlip calls", WATCHED_APIS.slice(0, 3), ["Inventory", "Fulfillment", "Finances"]);

console.log(fails === 0 ? "\nAll eBay rate-limit checks passed." : `\n${fails} eBay rate-limit check(s) FAILED.`);
process.exit(fails === 0 ? 0 : 1);
