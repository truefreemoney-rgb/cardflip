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

// The List: Scryfall "KLD-2" is TCGplayer's "2" (and "006/274" is "6").
assert.deepEqual(
  matchMtgProducts([{ id: "l", name: "Aerial Responder", setCode: "plst", setName: "The List", number: "KLD-2", finishes: "nonfoil" }],
    [{ name: "Aerial Responder", number: "002/264", prices: { Normal: 0.4 } }]),
  [{ id: "l", usd: 0.4, foil: null }],
);

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

// 10-13 Art Series gaps: "Token"/"2"/"Anime" before "Art Card", doubled and two-faced names, "1c" = #1, name-only on a number miss.
const art = (id, name, number, setName = "Marvel Super Heroes Art Series") => ({ id, name, setCode: "amsh", setName, number, finishes: "nonfoil" });
const p = (name, number, usd) => ({ name, number, prices: { Normal: usd } });
const got = (rows, products) => Object.fromEntries(matchMtgProducts(rows, products).map((f) => [f.id, f.usd]));
assert.deepEqual(
  got(
    [art("t", "Dinosaur", "67"), art("q", "Valley Questcaller", "37"), art("m", "Mirror Room // Fractured Realm // Mirror Room // Fractured Realm", "36"), art("h", "Hobgoblin Bandit Lord // Hobgoblin", "30")],
    [p("Dinosaur Token Art Card", "67", 0.17), p("Valley Questcaller 2 Art Card", "37", 0.22), p("Valley Questcaller Art Card", "4", 0.5), p("Mirror Room // Fractured Realm Art Card", "36", 0.17), p("Hobgoblin Bandit Lord Art Card", "30", 0.23)],
  ),
  { t: 0.17, q: 0.22, m: 0.17, h: 0.23 },
);
assert.deepEqual(
  got(
    [art("i", "Iron Man, Futurist Paragon", "1b"), art("t1", "Thanos, the Mad Titan", "1c"), art("t2", "Thanos, the Mad Titan", "2c"), art("k", "Kraul Whipcracker", "47"), art("a", "Aurelia, the Law Above", "46")],
    [p("Iron Man, Futurist Paragon Art Card", "1", 0.41), p("Thanos, the Mad Titan Art Card (1/9)", "1", 0.3), p("Thanos, the Mad Titan Art Card (2/9)", "2", 0.31), p("Kraul Whipcracker Art Card", "42", 0.14), p("Aurelia, the Law Above Art Card (41/49)", "41", 1), p("Aurelia, the Law Above Art Card (36/49)", "36", 2)],
  ),
  { i: 0.41, t1: 0.3, t2: 0.31, k: 0.14 },
  "two products of one name (Aurelia) stay blank",
);
// Outside Art Series a number miss never falls back to the name (it could be another printing).
assert.deepEqual(got([{ ...art("s", "Ajani Goldmane // Ajani Goldmane", "745"), setCode: "sld", setName: "Secret Lair Drop" }], [p("Ajani Goldmane", "999", 1657)]), {});

console.log("mtg tcgplayer fill: all assertions passed");
process.exit(0);
