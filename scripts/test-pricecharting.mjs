/**
 * PriceCharting price-guide parsing (src/lib/pricecharting.ts, 10-18). Run: npm run test:pricecharting
 * Pins: CSV quoting, USD cells, the columns we read, API pennies, product-name tags + number.
 */
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { parseCsv, csvUsd, apiUsd, readPriceGuide, fromApi, parseProductName, pcProductUrl, tagKey, planPcImport } = await import(at("lib/pricecharting.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

check("CSV: quotes, escaped quotes, commas inside, CRLF, BOM", parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""",3\r\n\r\nlast,,\n'), [["a", "b", "c"], ["x, y", 'he said "hi"', "3"], ["last", "", ""]]);
check("CSV: no trailing newline", parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
check("USD cells", [csvUsd("$1,234.56"), csvUsd("17.5"), csvUsd(""), csvUsd("0"), csvUsd("n/a")], [1234.56, 17.5, null, null, null]);
check("API pennies", [apiUsd(1732), apiUsd(0), apiUsd(null)], [17.32, null, null]);

const csv = [
  "id,console-name,product-name,loose-price,cib-price,new-price,graded-price,box-only-price,manual-only-price,sales-volume,tcg-id,release-date",
  '6910,Pokemon Base Set,"Charizard [1st Edition] #4",$9500.00,,,$22000.00,,$350000.00,"1,204",42382,1999-01-09',
  "7001,Pokemon Base Set,Pikachu #58,$3.10,,,,,,88,,1999-01-09",
  ",Pokemon Base Set,no id row,$1.00,,,,,,,,",
].join("\n");
const rows = readPriceGuide(csv);
check("guide: rows with an id only", rows.length, 2);
check("guide: Charizard row", rows[0], { id: "6910", console: "Pokemon Base Set", name: "Charizard [1st Edition] #4", loose: 9500, graded9: 22000, psa10: 350000, salesVolume: 1204, tcgId: "42382", releaseDate: "1999-01-09" });
check("guide: missing tcg-id / grades are null", [rows[1].tcgId, rows[1].graded9, rows[1].loose], [null, null, 3.1]);
let threw = false;
try {
  readPriceGuide("id,name\n1,x");
} catch {
  threw = true;
}
check("guide: a CSV without loose-price is refused", threw, true);

check("API row", fromApi({ status: "success", id: 6910, "console-name": "Pokemon Base Set", "product-name": "Charizard #4", "loose-price": 45000, "sales-volume": "12", "tcg-id": 42382 }), { id: "6910", console: "Pokemon Base Set", name: "Charizard #4", loose: 450, graded9: null, psa10: null, salesVolume: 12, tcgId: "42382", releaseDate: null });
check("API error is null", fromApi({ status: "error", "error-message": "x" }), null);

check("name: tags + number", parseProductName("Charizard [1st Edition] #4"), { base: "Charizard", tags: ["1st Edition"], number: "4" });
check("name: two tags, promo number", parseProductName("Pikachu [Reverse Holo] [Poke Ball] #SWSH039"), { base: "Pikachu", tags: ["Reverse Holo", "Poke Ball"], number: "SWSH039" });
check("name: no number", parseProductName("Black Lotus"), { base: "Black Lotus", tags: [], number: null });
check("tag key", tagKey("Reverse-Holo "), "reverseholo");
check("attribution link", pcProductUrl("6910"), "https://www.pricecharting.com/game/6910");

// Matching (planPcImport). A tiny catalog: product -> card, the card's TCGplayer variants, the cards that exist.
const ctxOf = (map, variants, cards) => ({
  cardsOfTcg: (t) => map[t] ?? [],
  variantsOf: (id) => new Set(variants[id] ?? []),
  hasCard: (id) => cards.includes(id),
});
const P = (id, name, loose, tcgId, salesVolume = 5) => ({ id, console: "x", name, loose, graded9: null, psa10: null, salesVolume, tcgId, releaseDate: null });
const pk = ctxOf(
  { 42382: ["base1-4"], 100: ["neo1-99"], 200: ["sv8-1"], 300: ["sv8-2"], 400: ["xy1-17"], 500: ["dup-1"] },
  {
    "base1-4": ["holofoil"],
    "base1-4-1st": ["1stEditionHolofoil"],
    "neo1-99": ["unlimited"],
    "neo1-99-1st": ["1stEdition"],
    "sv8-1": ["normal", "reverseHolofoil", "pokeBallPattern", "masterBallPattern"],
    "sv8-2": ["normal", "holofoil"],
    "xy1-17": [],
  },
  ["base1-4", "base1-4-1st", "neo1-99", "neo1-99-1st", "sv8-1", "sv8-2", "xy1-17"],
);
const plan = planPcImport("pokemon", [
  P("1", "Charizard #4", 600, "42382"),
  P("2", "Charizard [1st Edition] #4", 9500, "42382"),
  P("3", "Pikachu #1", 0.5, "200"),
  P("4", "Pikachu [Reverse Holo] #1", 1.2, "200"),
  P("5", "Pikachu [Poke Ball] #1", 2.5, "200"),
  P("6", "Pikachu [Master Ball] #1", 30, "200"),
  P("7", "Raichu #2", 4, "300"),
  P("8", "Raichu [Holo] #2", 9, "300"),
  P("9", "Charizard [Shadowless] #4", 1500, "42382"),
  P("10", "Typhlosion [1st Edition] #99", 40, "100"),
  P("11", "No tcg #1", 3, null),
  P("12", "No price #1", null, "200"),
  P("13", "Not ours #1", 3, "999"),
  P("14", "Vivillon #17", 2, "400"),
  P("15", "Pikachu #1 (second row)", 0.6, "200"),
], pk);
const got = Object.fromEntries(plan.writes.map((w) => [w.pcId, `${w.cardId}|${w.variant}|${w.usd}`]));
check("pokemon: plain row -> the card's one plain printing", got["1"], "base1-4|holofoil|600");
check("pokemon: [1st Edition] -> the -1st twin's 1st Edition variant", got["2"], "base1-4-1st|1stEditionHolofoil|9500");
check("pokemon: [Reverse Holo] and ball patterns", [got["4"], got["5"], got["6"]], ["sv8-1|reverseHolofoil|1.2", "sv8-1|pokeBallPattern|2.5", "sv8-1|masterBallPattern|30"]);
check("pokemon: plain row on normal + reverse + patterns -> normal", got["3"], "sv8-1|normal|0.5");
check("pokemon: normal + holofoil: plain is ambiguous, [Holo] picks holofoil", [got["7"], got["8"]], [undefined, "sv8-2|holofoil|9"]);
check("pokemon: an unknown tag is another printing (Shadowless) and is skipped", "9" in got, false);
check("pokemon: 1st Edition non-holo twin", got["10"], "neo1-99-1st|1stEdition|40");
check("pokemon: skip counts", plan.skipped, { "no price": 1, "no tcg-id": 1, "unknown product": 1, "other printing": 1, "no such variant": 1, ambiguous: 1, duplicate: 1 });

const mtg = planPcImport("mtg", [P("m1", "Sol Ring #1", 2, "77"), P("m2", "Sol Ring [Foil] #1", 9, "77"), P("m3", "Sol Ring [Foil Etched] #1", 12, "77"), P("m4", "Two cards #2", 1, "88")], ctxOf({ 77: ["uuid-a"], 88: ["uuid-b", "uuid-c"] }, { "uuid-a": ["nonfoil", "foil"] }, []));
check("mtg: nonfoil / foil by tag, etched only when the card has it", mtg.writes.map((w) => `${w.cardId}|${w.variant}`), ["uuid-a|nonfoil", "uuid-a|foil"]);
check("mtg: two cards on one tcg-id is ambiguous", mtg.skipped.ambiguous, 1);

const ygo = planPcImport("yugioh", [P("y1", "Dark Magician [1st Edition] LOB-005", 120, "555"), P("y2", "Dark Magician LOB-005", 40, "555"), P("y3", "Missing", 1, "556")], ctxOf({}, {}, ["ygo-555", "ygo-555-1st"]));
check("yugioh: ygo-<tcg-id>, [1st Edition] -> the -1st twin", ygo.writes.map((w) => `${w.cardId}|${w.variant}|${w.usd}`), ["ygo-555-1st|normal|120", "ygo-555|normal|40"]);
check("yugioh: unknown id skipped", ygo.skipped["unknown product"], 1);

// The fence: readers that take ANY USD series must skip source 'pricecharting' until the PC-first switch is made on purpose.
const { readFileSync } = await import("node:fs");
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const anyUsd = (text) => [...text.matchAll(/FROM price_series[\s\S]{0,200}?(?:currency = 'USD'|source <> 'tcgdex-cm'|source NOT IN)[^`"]*/g)].map((m) => m[0]);
const leaks = [...anyUsd(src("lib/server/priceHistory.ts")), ...anyUsd(src("lib/server/enCards.ts"))].filter((q) => !/source = 'tcgplayer'/.test(q) && !q.includes("pricecharting"));
check("every any-USD price_series reader skips 'pricecharting'", leaks, []);

console.log(failures === 0 ? "\nall green" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
