/**
 * PriceCharting price-guide parsing (src/lib/pricecharting.ts, 10-18). Run: npm run test:pricecharting
 * Pins: CSV quoting, USD cells, the columns we read, API pennies, product-name tags + number.
 */
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { parseCsv, csvUsd, apiUsd, readPriceGuide, fromApi, parseProductName, pcProductUrl, tagKey } = await import(at("lib/pricecharting.ts"));

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

console.log(failures === 0 ? "\nall green" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
