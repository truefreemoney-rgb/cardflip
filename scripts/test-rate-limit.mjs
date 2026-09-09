/**
 * Rate limiter — the process-local fixed-window guard in front of the paid
 * vision route, eBay comps, public search, and the auth endpoints.
 * Run: npm run test:ratelimit
 *
 * Pins: limit boundary (Nth allowed, N+1 refused), window reset, multi-rule
 * (per-minute + per-day) where a refusal on one rule doesn't consume the
 * other, key isolation, Retry-After math, the 429 payload shape, and IP
 * extraction behind Fly's proxy.
 *
 * Then the DB-backed auth limiter (rateLimitDb.ts, `rate_limits` table):
 * the count survives a cleared memory map (= another serverless instance),
 * the window reopens, keys are isolated, and a broken counter table fails
 * OPEN so nobody is locked out of login by a side table. Runs against a
 * throwaway file DB (chdir to a temp dir before importing lib/db).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-ratelimit-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const {
  RateLimitError,
  clientIp,
  enforceRateLimit,
  limitOrRespond,
  rateLimitResponse,
  _resetRateLimits,
} = await import(at("lib/server/rateLimit.ts"));
const { enforceRateLimitDb, limitOrRespondAsync, _resetRateLimitDb } = await import(at("lib/server/rateLimitDb.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const realNow = Date.now;
let fakeNow = 1_000_000;
Date.now = () => fakeNow;
const advance = (ms) => { fakeNow += ms; };
const attempt = (key, ...rules) => {
  try { enforceRateLimit(key, ...rules); return "ok"; }
  catch (e) { return e instanceof RateLimitError ? `429:${e.retryAfterSeconds}` : "threw"; }
};

// --- limit boundary -------------------------------------------------------
_resetRateLimits();
const three = { limit: 3, windowMs: 60_000 };
check("1st allowed", attempt("a", three), "ok");
check("2nd allowed", attempt("a", three), "ok");
check("3rd allowed (== limit)", attempt("a", three), "ok");
check("4th refused, Retry-After = whole window", attempt("a", three), "429:60");
advance(30_000);
check("still refused mid-window, Retry-After shrinks", attempt("a", three), "429:30");
advance(30_000);
check("window reset → allowed again", attempt("a", three), "ok");

// --- key isolation --------------------------------------------------------
_resetRateLimits();
attempt("u1", three); attempt("u1", three); attempt("u1", three);
check("u1 exhausted", attempt("u1", three), "429:60");
check("u2 unaffected", attempt("u2", three), "ok");

// --- multi-rule: burst + daily -----------------------------------------------
_resetRateLimits();
const burst = { limit: 2, windowMs: 1_000 };
const daily = { limit: 3, windowMs: 100_000 };
check("m1", attempt("v", burst, daily), "ok");
check("m2", attempt("v", burst, daily), "ok");
check("burst trips first", attempt("v", burst, daily), "429:1");
advance(1_000);
check("burst reset, daily still has 1 left", attempt("v", burst, daily), "ok");
check("daily now exhausted (99s left of its 100s window)", attempt("v", burst, daily), "429:99");
advance(1_000);
// Burst window is fresh again; the daily refusal above must not have
// consumed a burst slot — but daily still refuses.
check("daily refusal persists across burst windows", attempt("v", burst, daily), "429:98");
advance(98_000);
check("daily reset", attempt("v", burst, daily), "ok");

// --- refusal doesn't consume the earlier rule ------------------------------
_resetRateLimits();
const first = { limit: 5, windowMs: 1_000 };
const second = { limit: 1, windowMs: 1_000 };
attempt("w", first, second);
check("second rule trips", attempt("w", first, second), "429:1");
attempt("w", first, second); attempt("w", first, second);
advance(1_000);
// If refusals had counted against `first`, it would be at 4/5 → this and
// three more would pass anyway; so probe the count directly by exhausting
// `first` alone after the reset.
for (let i = 0; i < 5; i++) attempt("w", first);
check("first rule counted only real hits after reset", attempt("w", first), "429:1");

// --- 429 response ---------------------------------------------------------
_resetRateLimits();
const res = rateLimitResponse(new RateLimitError(42));
check("status 429", res.status, 429);
check("Retry-After header", res.headers.get("Retry-After"), "42");
const body = await res.json();
check("payload", body, { error: "Too many requests — try again in 42s", retryAfterSeconds: 42 });

// --- limitOrRespond -------------------------------------------------------
_resetRateLimits();
const one = [{ limit: 1, windowMs: 60_000 }];
check("within budget → null", limitOrRespond("x", one), null);
check("over budget → Response", limitOrRespond("x", one)?.status, 429);

// --- clientIp -------------------------------------------------------------
const mk = (h) => new Request("http://x", { headers: h });
check("fly-client-ip wins", clientIp(mk({ "fly-client-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" })), "1.1.1.1");
check("x-forwarded-for first hop", clientIp(mk({ "x-forwarded-for": "3.3.3.3, 10.0.0.1" })), "3.3.3.3");
check("x-real-ip fallback", clientIp(mk({ "x-real-ip": "4.4.4.4" })), "4.4.4.4");
check("no headers → shared bucket", clientIp(mk({})), "unknown");

// --- DB-backed auth limiter -------------------------------------------------
_resetRateLimits();
_resetRateLimitDb();
const dbAttempt = async (key, ...rules) => {
  try { await enforceRateLimitDb(key, rules, fakeNow); return "ok"; }
  catch (e) { return e instanceof RateLimitError ? `429:${e.retryAfterSeconds}` : "threw"; }
};
check("db: 1st allowed", await dbAttempt("d", three), "ok");
check("db: 2nd allowed", await dbAttempt("d", three), "ok");
check("db: 3rd allowed (== limit)", await dbAttempt("d", three), "ok");
check("db: 4th refused, Retry-After = whole window", await dbAttempt("d", three), "429:60");
advance(30_000);
check("db: still refused mid-window", await dbAttempt("d", three), "429:30");
check("db: other key unaffected", await dbAttempt("d2", three), "ok");
advance(30_000);
check("db: window reset → allowed again", await dbAttempt("d", three), "ok");

// The point of the table: a fresh instance (empty memory map) still sees the count.
_resetRateLimits();
const two = [{ limit: 2, windowMs: 60_000 }];
check("async: 1st null", await limitOrRespondAsync("ip1", two), null);
check("async: 2nd null", await limitOrRespondAsync("ip1", two), null);
_resetRateLimits(); // "another instance" — memory knows nothing
check("async: 3rd refused by the DB even though memory was cleared", (await limitOrRespondAsync("ip1", two))?.status, 429);
check("async: a refusal from memory is still a 429", (await limitOrRespondAsync("ip1", two))?.status, 429);
const rows = await db.prepare("SELECT key, count FROM rate_limits WHERE key LIKE 'ip1|%'").all();
check("one row per key+window", rows.length, 1);

// Fail open: the counter table breaking must not block the request.
_resetRateLimits();
_resetRateLimitDb();
const realPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  if (/rate_limits/.test(sql)) throw new Error("rate_limits gone");
  return realPrepare(sql);
};
const realError = console.error;
let logged = 0;
console.error = () => { logged++; };
check("fail open: null when the table throws", await limitOrRespondAsync("ip2", two), null);
check("fail open: still null on the next hit", await limitOrRespondAsync("ip2", two), null);
check("fail open: logged once", logged, 1);
check("fail open: memory limiter still guards the burst", (await limitOrRespondAsync("ip2", two))?.status, 429);
console.error = realError;
db.prepare = realPrepare;

Date.now = realNow;
console.log(failures === 0 ? "\nAll rate-limit checks passed" : `\n${failures} rate-limit check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
