/**
 * Exercises the printed-fraction parser.
 * Run: npm run test:cardnumber
 *
 * What motivated this suite: the denominator was being parsed and thrown away.
 * A collector number is only unique inside its own set, so "Charizard #4"
 * matched both the 1999 Base Set card (~$818) and its 2000 Base Set 2 reprint
 * (~$466) and the tie was broken by release date — a guess. The set total is
 * printed right there and settles it: 4/102 against 4/130.
 *
 * The collector-number cases below moved here from test-ocr-text.mjs when the
 * parsing moved to src/lib/cardNumber.ts; they now assert on the whole
 * fraction rather than the numerator alone.
 */
import {
  agreesWithSetCode,
  agreesWithSetTotal,
  extractCardNumber,
  extractPrintedNumber,
  filterByPrintedNumber,
  formatCardNumber,
  isSecretRareNumber,
  normalizeNumber,
  parseCardQuery,
  parsePrintedNumber,
} from "../src/lib/cardNumber.ts";

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

console.log("\nThe regression: both halves of the fraction survive");
{
  const printed = parsePrintedNumber("4/102");
  check("keeps the collector number", printed.number, "4");
  check("keeps the set total", printed.setTotal, 102);
}
check(
  "the two Charizard #4s are distinguishable",
  [parsePrintedNumber("4/102").setTotal, parsePrintedNumber("4/130").setTotal],
  [102, 130],
);

console.log("\nParsing what's printed:");
check("slash form", parsePrintedNumber("074/073").number, "74");
check("spaced slash", parsePrintedNumber("199 / 165").number, "199");
check("strips leading zeros", parsePrintedNumber("006/165").number, "6");
check("keeps the total unpadded", parsePrintedNumber("006/165").setTotal, 165);
check("no number at all", parsePrintedNumber("Illus. Mitsuhiro Arita"), null);
check("empty input", parsePrintedNumber("   "), null);

console.log("\nSecret rares — numerator above the set total:");
check("201/198 is a secret rare", parsePrintedNumber("201/198").isSecretRare, true);
check("25/102 is not", parsePrintedNumber("25/102").isSecretRare, false);
check("equal is not above", isSecretRareNumber("102", 102), false);
check("unknown total can't decide", isSecretRareNumber("201", null), false);
check("promo ids aren't numeric", isSecretRareNumber("SWSH066", 100), false);

console.log("\nSet codes, without swallowing the language code:");
check("code before the fraction", parsePrintedNumber("SVI 025/198").setCode, "SVI");
check("code after the fraction", parsePrintedNumber("025/198 PAF").setCode, "PAF");
check("EN is a language, not a set", parsePrintedNumber("025/198 EN").setCode, null);
check("no code printed", parsePrintedNumber("4/102").setCode, null);

console.log("\nNumbers with no denominator (promos, subsets):");
check("promo id", parsePrintedNumber("SWSH066").number, "SWSH066");
check("promo id has no total", parsePrintedNumber("SWSH066").setTotal, null);
check("bare number", parsePrintedNumber("4").number, "4");
check("trainer gallery id", parsePrintedNumber("TG03").number, "TG03");

console.log("\nOCR: the slash is the most-misread glyph on the card");
// Verbatim from a real Base Set Charizard scan — "4/102" read as "47102".
{
  const line =
    "Iflus. Mitsuhiro Arita © 1995,96,98.99 Nintendo, Creatures, GAMEFREAK. © 1999Wiards. 47102 %";
  check("real scan: slash read as 7", extractPrintedNumber([line]).number, "4");
  check(
    "and the recovered total comes with it",
    extractPrintedNumber([line]).setTotal,
    102,
  );
}
check("slash as 1", extractPrintedNumber(["25 1 102"]).number, "25");
check("slash as l", extractPrintedNumber(["Illus. Someone 6l165"]).number, "6");
check(
  "a real slash still wins over a decoy",
  extractPrintedNumber(["1999 12/102"]).number,
  "12",
);
check(
  "copyright years alone are not a card number",
  extractPrintedNumber(["© 1995,96,98.99 Nintendo, Creatures, GAMEFREAK"]),
  null,
);
check("plain digit runs are not card numbers", extractPrintedNumber(["1234 5678"]), null);
check("the legacy numerator-only helper still works", extractCardNumber(["074/073"]), "74");

console.log("\nWhat a seller types into the search box:");
check("name and fraction", parseCardQuery("Charizard 4/102"), {
  name: "Charizard",
  printed: { number: "4", setTotal: 102, setCode: null, isSecretRare: false },
});
check("fraction alone", parseCardQuery("4/102").name, "");
check("fraction alone keeps the total", parseCardQuery("4/102").printed.setTotal, 102);
check("name and bare number", parseCardQuery("Charizard 4"), {
  name: "Charizard",
  printed: { number: "4", setTotal: null, setCode: null, isSecretRare: false },
});
check("set code is not left in the name", parseCardQuery("Pikachu SVI 025/198").name, "Pikachu");
check("plain name is untouched", parseCardQuery("Charizard"), {
  name: "Charizard",
  printed: null,
});
// "151" is a set name; a seller searching it does not mean card #151.
check("a bare number alone stays a name", parseCardQuery("151"), {
  name: "151",
  printed: null,
});
check("two-word names survive", parseCardQuery("Mr Mime").name, "Mr Mime");

console.log("\nAgreement is three-valued, so 'unknown' never reads as 'wrong':");
check("totals agree", agreesWithSetTotal(102, 102), "match");
check("totals disagree", agreesWithSetTotal(102, 130), "mismatch");
check("nothing scanned", agreesWithSetTotal(null, 102), "unknown");
// A mirror synced before set totals existed returns null for every card.
check("mirror has no total", agreesWithSetTotal(102, null), "unknown");
check("codes agree, case-insensitively", agreesWithSetCode("svi", "SVI"), "match");
check("codes disagree", agreesWithSetCode("SVI", "PAF"), "mismatch");
check("no code either side", agreesWithSetCode(null, "SVI"), "unknown");

console.log("\nA typed number filters search results (typed ≠ scanned):");
{
  // The two Charizard #4s plus a modern printing — the ambiguity this exists for.
  const base1 = { number: "4", setTotal: 102 };
  const base2 = { number: "4", setTotal: 130 };
  const modern = { number: "223", setTotal: 197 };
  const noTotal = { number: "4", setTotal: null };
  const cards = [modern, base2, base1, noTotal];

  check(
    "full fraction keeps only the exact card (plus unknown-total twins)",
    filterByPrintedNumber(cards, parseCardQuery("Charizard 4/102").printed),
    [base1, noTotal],
  );
  check(
    "bare number keeps every set's #4",
    filterByPrintedNumber(cards, parseCardQuery("Charizard 4").printed),
    [base2, base1, noTotal],
  );
  check(
    "no number leaves results alone",
    filterByPrintedNumber(cards, parseCardQuery("Charizard").printed),
    cards,
  );
  check(
    "padding doesn't defeat the match",
    filterByPrintedNumber([{ number: "004", setTotal: 102 }], parseCardQuery("Charizard 4/102").printed),
    [{ number: "004", setTotal: 102 }],
  );
  check(
    "a wrong number matches nothing rather than everything",
    filterByPrintedNumber(cards, parseCardQuery("Charizard 999/999").printed),
    [],
  );
}

console.log("\nOdds and ends:");
check("normalizes padding", normalizeNumber("004"), "4");
check("formats the fraction", formatCardNumber("4", 102), "4/102");
check("formats a number with no total", formatCardNumber("SWSH066", null), "SWSH066");

console.log(
  failures === 0
    ? "\nAll card-number checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
