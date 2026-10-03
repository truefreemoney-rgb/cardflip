/**
 * Server log (10-03): console.warn / console.error land in error_events and
 * show on /admin/errors, so a prod fault no longer needs Vercel's runtime log.
 * Run: npm run test:serverlog
 *
 * Pins: the console hook records both levels with the formatted line and the
 * stack when one was logged; warnings never count toward the error KPI or the
 * digest groups; the table is a ring buffer capped at 500 rows; patching twice
 * is a no-op; a console.error fired from inside the writer cannot loop.
 *
 * Throwaway db: chdir to a temp dir before any import.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-serverlog-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { reportServerError, listRecentErrors, errorCount24h, errorGroups24h, captureConsole } = await import(
  at("lib/server/errorLog.ts")
);
const { db } = await import(at("lib/db.ts"));

let failures = 0;
const realLog = console.log;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  realLog(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}
const settle = () => new Promise((r) => setTimeout(r, 150));

// --- levels ------------------------------------------------------------------
await reportServerError("api/scan", new Error("vision timeout"));
await reportServerError("cron/social", "Instagram 400 on publish", undefined, "warn");
check("default level is error", (await listRecentErrors()).map((e) => e.level).sort(), ["error", "warn"]);
check("warnings do not count toward the KPI", await errorCount24h(), 1);
check("warnings stay out of the digest groups", (await errorGroups24h()).map((g) => g.source), ["api/scan"]);

// --- console hook ------------------------------------------------------------
const originalError = console.error;
const originalWarn = console.warn;
let passedThrough = 0;
console.error = () => { passedThrough++; };
console.warn = () => { passedThrough++; };
captureConsole();
captureConsole(); // second call must not double-wrap
const wrappedError = console.error;

console.warn("eBay %s returned %d", "GB", 429);
const boom = new Error("publish failed");
console.error("social publish:", boom);
await settle();
check("original console methods still run", passedThrough, 2);
const rows = await listRecentErrors();
const warnRow = rows.find((e) => e.level === "warn" && e.source === "console");
const errRow = rows.find((e) => e.level === "error" && e.source === "console");
check("console.warn recorded with util.format text", warnRow?.message, "eBay GB returned 429");
check("console.error recorded as the whole line", errRow?.message?.startsWith("social publish: Error: publish failed") ?? false);
check("console.error carries the logged Error's stack", typeof errRow?.stack === "string" && errRow.stack.includes("publish failed"));
check("KPI counts the console error, not the warning", await errorCount24h(), 2);

// a console.error fired during the write path must not recurse forever
const before = rows.length;
console.error("a"); console.error("b"); console.error("c");
await settle();
check("burst of three adds three rows", (await listRecentErrors()).length, before + 3);

// --- ring buffer -------------------------------------------------------------
const now = Date.now();
const insert = db.prepare(
  "INSERT INTO error_events (id, at, source, level, message, stack, digest) VALUES (?, ?, ?, 'warn', 'filler', NULL, NULL)",
);
for (let i = 0; i < 520; i++) await insert.run(`fill-${i}`, now - 1000 - i, "filler");
await reportServerError("api/last", new Error("newest"));
const total = await db.prepare("SELECT COUNT(*) AS n FROM error_events").get();
check("table is capped at 500 rows after a write", total.n, 500);
check("newest row survives the cap", (await listRecentErrors(1))[0].message, "newest");

check("console.error is still the wrapped function (no double patch)", console.error === wrappedError);
console.error = originalError;
console.warn = originalWarn;

realLog(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
