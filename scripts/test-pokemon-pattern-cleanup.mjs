/**
 * Pokémon pattern-card cleanup (lib/server/pokemonPriceRefresh.ts). Run: npm run test:patterncleanup
 *
 * Pins (10-21, LESSONS "34 Pokémon pages"): the nightly run drops the old
 * mislabelled "holofoil" row of a pattern card, but never a printing whose
 * product only came back with no market that day (no recent TCGplayer sale),
 * and never anything of a card with a product missing from the day's file.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The module imports lib/db: keep any DB file it opens out of the repo.
const work = mkdtempSync(path.join(tmpdir(), "cardflip-patterncleanup-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { patternVariantsSeen, patternCleanupDeletes } = await import(at("lib/server/pokemonPriceRefresh.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

// sv08.5-001: base product 1 (Normal + Reverse Holofoil) and a Poké Ball product 2 filed as "Holofoil".
// sv08.5-002: base product 3 and a Master Ball product 4. base1-4: one product, 1st Edition twin.
const productToCard = new Map([[1, "sv08.5-001"], [2, "sv08.5-001"], [3, "sv08.5-002"], [4, "sv08.5-002"], [5, "base1-4"]]);
const cardProducts = new Map([["sv08.5-001", 2], ["sv08.5-002", 2], ["base1-4", 1]]);
const patternOf = new Map([[2, "pokeBallPattern"], [4, "masterBallPattern"]]);
const twins = new Set(["base1-4-1st"]);
const group = [1, 2, 3, 4, 5];
const existing = [
  "sv08.5-001|normal", "sv08.5-001|reverseHolofoil", "sv08.5-001|pokeBallPattern", "sv08.5-001|holofoil",
  "sv08.5-002|normal", "sv08.5-002|masterBallPattern", "sv08.5-002|holofoil",
  "base1-4|holofoil",
];
const sorted = (m) => [...m].map(([k, v]) => [k, [...v].sort()]).sort();

console.log("a full day: only the mislabelled holofoil rows go");
{
  const results = [
    { productId: 1, subTypeName: "Normal" }, { productId: 1, subTypeName: "Reverse Holofoil" },
    { productId: 2, subTypeName: "Holofoil" }, { productId: 3, subTypeName: "Normal" },
    { productId: 4, subTypeName: "Holofoil" }, { productId: 5, subTypeName: "Holofoil" },
  ];
  const { seen, unsure } = patternVariantsSeen(results, group, patternOf, productToCard, cardProducts, twins);
  check("seen: pattern product under its pattern, one-product card untracked", sorted(seen),
    [["sv08.5-001", ["normal", "pokeBallPattern", "reverseHolofoil"]], ["sv08.5-002", ["masterBallPattern", "normal"]]]);
  check("nothing unsure", [...unsure], []);
  check("deletes = the two mislabelled holofoil rows", patternCleanupDeletes(seen, unsure, existing),
    [{ cardId: "sv08.5-001", variant: "holofoil" }, { cardId: "sv08.5-002", variant: "holofoil" }]);
}

console.log("a product with no market today still counts as seen");
{
  // The file lists every product, but the Poké Ball one has marketPrice null (no recent sale).
  const results = [
    { productId: 1, subTypeName: "Normal", marketPrice: 0.25 }, { productId: 1, subTypeName: "Reverse Holofoil", marketPrice: 0.5 },
    { productId: 2, subTypeName: "Holofoil", marketPrice: null }, { productId: 3, subTypeName: "Normal", marketPrice: 0.2 },
    { productId: 4, subTypeName: "Holofoil", marketPrice: null }, { productId: 5, subTypeName: "Holofoil", marketPrice: 300 },
  ];
  const { seen, unsure } = patternVariantsSeen(results, group, patternOf, productToCard, cardProducts, twins);
  const del = patternCleanupDeletes(seen, unsure, existing);
  check("the null-market pattern printings are kept", del.some((d) => d.variant.endsWith("Pattern")), false);
  check("the mislabelled rows still go", del.map((d) => `${d.cardId}|${d.variant}`), ["sv08.5-001|holofoil", "sv08.5-002|holofoil"]);
}

console.log("a product left out of the day's file: its card is left alone");
{
  // Master Ball product 4 is missing from today's file altogether.
  const results = [
    { productId: 1, subTypeName: "Normal" }, { productId: 1, subTypeName: "Reverse Holofoil" },
    { productId: 2, subTypeName: "Holofoil" }, { productId: 3, subTypeName: "Normal" }, { productId: 5, subTypeName: "Holofoil" },
  ];
  const { seen, unsure } = patternVariantsSeen(results, group, patternOf, productToCard, cardProducts, twins);
  check("sv08.5-002 is unsure (and its 1st Edition twin id)", [...unsure], ["sv08.5-002", "sv08.5-002-1st"]);
  check("only the complete card is cleaned", patternCleanupDeletes(seen, unsure, existing),
    [{ cardId: "sv08.5-001", variant: "holofoil" }]);
}

console.log("1st Edition variants are tracked under the twin, unstamped twin rows skipped");
{
  const p2c = new Map([[7, "neo1-9"], [8, "neo1-9"], [9, "neo1-9-1st"]]);
  const cp = new Map([["neo1-9", 2], ["neo1-9-1st", 2]]);
  const { seen } = patternVariantsSeen(
    [{ productId: 7, subTypeName: "Holofoil" }, { productId: 8, subTypeName: "1st Edition Holofoil" }, { productId: 9, subTypeName: "Holofoil" }],
    [7, 8, 9], new Map([[7, "pokeBallPattern"]]), p2c, cp, new Set(["neo1-9-1st"]),
  );
  check("neo1-9 sees its pattern; the stamped one goes to the twin; product 9's unstamped line is not the twin's", sorted(seen),
    [["neo1-9", ["pokeBallPattern"]], ["neo1-9-1st", ["1stEditionHolofoil"]]]);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall pattern cleanup checks passed");
