/**
 * The fraction printed at the bottom of a card — "25/102" — read as two
 * separate facts instead of one.
 *
 * The left half is the collector number: which card this is *within* its set.
 * The right half is the set's official card count, and it is the part the app
 * used to throw away. That was expensive. A collector number is only unique
 * inside its own set, so name + number alone is genuinely ambiguous for 1,306
 * keys in our own mirror (2,890 cards) — "Charizard #4" is Base Set (1999,
 * ~$818) and Base Set 2 (2000, ~$466), and picking wrong is the exact failure
 * that mispriced a card by $350.
 *
 * The denominator settles it: Base Set prints 4/102, Base Set 2 prints 4/130.
 * Measured against the mirror, the set total alone fully disambiguates 94.3%
 * of those keys. So the denominator is best understood as a *set fingerprint*,
 * not a card index — it identifies the expansion, and the numerator then picks
 * the card out of it.
 *
 * Two consequences worth naming:
 *
 * - **Secret rares invert the fraction.** The set total counts the base set
 *   only, so a card numbered above it (201/198) is a secret rare — an
 *   ultra-rare or special-illustration print, and usually the expensive one in
 *   the stack. `isSecretRare` flags it.
 * - **The denominator is not a filter.** OCR misreads the slash constantly
 *   (see extractPrintedNumber in ocrText.ts), so a mismatched total must only
 *   ever demote a candidate, never remove it. Ranking, not filtering.
 *
 * Pure and dependency-free so both the browser scanner and the server lookup
 * can share it, and so scripts/test-card-number.mjs can exercise it directly.
 */

export interface PrintedNumber {
  /** Left half of the fraction — the collector number, e.g. "25". */
  number: string;
  /** Right half — the set's official card count, e.g. 102. Null if unread. */
  setTotal: number | null;
  /** The 2-4 letter expansion code printed beside it, e.g. "SVI". */
  setCode: string | null;
  /** Numerator above the set total: an ultra-rare beyond the base set. */
  isSecretRare: boolean;
}

/**
 * Two- and three-letter tokens that sit beside the collector number but are
 * not set codes. Language codes are the dangerous ones — every modern English
 * card prints "EN" right there, and reading it as an expansion would make the
 * set code actively wrong rather than merely missing.
 */
const NOT_SET_CODES = new Set([
  "EN", "JP", "JA", "FR", "DE", "IT", "ES", "PT", "KO", "ZH", "TW", "CN",
  "HP", "GX", "EX", "VE", "ILLUS", "NM", "LP",
]);

/** Normalizes "004" and "4" to the same thing for comparison. */
export function normalizeNumber(value: string): string {
  return value.replace(/^0+/, "").trim().toLowerCase();
}

