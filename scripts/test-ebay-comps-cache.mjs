/**
 * eBay Browse comps: one call per card per day. Run: npm run test:compscache
 *
 * Pins: first lookup fetches and stores; second lookup for the same
 * card/grading/edition replays without calling eBay; a different grade or
 * edition is its own key; null ("nothing comparable") is cached too; a
 * row older than 24h refetches; a fetch error is not cached.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-compscache-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { cachedEbayComps, compsCacheKey, getCachedComps, putCachedComps } = await import(at("lib/server/ebayCompsCache.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const card = { id: "base1-4", name: "Charizard", number: "4", setName: "Base Set" };
const comps = { average: 100, count: 3, listings: [] };
let calls = 0;
const fetcher = () => { calls++; return Promise.resolve(comps); };

let r = await cachedEbayComps(card, null, null, fetcher);
check("first lookup fetches", [r.cached, r.comps.average, calls], [false, 100, 1]);
r = await cachedEbayComps(card, null, null, fetcher);
check("second lookup replays, no eBay call", [r.cached, r.comps.average, calls], [true, 100, 1]);

await cachedEbayComps(card, { company: "PSA", grade: "10" }, null, fetcher);
check("graded is its own key", calls, 2);
await cachedEbayComps(card, null, true, fetcher);
check("1st Edition is its own key", calls, 3);
check(
  "keys differ",
  new Set([compsCacheKey(card, null, null), compsCacheKey(card, { company: "PSA", grade: "10" }, null), compsCacheKey(card, null, true)]).size,
  3,
);

const nothing = { id: "x-1", name: "Nobody", number: "1", setName: "Nowhere" };
let nullCalls = 0;
const nullFetcher = () => { nullCalls++; return Promise.resolve(null); };
await cachedEbayComps(nothing, null, null, nullFetcher);
r = await cachedEbayComps(nothing, null, null, nullFetcher);
check("null answer is cached too", [r.cached, r.comps, nullCalls], [true, null, 1]);

const key = compsCacheKey(card, null, null);
await putCachedComps(key, comps, Date.now() - 25 * 60 * 60 * 1000);
check("25h-old row is a miss", (await getCachedComps(key)) === undefined);
r = await cachedEbayComps(card, null, null, fetcher);
check("stale row refetches", [r.cached, calls], [false, 4]);

const idless = { name: "Pikachu", number: "25", setName: "Base Set" };
check("no id: key from name|set|number", compsCacheKey(idless, null, null).includes("Pikachu|Base Set|25"), true);

let threw = false;
try {
  await cachedEbayComps(nothing, { company: "CGC", grade: "9" }, null, () => Promise.reject(new Error("eBay 503")));
} catch {
  threw = true;
}
check(
  "fetch error propagates and is not cached",
  [threw, await getCachedComps(compsCacheKey(nothing, { company: "CGC", grade: "9" }, null))],
  [true, undefined],
);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
