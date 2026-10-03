// The homepage wall recipe (lib/wallMix.ts): 4 Pokémon, 2 Magic, 2 other games, then P P M O; shortfalls go to Pokémon.
import assert from "node:assert/strict";
import { composeWall, WALL_RECIPE, WALL_SIZE } from "../src/lib/wallMix.ts";

const list = (game, n) => Array.from({ length: n }, (_, i) => ({ id: `${game}-${i + 1}`, game }));
const gamesOf = (cards) => cards.map((c) => c.game);

assert.equal(WALL_SIZE, 8);
assert.deepEqual(WALL_RECIPE, ["pokemon", "pokemon", "pokemon", "pokemon", "mtg", "mtg", "other", "other"]);

// Every game present: the wall is 4 P, 2 M, 2 others (two different games), then the ticker ratio.
let out = composeWall({ pokemon: list("pokemon", 10), mtg: list("mtg", 10), lorcana: list("lorcana", 5), onepiece: list("onepiece", 5), yugioh: list("yugioh", 5) }, 24, 0);
assert.equal(out.length, 24);
assert.deepEqual(gamesOf(out.slice(0, 6)), ["pokemon", "pokemon", "pokemon", "pokemon", "mtg", "mtg"]);
assert.deepEqual(gamesOf(out.slice(6, 8)), ["lorcana", "onepiece"]);
assert.deepEqual(gamesOf(out.slice(8, 12)), ["pokemon", "pokemon", "mtg", "yugioh"]);
assert.equal(new Set(out.map((c) => c.id)).size, 24, "no card twice");

// The seed turns the other-game rotation: another day starts on another game.
out = composeWall({ pokemon: list("pokemon", 10), mtg: list("mtg", 10), lorcana: list("lorcana", 5), onepiece: list("onepiece", 5), yugioh: list("yugioh", 5) }, 8, 1);
assert.deepEqual(gamesOf(out.slice(6, 8)), ["onepiece", "yugioh"]);

// No other-game history yet (prod until ~10-04): Pokémon takes the two slots, the wall is still eight.
out = composeWall({ pokemon: list("pokemon", 10), mtg: list("mtg", 10) }, 8, 0);
assert.deepEqual(gamesOf(out), ["pokemon", "pokemon", "pokemon", "pokemon", "mtg", "mtg", "pokemon", "pokemon"]);

// Only one other game qualifies: it fills both slots.
out = composeWall({ pokemon: list("pokemon", 10), mtg: list("mtg", 10), yugioh: list("yugioh", 5) }, 8, 0);
assert.deepEqual(gamesOf(out.slice(6)), ["yugioh", "yugioh"]);

// Magic short: Pokémon covers; Magic off (not public): no Magic at all.
out = composeWall({ pokemon: list("pokemon", 10), mtg: list("mtg", 1), lorcana: list("lorcana", 5) }, 8, 0);
assert.deepEqual(gamesOf(out), ["pokemon", "pokemon", "pokemon", "pokemon", "mtg", "pokemon", "lorcana", "lorcana"]);
out = composeWall({ pokemon: list("pokemon", 10) }, 8, 0);
assert.deepEqual(gamesOf(out), Array(8).fill("pokemon"));

// Pokémon short: the wall borrows from Magic, then the others, and ends when every pool is empty.
out = composeWall({ pokemon: list("pokemon", 2), mtg: list("mtg", 3), onepiece: list("onepiece", 1) }, 24, 0);
assert.deepEqual(gamesOf(out), ["pokemon", "pokemon", "mtg", "mtg", "mtg", "onepiece"]);

console.log("test-wall-mix: ok");
