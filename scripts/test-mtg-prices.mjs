/**
 * Magic daily price job: resume + retry.
 * Run: npm run test:mtgprices
 *
 * Pins (09-30): the Magic job died at statement 110/352 on one Turso
 * "SQLITE_IOERR: disk I/O error", and a slow week (09-16 → 09-23) timed it out
 * daily, silently. planMtgWrites must write only mirror rows whose prices
 * moved and skip series already written today, so a killed run resumes where
 * it stopped; withDbRetry must retry transient Turso failures and never retry
 * BLOCKED (plan limit), constraint or SQL errors. The resume case also runs
 * end to end on a throwaway DB: write half, re-plan, get exactly the rest.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-mtgprices-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const { planMtgWrites } = await import("../src/lib/server/mtgPriceRefresh.ts");
const { withDbRetry, isTransientDbError, upsertSeriesRows, readSeriesMap } = await import("../src/lib/server/priceBulkWrite.ts");

let passed = 0;
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); passed++; console.log(`  PASS  ${label}`); };

const TODAY = "2026-09-30";
const row = (id, usd, foil = null, etched = null, eur = null, eurFoil = null) => ({ id, usd, foil, etched, eur, eurFoil });
const ser = (startDay, prices, updatedDay) => ({ startDay, prices: JSON.stringify(prices), updatedDay });

// --- planMtgWrites ---------------------------------------------------------
const mirror = new Map([
  ["m_moved", row("m_moved", 1, 2)],
  ["m_same", row("m_same", 3, null, null, 2.8)],
  ["m_eur", row("m_eur", 4, null, null, 3.5)],
  ["m_etched", row("m_etched", null, null, 7)],
  ["m_penny", row("m_penny", null)],
  ["m_tracked_penny", row("m_tracked_penny", 0.06)],
  ["m_done", row("m_done", 5)],
]);
const pending = [
  row("m_moved", 1.2, 2),
  row("m_same", 3, null, null, 2.8),
  row("m_eur", 4, null, null, 3.9),
  row("m_etched", null, null, 7.5),
  row("m_penny", 0.02),
  row("m_tracked_penny", 0.03),
  row("m_done", 5.25),
  row("m_not_carried", 10),
];
const series = new Map([
  ["m_moved|nonfoil", ser("2026-09-29", [1], "2026-09-29")],
  ["m_tracked_penny|nonfoil", ser("2026-09-29", [0.06], "2026-09-29")],
  ["m_done|nonfoil", ser("2026-09-29", [5, 5.25], TODAY)],
]);
const plan = planMtgWrites(pending, mirror, series, TODAY);
const keys = (upserts) => upserts.map((u) => `${u.cardId}|${u.variant}`).sort();

check("ids we don't carry are dropped", plan.kept.some((c) => c.id === "m_not_carried"), false);
check("mirror rows are written only when a price moved (a EUR-only move counts)",
  plan.mirrorRows.map((r) => r.id).sort(), ["m_done", "m_etched", "m_eur", "m_moved", "m_penny", "m_tracked_penny"]);
check("a series already written today is skipped (resume)", [plan.seriesSkipped, keys(plan.upserts).includes("m_done|nonfoil")], [1, false]);
check("an unchanged price still gets today's point",
  plan.upserts.find((u) => u.cardId === "m_same")?.prices, "[3]");
check("today's point appends to yesterday's series",
  plan.upserts.find((u) => u.cardId === "m_moved" && u.variant === "nonfoil")?.prices, "[1,1.2]");
check("foil and etched get their own series",
  keys(plan.upserts).filter((k) => k.startsWith("m_moved|") || k.startsWith("m_etched|")), ["m_etched|etched", "m_moved|foil", "m_moved|nonfoil"]);
check("a new sub-5¢ card starts no series; a tracked one keeps getting points",
  [keys(plan.upserts).includes("m_penny|nonfoil"), plan.upserts.find((u) => u.cardId === "m_tracked_penny")?.prices], [false, "[0.06,0.03]"]);
check("every upsert is stamped today, game mtg, source tcgplayer",
  plan.upserts.every((u) => u.updatedDay === TODAY && u.game === "mtg" && u.source === "tcgplayer" && u.currency === "USD"), true);

// --- resume end to end (throwaway DB) --------------------------------------
// The 09-30 shape: the run dies part way through the series writes. The
// re-run must write exactly the rest, and a third run nothing.
await upsertSeriesRows([...series].map(([k, s]) => {
  const [cardId, variant] = k.split("|");
  return { cardId, game: "mtg", variant, source: "tcgplayer", currency: "USD", ...s };
}));
const firstHalf = plan.upserts.slice(0, 3);
await upsertSeriesRows(firstHalf);
const afterCrash = await readSeriesMap("mtg", "tcgplayer");
const resumed = planMtgWrites(pending, mirror, afterCrash, TODAY);
check("a resumed run writes exactly what the killed run did not",
  keys(resumed.upserts), keys(plan.upserts.slice(3)));
check("…and counts the rest as skipped", resumed.seriesSkipped, plan.seriesSkipped + firstHalf.length);
await upsertSeriesRows(resumed.upserts);
const done = planMtgWrites(pending, mirror, await readSeriesMap("mtg", "tcgplayer"), TODAY);
check("a run after a finished day writes no series", done.upserts.length, 0);
const tomorrow = planMtgWrites(pending, mirror, await readSeriesMap("mtg", "tcgplayer"), "2026-10-01");
check("the next day writes every tracked series again", tomorrow.upserts.length, plan.upserts.length + 1);
check("the resumed point landed on the right day (no double point)",
  tomorrow.upserts.find((u) => u.cardId === "m_moved" && u.variant === "nonfoil")?.prices, "[1,1.2,1.2]");

// --- withDbRetry / isTransientDbError --------------------------------------
const err = (message, code) => Object.assign(new Error(message), code ? { code } : {});
const warn = console.warn;
console.warn = () => {};
const run = async (errors, opts = {}) => {
  const sleeps = [];
  let calls = 0;
  try {
    const value = await withDbRetry(async () => {
      calls++;
      if (calls <= errors.length) throw errors[calls - 1];
      return "ok";
    }, { ...opts, sleep: async (ms) => { sleeps.push(ms); } });
    return { value, calls, sleeps };
  } catch (e) {
    return { thrown: e.code ?? e.message, calls, sleeps };
  }
};
const ioerr = err("SQLITE_IOERR: disk I/O error", "SQLITE_IOERR");

const twoThenOk = await run([ioerr, err("fetch failed")]);
check("the 09-30 IOERR and a dropped fetch are retried, then succeed", [twoThenOk.value, twoThenOk.calls], ["ok", 3]);
check("backoff is 0.5s then 1s (+ at most 25% jitter)",
  twoThenOk.sleeps.map((ms, i) => ms >= 500 * 2 ** i && ms <= 625 * 2 ** i), [true, true]);
check("BLOCKED (plan limit) is never retried", await run([err("BLOCKED: Operation was blocked", "BLOCKED")]).then((r) => [r.thrown, r.calls]), ["BLOCKED", 1]);
check("a BLOCKED message behind another code is never retried",
  await run([err("SERVER_ERROR: BLOCKED: reads are blocked", "SERVER_ERROR")]).then((r) => r.calls), 1);
check("constraint errors are never retried",
  await run([err("UNIQUE constraint failed: price_series.card_id", "SQLITE_CONSTRAINT")]).then((r) => [r.thrown, r.calls]), ["SQLITE_CONSTRAINT", 1]);
check("SQL errors are never retried", await run([err("no such table: price_series", "SQLITE_ERROR")]).then((r) => r.calls), 1);
const always = await run(Array(9).fill(ioerr));
check("gives up after 5 attempts with the last error", [always.thrown, always.calls, always.sleeps.length], ["SQLITE_IOERR", 5, 4]);
check("transient shapes Turso throws are recognised",
  [
    err("SQLITE_BUSY: database is locked", "SQLITE_BUSY"),
    err("HRANA_WEBSOCKET_ERROR: socket closed", "HRANA_WEBSOCKET_ERROR"),
    err("STREAM_EXPIRED: the stream has expired", "STREAM_EXPIRED"),
    err("SERVER_ERROR: Server returned HTTP status 503", "SERVER_ERROR"),
    err("SERVER_ERROR: Server returned HTTP status 429", "SERVER_ERROR"),
    err("read ECONNRESET"),
  ].map(isTransientDbError),
  [true, true, true, true, true, true]);
check("ordinary errors are not transient",
  [err("SERVER_ERROR: Server returned HTTP status 400", "SERVER_ERROR"), err("Cannot read properties of undefined"), "plain string"].map(isTransientDbError),
  [false, false, false]);
console.warn = warn;

console.log(`\nmtg prices: ${passed} checks pass`);
