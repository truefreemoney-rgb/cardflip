/**
 * Exercises OCR text parsing against realistic Tesseract output.
 * Run: npm run test:ocr
 *
 * The regression that motivated this: scanning a pristine, straight-on
 * Charizard produced the line "b Hp Charizard", and the only query the app
 * ever sent was that whole string — which matches nothing. Noise words were
 * used to reject an all-noise line but never stripped from a mixed one.
 */
import {
  JP_NOISE,
  cleanNameLine,
  extractCjkNameCandidates,
  extractNameCandidates,
  stripNoiseWords,
} from "../src/lib/ocrText.ts";

// Collector numbers moved to src/lib/cardNumber.ts, along with their tests —
// see npm run test:cardnumber.

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

function includes(label, list, needle) {
  const ok = list.includes(needle);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — ${JSON.stringify(list)} lacks ${JSON.stringify(needle)}`}`,
  );
}

console.log("\nThe regression: a real scan of a pristine Charizard");
{
  const candidates = extractNameCandidates(["b Hp Charizard"]);
  includes("recovers the bare name", candidates, "Charizard");
  check("tries the clean name first", candidates[0], "Charizard");
}

console.log("\nStrips HP however it survives the read:");
check("bare HP", cleanNameLine("b Hp Charizard"), "b Charizard");
check("HP with value", cleanNameLine("Charizard HP 120"), "Charizard");
check("value then HP", cleanNameLine("Charizard 120 HP"), "Charizard");

console.log("\nStrips card furniture and single-character debris:");
check("stage marker", stripNoiseWords("Stage 2 Charizard"), "Charizard");
check("leading debris", stripNoiseWords("b Hp Charizard"), "Charizard");
check("evolution line", stripNoiseWords("Evolves from Charmeleon"), "Charmeleon");
check("keeps two-word names", stripNoiseWords("Mr Mime"), "Mr Mime");

console.log("\nRealistic noisy reads still surface the right name:");
for (const [line, expected] of [
  ["| Blastoise Hp 100", "Blastoise"],
  ["Stage 1 Wartortle 80 HP", "Wartortle"],
  ["~ Pikachu ~", "Pikachu"],
  ["BASIC Snorlax HP160", "Snorlax"],
  ["e Gengar VMAX 320 HP", "Gengar"],
]) {
  includes(`"${line}"`, extractNameCandidates([line]), expected);
}

console.log("\nDoesn't invent names out of pure furniture:");
for (const line of ["Stage 2", "Weakness Resistance Retreat", "HP 120"]) {
  const candidates = extractNameCandidates([line]);
  const ok = candidates.length === 0 || !candidates.some((c) => c.length > 6);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  "${line}" yields no name${ok ? "" : ` — got ${JSON.stringify(candidates)}`}`,
  );
}

console.log("\nMulti-word names survive intact:");
includes("Mr. Mime", extractNameCandidates(["Mr. Mime HP 70"]), "Mr. Mime");
includes(
  "Team Rocket's Meowth keeps its full form",
  extractNameCandidates(["Team Rocket's Meowth 60 HP"]),
  "Team Rocket's Meowth",
);

console.log("\nJapanese still works (unchanged path):");
check(
  "keeps kana, drops Latin debris",
  extractCjkNameCandidates(["リザードン HP 170"], JP_NOISE),
  ["リザードン"],
);
check(
  "rejects pure furniture",
  extractCjkNameCandidates(["ポケモン"], JP_NOISE),
  [],
);

console.log(
  failures === 0
    ? "\nAll OCR text checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
