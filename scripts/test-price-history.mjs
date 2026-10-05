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
import { kitHalves, mapKitProducts, mapProductsToCards, matchGroupsToSets, normalizeSetName, productNumber, tcgplayerProductPattern, tcgplayerVariantKey } from "../src/lib/tcgcsv.ts";

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

console.log("\nPattern products (TCGplayer files Poké Ball / Master Ball reverses as their own product):");
check("Poke Ball Pattern product", tcgplayerProductPattern("Harlequin (Poke Ball Pattern)"), "pokeBallPattern");
check("Poké Ball with accent and hyphen", tcgplayerProductPattern("Heatmor (Poké-Ball Pattern)"), "pokeBallPattern");
check("Master Ball Pattern product", tcgplayerProductPattern("Snivy (Master Ball Pattern)"), "masterBallPattern");
check("plain product is not a pattern", tcgplayerProductPattern("Harlequin - 083/086"), null);
check("null name", tcgplayerProductPattern(null), null);

// 10-05: the 30th Celebration sets sat priceless. Subset shares the parent code + date; Classic Collection prints original numbers.
{
  const sets = [
    { name: "30th Celebration", code: "30C", released: "2026-09-16" },
    { name: "30th Classic Collection", code: "", released: "2026-09-16" },
  ];
  const groups = [
    { groupId: 2, name: "ME: 30th Celebration Classic Collection", abbreviation: "30C", publishedOn: "2026-09-16T00:00:00" },
    { groupId: 1, name: "ME: 30th Celebration", abbreviation: "30C", publishedOn: "2026-09-16T00:00:00" },
  ];
  const m = matchGroupsToSets(groups, sets);
  check("subset sharing the code does not take the parent set", [m.get(1), m.get(2)], ["30th Celebration", "30th Classic Collection"]);
  const num = (v) => [{ name: "Number", value: v }];
  const cards = [
    { id: "c-001", number: "001", name: "Charizard" },
    { id: "c-004", number: "004", name: "Genesect EX" },
    { id: "c-019", number: "019", name: "Darkrai & Cresselia LEGEND" },
    { id: "c-020", number: "020", name: "Darkrai & Cresselia LEGEND" },
    { id: "c-022", number: "022", name: "Palkia" },
  ];
  const products = [
    { productId: 10, name: "Charizard", extendedData: num("4/102") },
    { productId: 11, name: "Genesect EX (Team Plasma)", extendedData: num("11/101") },
    { productId: 12, name: "Darkrai & Cresselia Legend (Bottom)", extendedData: num("100/102") },
    { productId: 13, name: "Darkrai & Cresselia Legend (Top)", extendedData: num("99/102") },
    { productId: 14, name: "Lugia", extendedData: num("149/147") },
    { productId: 15, name: "Palkia LV.X", extendedData: num("106/106") },
  ];
  check("reprint subset maps by name, LEGEND halves by order", Object.fromEntries(mapProductsToCards(products, cards)), { 10: "c-001", 11: "c-004", 12: "c-020", 13: "c-019", 15: "c-022" });
  const plain = [{ productId: 20, name: "Pikachu - 036/128", extendedData: num("036/128") }, { productId: 21, name: "Booster Pack" }];
  check("a normal set still maps by number", Object.fromEntries(mapProductsToCards(plain, [{ id: "p-036", number: "036", name: "Pikachu" }])), { 20: "p-036" });
}

// 10-05 price-gap sweep: kits split in two, prerelease stamps in a promo group, McDonald's / POP names and dates.
{
  const num = (v) => [{ name: "Number", value: v }];
  const halves = kitHalves("XY Trainer Kit: Sylveon & Noivern", ["XY trainer Kit (Sylveon)", "XY trainer Kit (Noivern)", "XY trainer Kit (Latias)"]);
  check("kit group finds both decks", halves?.map((h) => h.tag), ["sylveon", "noivern"]);
  const decks = [
    { tag: "sylveon", cards: [{ id: "s2", number: "2", name: "Fairy Energy" }, { id: "s4", number: "4", name: "Switch" }] },
    { tag: "noivern", cards: [{ id: "n2", number: "2", name: "Gourgeist" }, { id: "n4", number: "4", name: "Bunnelby" }, { id: "n29", number: "29", name: "Switch" }] },
  ];
  const kit = mapKitProducts([
    { productId: 1, name: "Fairy Energy (#2)", extendedData: num("2/30") },
    { productId: 2, name: "Gourgeist", extendedData: num("2/30") },
    { productId: 3, name: "Switch (Sylveon)", extendedData: num("4/30") },
    { productId: 4, name: "Switch (Noivern)", extendedData: num("4/30") },
  ], decks);
  check("kit products need number AND name; a named deck wins", Object.fromEntries(kit), { 1: "s2", 2: "n2", 3: "s4", 4: "n29" });
  const promos = mapProductsToCards([
    { productId: 1, name: "Pikachu Delta - 035", extendedData: num("035") },
    { productId: 2, name: "Ivysaur - 35/100 (Prerelease)", extendedData: num("35/100") },
    { productId: 3, name: "Kyogre ex - 037", extendedData: num("037") },
    { productId: 4, name: "Dark Ivysaur - 6 [Winner]", extendedData: num("006/009") },
  ], [{ id: "p35", number: "35", name: "Pikachu δ" }, { id: "p37", number: "37", name: "Kyogre ex" }, { id: "p6", number: "6", name: "Dark Ivysaur" }]);
  check("prerelease stamps and [Winner] copies never take a promo number", Object.fromEntries(promos), { 1: "p35", 3: "p37" });
  const m = matchGroupsToSets(
    [{ groupId: 1, name: "McDonald's Promos 2014", abbreviation: "M14", publishedOn: "2014-05-23T00:00:00" }, { groupId: 2, name: "POP Series 5", abbreviation: "POP", publishedOn: "2026-10-05T00:00:00" }],
    [{ name: "McDonald's Collection 2014", code: "", released: "2014-05-23" }, { name: "POP Series 5", code: "", released: "2007-03-01" }],
  );
  check("McDonald's alias + an exact name beats a bad date", [m.get(1), m.get(2)], ["McDonald's Collection 2014", "POP Series 5"]);
}

console.log(failures === 0 ? "\nAll price-history checks passed" : `\n${failures} price-history check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
