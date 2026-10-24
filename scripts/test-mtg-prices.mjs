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

// 10-13: the cheapest-listing cap. Over 1.5x the listing takes the listing; at or under stays; under $10 and CardTrader rows untouched.
{
  const { capToListing } = await import("../src/lib/server/mtgPriceRefresh.ts");
  const rows = [
    { id: "cromat", usd: 3, foil: 155.59, etched: null, eur: null, eurFoil: null },
    { id: "drum", usd: null, foil: 60, etched: null, eur: null, eurFoil: null },
    { id: "cheap", usd: 9, foil: null, etched: null, eur: null, eurFoil: null },
    { id: "ct", usd: 90, foil: null, etched: null, eur: null, eurFoil: null, source: "cardtrader" },
  ];
  const ids = new Map([["cromat", 1], ["drum", 2], ["cheap", 3], ["ct", 4]]);
  const at = (low) => ({ low, mid: null });
  const lows = new Map([[1, { Normal: at(1), Foil: at(57.3) }], [2, { Foil: at(41.99) }], [3, { Normal: at(1) }], [4, { Normal: at(10) }]]);
  const r = capToListing(rows, ids, lows);
  check("cap: Cromat foil $155.59 -> $57.30, drum $60 stays (1.43x), cheap and CardTrader untouched",
    [r.capped, rows.map((x) => [x.usd, x.foil]), r.lows.map((l) => `${l.cardId}|${l.variant}|${l.lowUsd}`)],
    [1, [[3, 57.3], [null, 60], [9, null], [90, null]], ["cromat|foil|57.3", "drum|foil|41.99"]]);
}
{
  // 10-16: soft cap. Pre-1996 printings and $100+ listings take 1.45x the listing; cheap modern ones still take the listing.
  const { capToListing } = await import("../src/lib/server/mtgPriceRefresh.ts");
  const rows = [
    { id: "blaze", usd: 900, foil: null, etched: null, eur: null, eurFoil: null }, // Alpha, listing $400
    { id: "jace", usd: null, foil: 300, etched: null, eur: null, eurFoil: null }, // 2010 foil, listing $134
    { id: "cromat", usd: null, foil: 155.59, etched: null, eur: null, eurFoil: null }, // 2001 foil, listing $57.30
    { id: "bog", usd: 70, foil: null, etched: null, eur: null, eurFoil: null }, // Alpha, $55 listing, 1.27x: no cap
  ];
  const ids = new Map([["blaze", 1], ["jace", 2], ["cromat", 3], ["bog", 4]]);
  const at = (low) => ({ low, mid: null });
  const lows = new Map([[1, { Normal: at(400) }], [2, { Foil: at(134) }], [3, { Foil: at(57.3) }], [4, { Normal: at(55) }]]);
  const released = new Map([["blaze", "1993-08-05"], ["jace", "2010-02-05"], ["cromat", "2001-06-04"], ["bog", "1993-08-05"]]);
  const r = capToListing(rows, ids, lows, released);
  check("soft cap: Alpha $900 -> $580 (1.45x $400), Jace foil $300 -> $194.30, Cromat foil -> $57.30, Bog $70 untouched",
    [r.capped, rows.map((x) => x.usd ?? x.foil)],
    [3, [580, 194.3, 57.3, 70]]);
}
{
  // 10-24: one cheap copy is not the market. Middle listing at or over the price: no cap, no low for the guard, key trusted.
  // A middle listing under the price (most copies cheaper) still caps.
  const { capToListing } = await import("../src/lib/server/mtgPriceRefresh.ts");
  const rows = [
    { id: "heroic", usd: 13.87, foil: null, etched: null, eur: null, eurFoil: null }, // MAR 34: $7.67 + $5.99 shipping, mid $14.99
    { id: "opposition", usd: null, foil: 124.99, etched: null, eur: null, eurFoil: null }, // UDS foil: $77.99 LP, mid $139.69
    { id: "even", usd: 20, foil: null, etched: null, eur: null, eurFoil: null }, // mid exactly the price: trusted
    { id: "stale", usd: null, foil: 155.59, etched: null, eur: null, eurFoil: null }, // mid $60 under the price: caps
  ];
  const ids = new Map([["heroic", 1], ["opposition", 2], ["even", 3], ["stale", 4]]);
  const lows = new Map([[1, { Normal: { low: 7.67, mid: 14.99 } }], [2, { Foil: { low: 77.99, mid: 139.69 } }], [3, { Normal: { low: 9, mid: 20 } }], [4, { Foil: { low: 57.3, mid: 60 } }]]);
  const r = capToListing(rows, ids, lows);
  check("mid: Heroic $13.87, Opposition foil $124.99, even $20 stay; stale foil $155.59 -> $57.30",
    [r.capped, rows.map((x) => x.usd ?? x.foil), r.lows.map((l) => `${l.cardId}|${l.variant}`), r.trusted],
    [1, [13.87, 124.99, 20, 57.3], ["stale|foil"], ["heroic|nonfoil", "opposition|foil", "even|nonfoil"]]);
}
{
  // 10-13: blank printings take Scryfall's Cardmarket euro price in dollars under the converted source; series go to that source.
  const { fillFromEuro } = await import("../src/lib/server/mtgPriceRefresh.ts");
  const rows = [
    { id: "lotus", usd: null, foil: null, etched: null, eur: 33768.47, eurFoil: null },
    { id: "chocobo", usd: null, foil: null, etched: null, eur: null, eurFoil: 50 },
    { id: "none", usd: null, foil: null, etched: null, eur: null, eurFoil: null },
  ];
  const n = fillFromEuro(rows, 1.1);
  check("euro fill: Lotus EUR 33,768.47 -> $37,145.32, foil-only fills foil, no euro stays blank",
    [n, rows.map((r) => [r.usd, r.foil, r.source ?? null])],
    [2, [[37145.32, null, "cardmarket-converted"], [null, 55, "cardmarket-converted"], [null, null, null]]]);
  const plan = planMtgWrites(rows.slice(0, 1), new Map([["lotus", { id: "lotus", usd: null, foil: null, etched: null, eur: 33768.47, eurFoil: null }]]), new Map(), "2026-10-13");
  check("euro fill: its series is written under cardmarket-converted", plan.upserts.map((u) => [u.cardId, u.variant, u.source]), [["lotus", "nonfoil", "cardmarket-converted"]]);
}console.log(`\nmtg prices: ${passed} checks pass`);