/** TCGdex writes "1999-01-09", pokemontcg.io writes "1999/01/09". */
export function normalizeDate(value: string | undefined): string {
  return (value ?? "").replace(/\//g, "-").slice(0, 10);
}

/**
 * The numeric value of a collector number, or null when it isn't one.
 *
 * Plenty of real numbers aren't plain integers — "SM158", "TG03", "CC002",
 * "SWSH066", "RC5". Those come from promo sets and subsets that don't print a
 * denominator at all, so there is no secret-rare question to answer for them.
 */
export function numericValue(number: string): number | null {
  const match = number.match(/^(\d+)$/);
  return match ? Number(match[1]) : null;
}

/** A number above its set's official count is a secret rare. */
export function isSecretRareNumber(
  number: string,
  setTotal: number | null,
): boolean {
  if (setTotal === null) return false;
  const value = numericValue(number);
  return value !== null && value > setTotal;
}

function parseSetCode(text: string, fraction: string): string | null {
  // Only look beside the fraction — an all-caps word elsewhere in the line
  // (illustrator credits, "POKEMON") is not an expansion code.
  const at = text.indexOf(fraction);
  if (at < 0) return null;

  const words = (chunk: string) => chunk.split(/\s+/).filter(Boolean);
  const nearby = [
    ...words(text.slice(0, at)).slice(-2),
    ...words(text.slice(at + fraction.length)).slice(0, 2),
  ];

  for (const token of nearby) {
    const code = token.replace(/[^A-Za-z]/g, "");
    // Whole words only, and only ones already printed in caps. Slicing a
    // character window instead invents word boundaries mid-name: it read
    // "CHAR" out of "Charizard 4/102" and "KACH" out of "Pikachu SVI 025/198".
    // Requiring caps is also what keeps "Mr Mime" from donating a set code.
    if (code.length < 2 || code.length > 4) continue;
    if (code !== code.toUpperCase()) continue;
    if (NOT_SET_CODES.has(code)) continue;
    return code;
  }
  return null;
}

/**
 * Parse a printed collector number out of arbitrary text.
 *
 * Handles what a seller types into the search box ("25/102", "sv 201/198",
 * "4") as readily as a clean OCR line. Returns null only when there is no
 * number at all to work with.
 */
export function parsePrintedNumber(text: string): PrintedNumber | null {
  const input = text.trim();
  if (!input) return null;

  const fraction = input.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  if (fraction) {
    const number = String(Number(fraction[1]));
    const setTotal = Number(fraction[2]);
    return {
      number,
      setTotal,
      setCode: parseSetCode(input, fraction[0]),
      isSecretRare: isSecretRareNumber(number, setTotal),
    };
  }

  // No denominator printed — promos and subsets ("SWSH066", "TG03") genuinely
  // don't have one, and a seller typing a bare "4" is asking the same thing.
  const bare = input.match(/\b([A-Za-z]{2,5}\d{1,3}|\d{1,3})\b/);
  if (!bare) return null;

  const raw = bare[1];
  return {
    number: /^\d+$/.test(raw) ? String(Number(raw)) : raw.toUpperCase(),
    setTotal: null,
    setCode: null,
    isSecretRare: false,
  };
}

/**
 * Pull the printed number out of OCR lines — and keep *both* halves.
 *
 * The slash is the most-misread glyph on the card. A real scan of a Base Set
 * Charizard came back as "© 1999Wiards. 47102 %" — that's "4/102" with the
 * slash read as a 7, which the strict pattern misses entirely, losing the one
 * field that tells a 1999 Charizard apart from forty later reprints.
 *
 * So: strict slash first, and only if nothing matches anywhere, retry allowing
 * the glyphs "/" is commonly confused with. Requiring a 2-3 digit denominator
 * keeps the loose pass from firing on arbitrary digit runs (set totals are
 * never single digits).
 */
export function extractPrintedNumber(lines: string[]): PrintedNumber | null {
  for (const line of lines) {
    if (/(\d{1,3})\s*\/\s*(\d{1,3})/.test(line)) return parsePrintedNumber(line);
  }

  // Collector numbers sit at the end of the bottom line, so scan from the
  // back — the copyright year runs earlier in the line are the main decoys.
  // The denominator must not start with 0: "47102" is ambiguous between
  // "4/102" and "47/02", and set totals are never zero-padded, so requiring a
  // leading 1-9 there forces the reading that's actually printed on cards.
  const loose = /(\d{1,3})\s*[/17lI|\\]\s*([1-9]\d{1,2})\b/g;
  for (const line of [...lines].reverse()) {
    const matches = [...line.matchAll(loose)];
    const last = matches[matches.length - 1];
    if (!last) continue;

    // The recovered denominator has to survive this path too — a mangled slash
    // is precisely the case where a reprint is at stake, so dropping the set
    // total here would lose the tiebreak exactly when it's needed most.
    const number = String(Number(last[1]));
    const setTotal = Number(last[2]);
    return {
      number,
      setTotal,
      setCode: parseSetCode(line, last[0]),
      isSecretRare: isSecretRareNumber(number, setTotal),
    };
  }

  return null;
}

/** The collector number on its own, e.g. "74" from "074/073". */
export function extractCardNumber(lines: string[]): string | null {
  return extractPrintedNumber(lines)?.number ?? null;
}

/**
 * Split what a seller typed into a name and a printed number.
 *
 * People hold the card while they search, so they type what's on it —
 * "Charizard 4/102", "4/102", "charizard 4 102". Treating that whole string as
 * a name matches nothing, which reads as "the card isn't in the database"
 * rather than "you typed the number too". Pulling the fraction out turns the
 * most natural thing to type into the most precise query available.
 */
export function parseCardQuery(query: string): {
  name: string;
  printed: PrintedNumber | null;
} {
  const input = query.trim();
  if (!input) return { name: "", printed: null };

  const fraction = input.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  if (!fraction) {
    // A bare trailing number is a collector number ("Charizard 4"), but only
    // when something else is there to be the name — otherwise a seller
    // searching for "151" means the set, not card #151.
    const trailing = input.match(/^(.*?[A-Za-z].*?)\s+(\d{1,3})$/);
    if (trailing) {
      return {
        name: trailing[1].trim(),
        printed: {
          number: String(Number(trailing[2])),
          setTotal: null,
          setCode: null,
          isSecretRare: false,
        },
      };
    }
    return { name: input, printed: null };
  }

  const printed = parsePrintedNumber(input);

  let name = input.replace(fraction[0], " ");
  if (printed?.setCode) {
    name = name.replace(new RegExp(`\\b${printed.setCode}\\b`, "i"), " ");
  }

  return { name: name.replace(/\s+/g, " ").trim(), printed };
}

/** Render a printed number back the way the card shows it. */
export function formatPrintedNumber(printed: PrintedNumber): string {
  const fraction = printed.setTotal
    ? `${printed.number}/${printed.setTotal}`
    : printed.number;
  return printed.setCode ? `${printed.setCode} ${fraction}` : fraction;
}

/**
 * A matched card's number as the seller will see it on the card in their hand.
 *
 * Showing "4" makes the app's answer uncheckable — the card says "4/102", and
 * the whole point of the match is which of the two Charizard #4s it landed on.
 * Showing the fraction lets a wrong match be spotted without opening anything.
 */
export function formatCardNumber(
  number: string,
  setTotal?: number | null,
): string {
  return setTotal ? `${number}/${setTotal}` : number;
}

/**
 * How well a candidate card's own set agrees with the fraction that was read.
 *
 * Deliberately three-valued rather than boolean: "we never read a total" and
 * "the total contradicts this card" are different situations, and only the
 * second one should cost a candidate anything. Unknown sits between them so a
 * card from a set we haven't synced totals for still beats a contradiction.
 */
export type SetAgreement = "match" | "unknown" | "mismatch";

export function agreesWithSetTotal(
  scannedTotal: number | null,
  cardSetTotal: number | null,
): SetAgreement {
  if (scannedTotal === null || cardSetTotal === null) return "unknown";
  return scannedTotal === cardSetTotal ? "match" : "mismatch";
}

/**
 * Keep only the cards a *typed* printed number actually names.
 *
 * Scanner results must never be filtered by the fraction — OCR misreads the
 * slash, so there it only ranks (see above). A typed number is different:
 * someone who searched "Charizard 4/102" is asking for that card, not every
 * printing with it sorted first. The collector number must match exactly; the
 * set total only excludes on a real contradiction, so cards whose set count
 * the mirror doesn't know survive.
 */
export function filterByPrintedNumber<
  T extends { number: string; setTotal?: number | null },
>(cards: T[], printed: PrintedNumber | null): T[] {
  if (!printed) return cards;
  return cards.filter(
    (card) =>
      normalizeNumber(card.number) === normalizeNumber(printed.number) &&
      agreesWithSetTotal(printed.setTotal, card.setTotal ?? null) !== "mismatch",
  );
}

export function agreesWithSetCode(
  scannedCode: string | null,
  cardSetCode: string | null,
): SetAgreement {
  if (!scannedCode || !cardSetCode) return "unknown";
  return scannedCode.toUpperCase() === cardSetCode.toUpperCase()
    ? "match"
    : "mismatch";
}

/**
 * Which catalog printing is THIS ledger row? Name + number alone is
 * ambiguous (Pikachu 25 exists in a dozen sets; Charizard 4 is Base Set AND
 * Base Set 2), and "first hit wins" priced a McDonald's Pikachu as a 151
 * card (QA, 09-04). Order: the row's catalog id → name + number + set →
 * name + number → first result.
 */
export function pickPrinting<
  T extends { id: string; name: string; englishName?: string | null; number: string; setName: string },
>(
  results: T[],
  row: { catalogCardId?: string | null; cardName: string; cardNumber?: string | null; setName?: string | null },
): T | null {
  if (results.length === 0) return null;
  const byId = row.catalogCardId ? results.find((c) => c.id === row.catalogCardId) : undefined;
  if (byId) return byId;
  const wantName = row.cardName.trim().toLowerCase();
  const wantNum = normalizeNumber(row.cardNumber || "");
  const wantSet = (row.setName || "").trim().toLowerCase();
  const nameMatches = (c: T) =>
    c.name.trim().toLowerCase() === wantName || (c.englishName ?? "").trim().toLowerCase() === wantName;
  const numMatches = (c: T) => !wantNum || normalizeNumber(c.number) === wantNum;
  const nameNum = results.filter((c) => nameMatches(c) && numMatches(c));
  if (wantSet) {
    const exact = nameNum.find((c) => c.setName.trim().toLowerCase() === wantSet);
    if (exact) return exact;
    // A row saved before 1st Edition twins existed: "Base Set" vs "Base Set (1st Edition)".
    const loose = nameNum.find((c) => c.setName.trim().toLowerCase().startsWith(wantSet));
    if (loose) return loose;
  }
  return nameNum[0] ?? results[0];
}
