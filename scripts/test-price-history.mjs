/**
 * Price history — the compact series codec and the stats behind the chart.
 * Run: npm run test:pricehistory
 *
 * Pins: setDay on empty / append / overwrite / gap-fill / prepend (backfill
 * writes an older day) / cap at MAX_DAYS; toPoints skips gaps; day math
 * across month ends; summarize's 30/90-day windows, change30, single-point
 * and flat-series edge cases; encode/decode round-trip.
 */
import {
  MAX_DAYS,
  addDays,
  dayIndex,
  decodePrices,
  encodePrices,
  setDay,
  toPoints,
  todayUtc,
} from "../src/lib/priceSeries.ts";
import { summarize } from "../src/lib/priceHistoryStats.ts";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

console.log("Day math:");
check("addDays crosses a month end", addDays("2026-01-30", 3), "2026-02-02");
check("dayIndex is inverse of addDays", dayIndex("2026-01-30", "2026-02-02"), 3);
check("dayIndex negative for earlier day", dayIndex("2026-03-01", "2026-02-27"), -2);
check("todayUtc is YYYY-MM-DD", todayUtc(Date.UTC(2026, 7, 16, 23, 59)), "2026-08-16");

console.log("\nsetDay:");
let row = setDay(null, "2026-08-01", 10.004);
check("first point rounds to cents", row, { startDay: "2026-08-01", prices: [10] });
row = setDay(row, "2026-08-02", 11);
check("append next day", row.prices, [10, 11]);
row = setDay(row, "2026-08-02", 12);
check("same day overwrites", row.prices, [10, 12]);
row = setDay(row, "2026-08-05", 15);
check("gap filled with nulls", row.prices, [10, 12, null, null, 15]);
row = setDay(row, "2026-07-30", 9);
check("earlier day prepends and moves start", row, { startDay: "2026-07-30", prices: [9, null, 10, 12, null, null, 15] });
let capped = { startDay: "2020-01-01", prices: new Array(MAX_DAYS).fill(1) };
capped = setDay(capped, addDays("2020-01-01", MAX_DAYS + 1), 2);
check("cap keeps MAX_DAYS and slides start", [capped.prices.length, capped.startDay, capped.prices.at(-1)], [MAX_DAYS, addDays("2020-01-01", 2), 2]);

console.log("\ntoPoints / codec:");
check("toPoints skips gaps", toPoints(row), [
  { day: "2026-07-30", price: 9 }, { day: "2026-08-01", price: 10 }, { day: "2026-08-02", price: 12 }, { day: "2026-08-05", price: 15 },
]);
check("encode/decode round-trip", decodePrices(encodePrices(row.prices)), row.prices);
check("decode tolerates junk", decodePrices("nope"), []);
check("decode coerces non-numbers to null", decodePrices('[1,"x",null,2]'), [1, null, null, 2]);

console.log("\nsummarize:");
const now = Date.UTC(2026, 7, 16, 12);
const day = (n) => addDays("2026-08-16", -n);
const pts = [
  { day: day(100), price: 50 }, { day: day(60), price: 80 }, { day: day(40), price: 70 },
  { day: day(20), price: 60 }, { day: day(5), price: 90 }, { day: day(0), price: 75 },
];
const st = summarize(pts, now);
check("current = last", st.current, 75);
check("30-day low/high", [st.low30, st.high30], [60, 90]);
check("90-day low/high", [st.low90, st.high90], [60, 90]);
check("all-time low/high", [st.lowAll, st.highAll], [50, 90]);
check("change30 vs oldest point in window", Math.round(st.change30), 25);
check("days since first point", st.days, 100);
const single = summarize([{ day: day(0), price: 5 }], now);
check("single point: no windows, no change", [single.low30, single.change30, single.lowAll], [null, null, 5]);
const young = summarize([{ day: day(3), price: 10 }, { day: day(0), price: 12 }], now);
check("young series: change from oldest", Math.round(young.change30), 20);
check("empty → null", summarize([], now), null);

console.log(failures === 0 ? "\nAll price-history checks passed" : `\n${failures} price-history check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
