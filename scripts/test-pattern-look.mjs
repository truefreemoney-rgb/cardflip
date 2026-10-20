// B1 10-20: the focused pattern look (vision.ts) runs only when it can pay off, and folds back safely.
// Pure helpers, no API. Run: npm run test:patternlook
import assert from "node:assert/strict";

const { needsPatternLook, mergePatternLook, PATTERN_SET_CODES } = await import(new URL("../src/lib/server/vision.ts", import.meta.url).href);

const base = { name: "Eevee", englishName: null, setName: null, cardNumber: "074", setTotal: 131, setCode: "PRE", artStyle: "standard", language: "en", condition: null, conditionNotes: null, confidence: 0.9, kind: "card" };

// Runs: foil seen, no symbol, on a pattern set.
assert.equal(needsPatternLook({ ...base, foilPattern: "reverse", patternBall: null }, "pokemon"), true);
assert.equal(needsPatternLook({ ...base, foilPattern: null, patternBall: null }, "pokemon"), true, "null read = not placed");
assert.equal(needsPatternLook({ ...base, setCode: "blk", foilPattern: "reverse" }, "pokemon"), true, "code case-insensitive");
// Runs: a ball was seen but which one was not.
assert.equal(needsPatternLook({ ...base, foilPattern: "ball", patternBall: null }, "pokemon"), true);
// Runs: every Prismatic ball read gets the close look (the M is easy to miss on the whole card).
assert.equal(needsPatternLook({ ...base, foilPattern: "ball", patternBall: "poke" }, "pokemon"), true);
// Does not run: symbol already placed on a rows set, plain card, other set, other game, slab, non-card.
assert.equal(needsPatternLook({ ...base, setCode: "BLK", foilPattern: "ball", patternBall: "poke" }, "pokemon"), false);
assert.equal(needsPatternLook({ ...base, setCode: "ASC", foilPattern: "ball", patternBall: "master" }, "pokemon"), false);
assert.equal(needsPatternLook({ ...base, foilPattern: "none" }, "pokemon"), false, "no foil = nothing to look for");
assert.equal(needsPatternLook({ ...base, setCode: "SVI", foilPattern: "reverse" }, "pokemon"), false);
assert.equal(needsPatternLook({ ...base, setCode: null, foilPattern: "reverse" }, "pokemon"), false);
assert.equal(needsPatternLook({ ...base, foilPattern: "reverse" }, "mtg"), false);
assert.equal(needsPatternLook({ ...base, foilPattern: "reverse", slab: true }, "pokemon"), false);
assert.equal(needsPatternLook({ ...base, foilPattern: "reverse", kind: "token" }, "pokemon"), false);
for (const code of ["PRE", "ASC", "BLK", "WHT"]) assert.ok(PATTERN_SET_CODES.has(code), code);

// Merge: a symbol the look saw wins and is normalized.
let out = mergePatternLook({ ...base, foilPattern: "reverse", patternBall: null }, { foilPattern: "ball", patternBall: "master" });
assert.equal(out.foilPattern, "ball"); assert.equal(out.patternBall, "master"); assert.equal(out.patternLook, "found");
out = mergePatternLook({ ...base, foilPattern: "ball", patternBall: null }, { foilPattern: "ball", patternBall: "poke" });
assert.equal(out.patternBall, "poke"); assert.equal(out.patternLook, "found");
out = mergePatternLook({ ...base, foilPattern: "reverse", patternBall: null }, { foilPattern: "energySymbol", patternBall: "unknown" });
assert.equal(out.foilPattern, "energySymbol"); assert.equal(out.patternBall, null); assert.equal(out.patternLook, "found");
// Merge: the look saw nothing either; the first read stands and the verdict is recorded.
out = mergePatternLook({ ...base, foilPattern: "reverse", patternBall: null }, { foilPattern: "reverse", patternBall: "unknown" });
assert.equal(out.foilPattern, "reverse"); assert.equal(out.patternLook, "reverse");
out = mergePatternLook({ ...base, foilPattern: "reverse", patternBall: null }, { foilPattern: "unknown", patternBall: "unknown" });
assert.equal(out.foilPattern, "reverse"); assert.equal(out.patternLook, "unknown");
// A junk answer never breaks the read.
out = mergePatternLook({ ...base, foilPattern: "reverse", patternBall: null }, { foilPattern: "banana", patternBall: "x" });
assert.equal(out.foilPattern, "reverse"); assert.equal(out.patternLook, "banana");

console.log("pattern look: ok");
