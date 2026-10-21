// B1 10-20: the scan log (scan_usage.read) must carry the Pokémon pattern read
// (foilPattern / patternBall) so a Master Ball miss (Eevee 074) can be told
// apart: "vision read none" vs "vision read master, line not priced". Pure
// helper, no db, no API. Run: npm run test:scanlogread
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { scanLogRead } = await import(new URL("../src/lib/server/scanLogRead.ts", import.meta.url).href);

const base = {
  name: "Eevee",
  englishName: null,
  setName: "Prismatic Evolutions",
  cardNumber: "074",
  setTotal: 131,
  setCode: "PRE",
  artStyle: "standard",
  language: "en",
  condition: null,
  conditionNotes: null,
  confidence: 0.92,
  kind: "card",
};
const timing = { pre: 120, ms: 3400 };

// Pokémon: the pattern read is stored, ball included.
let read = scanLogRead({ ...base, foilPattern: "ball", patternBall: "master" }, "pokemon", timing);
assert.equal(read.pattern, "ball");
assert.equal(read.ball, "master");
assert.equal(read.name, "Eevee");
assert.equal(read.number, "074");
assert.equal(read.code, "PRE");
assert.equal(read.pre, 120);
assert.equal(read.ms, 3400);

// Pokémon, no symbol read: the fields are there as null (a stored "none" is a finding, a missing key is not).
read = scanLogRead({ ...base, foilPattern: null, patternBall: null }, "pokemon", timing);
assert.ok("pattern" in read && read.pattern === null, "pattern null stored");
assert.ok("ball" in read && read.ball === null, "ball null stored");

// A read made before the field existed (undefined) still stores null, never undefined (JSON would drop it).
read = scanLogRead({ ...base }, "pokemon", timing);
assert.equal(read.pattern, null);
assert.equal(read.ball, null);
assert.ok(JSON.stringify(read).includes('"pattern":null'), "survives JSON");

// The focused look's verdict rides along only when one ran.
read = scanLogRead({ ...base, foilPattern: "ball", patternBall: "master", patternLook: "found" }, "pokemon", timing);
assert.equal(read.look, "found");
read = scanLogRead({ ...base }, "pokemon", timing);
assert.ok(!("look" in read), "no look key without a look");

// Other games: no pattern keys at all (the log stays compact; the 2000-char slice matters).
for (const game of ["mtg", "lorcana", "onepiece", "yugioh"]) {
  read = scanLogRead({ ...base, foilPattern: "ball", patternBall: "master" }, game, timing);
  assert.ok(!("pattern" in read), `${game}: no pattern key`);
  assert.ok(!("ball" in read), `${game}: no ball key`);
}

// The give-back fields and the optional ones are unchanged.
read = scanLogRead({ ...base, slab: true, detectedGame: "mtg", switchedFrom: "pokemon", secondLook: "bottom" }, "pokemon", timing);
assert.equal(read.slab, true);
assert.equal(read.seen, "mtg");
assert.equal(read.from, "pokemon");
assert.equal(read.second, "bottom");
read = scanLogRead({ ...base }, "pokemon", timing);
assert.ok(!("slab" in read) && !("seen" in read) && !("from" in read) && !("second" in read), "optional keys absent");

// 10-21: the free /scan read logs through it too (trial rows had name/number/conf only, no pattern or ball).
for (const route of ["app/api/vision/scan/route.ts", "app/api/vision/trial/route.ts"]) {
  const src = readFileSync(new URL(`../src/${route}`, import.meta.url), "utf8");
  assert.ok(/recordScanUsage\([^;]*scanLogRead\(card,/.test(src), `${route} logs the scanLogRead shape`);
}

console.log("scan log read: ok");
