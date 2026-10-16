/**
 * listCache stale-while-revalidate (09-16 incident: the admin console's
 * catalog walk is slower than the function timeout on a cold memo, so the
 * first admin visit after the TTL returned nothing and sign-in hung).
 * Run: npm run test:listcache
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-listcache-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { db } = await import(at("lib/db.ts"));
const { cachedList, cachedListSwr, cachedStaleOk } = await import(at("lib/server/listCache.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TTL = 1000;
const now = Date.now();

// Warm the one-time next/server import so the timing check below measures
// the helper, not module loading.
await cachedListSwr("t:warm", TTL, async () => ({ n: 1 }), { n: 0 }, now);
await sleep(50);

// Missing memo: the fallback comes back at once, the build runs afterwards.
let builds = 0;
const slowBuild = async () => { builds++; await sleep(150); return { n: 42 }; };
const t0 = Date.now();
const first = await cachedListSwr("t:catalog", TTL, slowBuild, { n: 0 }, now);
check("missing memo → fallback, flagged stale", first, { value: { n: 0 }, stale: true });
check("missing memo → returned before the build finished", Date.now() - t0 < 150);
await sleep(300);
check("build ran in the background", builds, 1);
check("background build stored the memo", await cachedList("t:catalog", TTL, async () => ({ n: -1 })), { n: 42 });

// Fresh memo: the value, not stale, no build.
const fresh = await cachedListSwr("t:catalog", TTL, slowBuild, { n: 0 }, Date.now());
check("fresh memo → cached value", fresh, { value: { n: 42 }, stale: false });
await sleep(50);
check("fresh memo → no build", builds, 1);

// Stale memo: the old value right now, a refresh behind it.
const stale = await cachedListSwr("t:catalog", TTL, async () => { builds++; return { n: 43 }; }, { n: 0 }, Date.now() + TTL + 1);
check("stale memo → old value, flagged stale", stale, { value: { n: 42 }, stale: true });
await sleep(100);
check("stale memo → refreshed behind the response", builds, 2);
check("refresh stored the new value", await cachedList("t:catalog", TTL, async () => ({ n: -1 })), { n: 43 });

// A broken builder never breaks the page.
const broken = await cachedListSwr("t:other", TTL, async () => { throw new Error("turso down"); }, { n: 7 }, now);
check("failing build → fallback", broken, { value: { n: 7 }, stale: true });
await sleep(50);

// 10-16: sitemap files. First ask builds; fresh replays; stale answers the old copy NOW and rebuilds later; a failed
// rebuild keeps the old copy; an empty list is still a valid answer.
{
  const T0 = 1_000_000;
  let builds = 0;
  const later = [];
  const deps = { later: (fn) => later.push(fn) };
  const b = (v) => async () => { builds++; return v; };
  check("stale-ok: first ask builds and answers", [await cachedStaleOk("swr-ok", 1000, b(["a"]), T0, deps), builds, later.length], [["a"], 1, 0]);
  check("stale-ok: fresh replays without a build", [await cachedStaleOk("swr-ok", 1000, b(["b"]), T0 + 10, deps), builds], [["a"], 1]);
  check("stale-ok: stale answers the old copy at once, rebuild queued", [await cachedStaleOk("swr-ok", 1000, b(["c"]), T0 + 5000, deps), builds, later.length], [["a"], 1, 1]);
  await later.shift()();
  check("stale-ok: the queued rebuild stores the new copy", [await cachedStaleOk("swr-ok", 10 ** 12, b(["d"]), Date.now(), deps), builds], [["c"], 2]);
  await cachedStaleOk("swr-ok", 1, async () => { throw new Error("turso down"); }, Date.now() + 10_000, deps);
  await later.shift()();
  check("stale-ok: a failed rebuild keeps serving the old copy", await cachedStaleOk("swr-ok", 10 ** 12, b(["e"]), Date.now(), deps), ["c"]);
  check("stale-ok: an empty file is a real answer, kept", [await cachedStaleOk("swr-empty", 1000, b([]), T0, deps), await cachedStaleOk("swr-empty", 1000, b(["x"]), T0 + 1, deps)], [[], []]);
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(new URL("../src/app/sitemaps/[name]/route.ts", import.meta.url), "utf8");
  check("sitemap route serves the stored copy", route.includes("await cachedCardSitemapEntries(file.game, file.chunk)"));
}

await db.close?.();
console.log(failures === 0 ? "\nAll listCache checks passed" : `\n${failures} listCache check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
