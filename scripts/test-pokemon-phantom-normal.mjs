/**
 * Phantom "normal" printings (lib/server/phantomNormals.ts). Run: npm run test:phantomnormal
 *
 * Pins (10-24, hand list): a holo-only card whose ONE TCGplayer product also lists a "Normal" printing (Regice ex EM 98
 * "normal" $350 from one mislabelled holo sale over the holo's $299.99) loses that line, but never an MEP promo's plain
 * product filed as Normal beside a separate stamped Holofoil product, never a card TCGdex says has a normal printing
 * (POP Series), and never a card that would be left with no priced holo line.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The module imports lib/db: keep any DB file it opens out of the repo.
const work = mkdtempSync(path.join(tmpdir(), "cardflip-phantomnormal-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { normalBesideHolo, storedNormalBesideHolo, tcgdexHoloOnly, dropPhantomNormals, withoutPhantomNormalRow } = await import(at("lib/server/phantomNormals.ts"));
const { encodePrices } = await import(at("lib/priceSeries.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

console.log("normalBesideHolo: one product listing both printings is the suspect shape");
{
  // 88660 Regice ex (Holofoil + Normal), 85991 Gyarados DX 8 (Holofoil + Reverse + Normal, Normal unpriced today),
  // 654596/656802 Inteleon MEP 002 (plain product filed Normal, stamped product Holofoil), 89999 a common (Normal + Reverse),
  // 7 a Poké Ball pattern product, 107014 Base Set Shadowless mapped to the 1st Edition twin.
  const productToCard = new Map([
    [88660, "ex9-98"], [85991, "ex8-8"], [654596, "mep-002"], [656802, "mep-002"], [89999, "ex9-60"], [7, "sv08.5-001"], [107014, "base1-19-1st"],
  ]);
  const results = [
    { productId: 88660, subTypeName: "Holofoil", marketPrice: 299.99 }, { productId: 88660, subTypeName: "Normal", marketPrice: 350 },
    { productId: 85991, subTypeName: "Holofoil", marketPrice: 274.6 }, { productId: 85991, subTypeName: "Reverse Holofoil", marketPrice: 300 },
    { productId: 85991, subTypeName: "Normal", marketPrice: null },
    { productId: 654596, subTypeName: "Normal", marketPrice: 12.22 }, { productId: 656802, subTypeName: "Holofoil", marketPrice: 40.29 },
    { productId: 89999, subTypeName: "Normal", marketPrice: 0.25 }, { productId: 89999, subTypeName: "Reverse Holofoil", marketPrice: 1.1 },
    { productId: 7, subTypeName: "Holofoil", marketPrice: 3 }, { productId: 7, subTypeName: "Normal", marketPrice: 2 },
    { productId: 107014, subTypeName: "Holofoil", marketPrice: 127 }, { productId: 107014, subTypeName: "Normal", marketPrice: 90 },
  ];
  check("Regice ex and Gyarados (unpriced Normal still listed) are suspects; MEP, the common, the pattern product and the 1st twin are not",
    [...normalBesideHolo(results, productToCard, new Map([[7, "pokeBallPattern"]]))].sort(), ["ex8-8", "ex9-98"]);
  check("a stamped product never makes a suspect",
    [...normalBesideHolo(results, productToCard, new Map([[7, "pokeBallPattern"]]), new Set([88660]))], ["ex8-8"]);
}

console.log("storedNormalBesideHolo: a stale normal line beside the holo, one product only");
{
  // ex7-99 Rocket's Mewtwo ex: product dropped its Normal printing, "normal" $1,150 left from 10-17. mep-002: two products.
  const keys = ["ex7-99|normal", "ex7-99|holofoil", "mep-002|normal", "mep-002|holofoil", "ex9-60|normal", "ex9-60|reverseHolofoil", "base1-19-1st|normal", "base1-19-1st|holofoil", "np-99|normal", "np-99|holofoil"];
  check("Mewtwo ex and the no-product promo count; MEP (2 products), a normal+reverse common and the 1st twin do not",
    [...storedNormalBesideHolo(keys, new Map([["ex7-99", 1], ["mep-002", 2], ["ex9-60", 1], ["base1-19-1st", 1]]))].sort(), ["ex7-99", "np-99"]);
}

console.log("tcgdexHoloOnly: TCGdex's variants flags");
{
  check("normal false, holo true = holo only", tcgdexHoloOnly({ firstEdition: false, holo: true, normal: false, reverse: false, wPromo: false }), true);
  check("POP Series (normal and holo) = not", tcgdexHoloOnly({ holo: true, normal: true, reverse: false }), false);
  check("no holo either = not", tcgdexHoloOnly({ holo: false, normal: false, reverse: true }), false);
  check("TCGdex didn't say = null", [tcgdexHoloOnly(undefined), tcgdexHoloOnly({ holo: true }), tcgdexHoloOnly("x")], [null, null, null]);
}

console.log("dropPhantomNormals: the normal line goes only beside a priced holo line");
{
  const u = (cardId, variant, usd) => ({ cardId, game: "pokemon", variant, source: "tcgplayer", currency: "USD", startDay: "2026-10-25", prices: encodePrices([usd]), updatedDay: "2026-10-25" });
  const upserts = [u("ex9-98", "normal", 350), u("ex9-98", "holofoil", 299.99), u("ex8-8", "normal", 130.49), u("ex9-94", "normal", 0.49), u("pop1-3", "normal", 325.3)];
  const existing = new Map([
    ["ex9-98|normal", { prices: encodePrices([261, 350]) }], ["ex9-98|holofoil", { prices: encodePrices([243.6]) }],
    ["ex8-8|normal", { prices: encodePrices([130.49]) }], ["ex8-8|holofoil", { prices: encodePrices([274.6, null]) }],
    ["ex9-94|normal", { prices: encodePrices([0.49]) }], ["ex9-94|holofoil", { prices: encodePrices([null, null]) }],
    ["pop1-3|normal", { prices: encodePrices([325.3]) }], ["pop1-3|holofoil", { prices: encodePrices([213.95]) }],
  ]);
  const { keep, deletes } = dropPhantomNormals(upserts, new Set(["ex9-98", "ex8-8", "ex9-94"]), existing);
  check("today's lines kept: Regice holo, the holo-less Dusclops ex normal, the POP normal",
    keep.map((x) => `${x.cardId}|${x.variant}`), ["ex9-98|holofoil", "ex9-94|normal", "pop1-3|normal"]);
  check("stored normal lines deleted: Regice (holo today), Gyarados (stored holo); never Dusclops ex (its holo line has no price)",
    deletes, ["ex9-98", "ex8-8"]);
  check("no phantom cards = nothing touched", dropPhantomNormals(upserts, new Set(), existing), { keep: upserts, deletes: [] });
}

console.log("withoutPhantomNormalRow: the live upstream rows of a phantom card");
{
  const p = (source, variant, market, currency = "USD") => ({ source, variant, label: variant, currency, market, low: null, high: null });
  check("normal dropped beside a priced holofoil row; Cardmarket untouched",
    withoutPhantomNormalRow([p("tcgplayer", "normal", 350), p("tcgplayer", "holofoil", 299.99), p("cardmarket", "average", 180, "EUR")]).map((x) => x.variant),
    ["holofoil", "average"]);
  check("no priced holofoil row = the normal stays (never priceless)",
    withoutPhantomNormalRow([p("tcgplayer", "normal", 350), p("tcgplayer", "holofoil", null)]).map((x) => x.variant), ["normal", "holofoil"]);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall phantom normal checks passed");
