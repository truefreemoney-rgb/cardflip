/**
 * Every typed-search box (Search Cards, scanner add-by-name, watchlist add,
 * card editor re-search) goes through searchTyped. Run: npm run test:searchtyped
 *
 * Pins (09-30, Chris: "i tried luffy for one piece and pokemon cards came
 * up", "search elsa in lorcana and no results"): each box sent ONLY Magic
 * with its game, so Lorcana / One Piece / Yu-Gi-Oh searched the Pokémon
 * catalogue. Invariant: the request carries the switch's game, and a code
 * like OP01-001 / LOB-EN005 goes out as the number, not part of the name.
 */
import assert from "node:assert/strict";

const seen = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url), "http://x");
  seen.push(u.searchParams);
  return new Response(JSON.stringify({ cards: [{ id: "a", name: "X", number: u.searchParams.get("number") ?? "1" }] }), { status: 200 });
};

const { searchTyped } = await import("../src/lib/cards.ts");

const cases = [
  ["pokemon", "Charizard 4/102", { game: null, name: "Charizard", number: "4" }],
  ["mtg", "Lightning Bolt LTR 187", { game: "mtg", name: "Lightning Bolt", number: "187" }],
  ["lorcana", "Elsa", { game: "lorcana", name: "Elsa", number: null }],
  ["lorcana", "Elsa 42/204", { game: "lorcana", name: "Elsa", number: "42" }],
  ["onepiece", "Luffy", { game: "onepiece", name: "Luffy", number: null }],
  ["onepiece", "Roronoa Zoro OP01-001", { game: "onepiece", name: "Roronoa Zoro", number: "OP01-001" }],
  // 10-01: a promo's one-letter code was searched as part of the name (Chris's phone, 0 hits).
  ["onepiece", "nami p-117", { game: "onepiece", name: "nami", number: "P-117" }],
  ["onepiece", "P-117", { game: "onepiece", name: "", number: "P-117" }],
  ["yugioh", "Dark Magician", { game: "yugioh", name: "Dark Magician", number: null }],
  ["yugioh", "dark magician lob-en005", { game: "yugioh", name: "dark magician", number: "LOB-EN005" }],
  // 10-01 typed-search check (scripts/typed-search-check.mjs): numbers typed without the dash,
  // lettered Pokémon numbers, a Magic set code with no name.
  ["onepiece", "OP01041", { game: "onepiece", name: "", number: "OP01-041" }],
  ["onepiece", "nami p117", { game: "onepiece", name: "nami", number: "P-117" }],
  ["yugioh", "LOBEN005", { game: "yugioh", name: "", number: "LOB-EN005" }],
  ["yugioh", "lob005", { game: "yugioh", name: "", number: "LOB-005" }],
  ["yugioh", "FLODEN055", { game: "yugioh", name: "", number: "FLOD-EN055" }],
  ["yugioh", "Red-Eyes Wyvern ANPR-ENSE2", { game: "yugioh", name: "Red-Eyes Wyvern", number: "ANPR-ENSE2" }],
  ["pokemon", "Nidoking H18", { game: null, name: "Nidoking", number: "H18" }],
  ["pokemon", "Falinks V SV115", { game: null, name: "Falinks V", number: "SV115" }],
  ["pokemon", "Jolteon-EX 28a", { game: null, name: "Jolteon-EX", number: "28a" }],
  ["mtg", "BLB 280", { game: "mtg", name: "", number: "280", setCode: "blb" }],
  ["mtg", "Cavern of Souls PUMA U32", { game: "mtg", name: "Cavern of Souls", number: "u32", setCode: "puma" }],
];
for (const [game, query, want] of cases) {
  seen.length = 0;
  const found = await searchTyped(query, game, "en");
  assert.ok(found && found.length > 0, `${game} "${query}" returned nothing`);
  const p = seen[0];
  assert.equal(p.get("game"), want.game, `${game} "${query}" game param`);
  assert.equal(p.get("name"), want.name, `${game} "${query}" name`);
  assert.equal(p.get("number"), want.number, `${game} "${query}" number`);
  if (want.setCode) assert.equal(p.get("setCode"), want.setCode, `${game} "${query}" set code`);
  // "luffy" must reach Monkey.D.Luffy: the server's anywhere-in-the-name match.
  if (game !== "pokemon") assert.equal(p.get("typed"), "1", `${game} "${query}" typed flag`);
}
assert.equal(await searchTyped("", "lorcana", "en"), null);
console.log(`searchTyped: ${cases.length} cases pass — every game searches its own catalogue`);
