/**
 * Magic printings Scryfall leaves unpriced → TCGplayer's price.
 * Run: npm run test:mtgfill
 *
 * Pins (10-05, Chris: "use every resource available to get the cards
 * priced"): Scryfall "Strixhaven Art Series" / "Crimson Vow Art Series" find
 * TCGplayer "Art Series: Strixhaven" / "Art Series: Innistrad: Crimson Vow"
 * but "Strixhaven" never finds "Secrets of Strixhaven"; "12s" is the
 * Gold-Stamped Signature product; a name + number seen twice is no match; a
 * foil-only printing takes the Foil price; a price over 15× every other
 * printing of the card (Alpha Veteran Bodyguard $6,495 vs $112) is dropped.
 */
import assert from "node:assert/strict";

const { matchGroup, matchMtgProducts, guardFills } = await import("../src/lib/server/mtgTcgplayerFill.ts");

const groups = [
  { groupId: 1, name: "Art Series: Strixhaven", abbreviation: "ASSTX" },
  { groupId: 2, name: "Art Series: Secrets of Strixhaven", abbreviation: "ASSOS" },
  { groupId: 3, name: "Art Series: Innistrad: Crimson Vow", abbreviation: "ASVOW" },
  { groupId: 4, name: "Alpha Edition", abbreviation: "LEA" },
  { groupId: 5, name: "Strixhaven: School of Mages", abbreviation: "STX" },
];
assert.equal(matchGroup("astx", "Strixhaven Art Series", groups)?.groupId, 1);
assert.equal(matchGroup("asos", "Secrets of Strixhaven Art Series", groups)?.groupId, 2);
assert.equal(matchGroup("avow", "Crimson Vow Art Series", groups)?.groupId, 3);
assert.equal(matchGroup("lea", "Limited Edition Alpha", groups)?.groupId, 4);
assert.equal(matchGroup("asnc", "New Capenna Art Series", [...groups, { groupId: 6, name: "Art Series: Streets of New Capenna", abbreviation: "ASSNC" }])?.groupId, 6);
assert.equal(matchGroup("zzz", "Nothing Like It", groups), null);

const row = (id, name, number, finishes = "nonfoil") => ({ id, name, setCode: "astx", setName: "Strixhaven Art Series", number, finishes });
const products = [
  { name: "Clever Lumimancer Art Card", number: "2", prices: { Normal: 0.25 } },
  { name: "Clever Lumimancer Art Card (Gold-Stamped Signature)", number: "2", prices: { Normal: 0.5 } },
  { name: "Twin Art Card", number: "9", prices: { Normal: 1 } },
  { name: "Twin Art Card (Showcase)", number: "9", prices: { Normal: 2 } },
  { name: "Shiny Thing", number: "10/81", prices: { Foil: 3 } },
];
const fills = matchMtgProducts(
  [row("a", "Clever Lumimancer", "2"), row("b", "Clever Lumimancer", "2s"), row("c", "Twin", "9"), row("d", "Shiny Thing", "10", "foil")],
  products,
);
assert.deepEqual(fills, [
  { id: "a", usd: 0.25, foil: null },
  { id: "b", usd: 0.5, foil: null },
  { id: "d", usd: null, foil: 3 },
]);

// No numbers in the group: a name unique on both sides still matches.
assert.deepEqual(
  matchMtgProducts([row("e", "Black Lotus", "232"), row("f", "Island", "1"), row("g", "Island", "2")],
    [{ name: "Black Lotus", number: "", prices: { Normal: 20000 } }, { name: "Island", number: "", prices: { Normal: 5 } }]),
  [{ id: "e", usd: 20000, foil: null }],
);

const gr = [{ ...row("x", "Veteran Bodyguard", "41"), oracleId: "o1" }, { ...row("y", "Balance", "3"), oracleId: "o2" }];
assert.deepEqual(
  guardFills([{ id: "x", usd: 6495, foil: null }, { id: "y", usd: 900, foil: null }], gr, new Map([["o1", 112], ["o2", 300]])),
  [{ id: "y", usd: 900, foil: null }],
);

console.log("mtg tcgplayer fill: all assertions passed");
process.exit(0);
