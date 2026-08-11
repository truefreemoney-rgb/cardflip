/**
 * Turning raw OCR text into something the card lookup can actually match.
 *
 * Kept free of tesseract.js and browser APIs so the parsing can be exercised
 * directly — see scripts/test-ocr-text.mjs. This is where the scanner's bugs
 * live: a real scan of a pristine Charizard produced the line "b Hp Charizard",
 * and because noise words were only ever used to *reject* an all-noise line
 * rather than to strip tokens, that whole string went to the API as the query
 * and matched nothing.
 */

/** Words that appear on cards but are never part of a Pokémon's name. */
export const NOISE = new Set([
  "basic",
  "stage",
  "stage1",
  "stage2",
  "evolves",
  "from",
  "pokemon",
  "pokémon",
  "trainer",
  "energy",
  "item",
  "supporter",
  "stadium",
  "tool",
  "ability",
  "ancient",
  "future",
  "weakness",
  "resistance",
  "retreat",
  "illus",
  "hp",
  "ex",
  "gx",
  "vmax",
  "vstar",
]);

/** Card furniture printed on Japanese cards. */
export const JP_NOISE = new Set([
  "たね",
  "たねポケモン",
  "1進化",
  "2進化",
  "どうぐ",
  "グッズ",
  "サポート",
  "スタジアム",
  "エネルギー",
  "ポケモン",
  "トレーナーズ",
  "ワザ",
  "にげる",
  "弱点",
  "抵抗力",
]);

/** Same idea again, for the card furniture printed on Chinese cards. */
export const ZH_NOISE = new Set([
  "基本",
  "一階進化",
  "二階進化",
  "道具",
  "訓練家",
  "支援者",
  "競技場",
  "能量",
  "寶可夢",
  "招式",
  "撤退",
  "弱點",
  "抵抗力",
]);

export function toLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Strip the decoration that surrounds a name on a real card: HP values, stage
 * markers, suffix symbols, and OCR punctuation garbage.
 */
export function cleanNameLine(line: string): string {
  return line
    .replace(/\bHP\s*\d+\b/gi, "")
    .replace(/\b\d+\s*HP\b/gi, "")
    // A bare "HP" with no number beside it — the number is often misread as a
    // letter, which left the "HP" stranded in the query.
    .replace(/\bHP\b/gi, " ")
    .replace(/[^A-Za-z0-9 '’.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drop card furniture and OCR debris, keeping the words that could be a name.
 * Stripping — not just rejecting — is what makes a noisy line usable.
 */
export function stripNoiseWords(candidate: string): string {
  return candidate
    .split(" ")
    .filter((word) => {
      const lower = word.toLowerCase();
      if (NOISE.has(lower)) return false;
      // Single stray characters are OCR debris, never part of a name.
      if (word.replace(/[^A-Za-z]/g, "").length < 2) return false;
      return true;
    })
    .join(" ")
    .trim();
}

export function isPlausibleName(candidate: string): boolean {
  if (candidate.length < 3 || candidate.length > 28) return false;
  if (!/[A-Za-z]{3}/.test(candidate)) return false;

  const words = candidate.toLowerCase().split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;

  // A line made up entirely of card furniture is not a name.
  return !words.every((word) => NOISE.has(word));
}

/**
 * Every name worth trying for one card, best guess first — the lookup walks
 * these in order and stops at the first hit.
 */
export function extractNameCandidates(lines: string[]): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const line of lines) {
    const cleaned = cleanNameLine(line);
    if (!isPlausibleName(cleaned)) continue;

    // Furniture and debris removed — usually the actual name on its own.
    const stripped = stripNoiseWords(cleaned);
    // Nothing survived, so the line was pure card furniture ("Stage 2",
    // "Weakness Resistance"). Falling back to the raw line here would send
    // furniture to the API as if it were a name.
    if (!stripped) continue;

    const variants: string[] = [];
    if (stripped.length >= 3) variants.push(stripped);

    // The longest alphabetic word. On a noisy read the Pokémon's name is
    // reliably the longest real word on the line, which rescues cases where
    // stripping alone still leaves a stray token behind.
    const longest = stripped
      .split(" ")
      .filter((w) => /^[A-Za-z'’.-]+$/.test(w))
      .sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 4) variants.push(longest);

    // "Charizard VMAX" and "Charizard" should both be tried; the API matches
    // the base name more reliably, so also queue the leading word on its own.
    const [first] = stripped.split(" ");
    if (first && first.length >= 4) variants.push(first);

    // The raw line last — if everything above missed, it's the only thing left.
    variants.push(cleaned);

    for (const variant of variants) {
      const key = variant.toLowerCase();
      if (!variant || seen.has(key)) continue;
      seen.add(key);
      candidates.push(variant);
    }
  }

  return candidates.slice(0, 6);
}

/**
 * Japanese and Chinese have no spaces between words and a completely
 * different character set, so the Latin word-count heuristics above don't
 * apply — keep hiragana, katakana and CJK ideographs (covers both scripts;
 * kana ranges are simply unused and harmless when cleaning Chinese text),
 * drop everything else (Latin OCR garbage, HP numbers).
 */
export function cleanCjkNameLine(line: string): string {
  return line.replace(/[^぀-ゟ゠-ヿ一-鿿・]/g, "").trim();
}

export function isPlausibleCjkName(candidate: string, noise: Set<string>): boolean {
  if (candidate.length < 2 || candidate.length > 15) return false;
  return !noise.has(candidate);
}

export function extractCjkNameCandidates(
  lines: string[],
  noise: Set<string>,
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const line of lines) {
    const cleaned = cleanCjkNameLine(line);
    if (!isPlausibleCjkName(cleaned, noise)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    candidates.push(cleaned);
  }

  return candidates.slice(0, 6);
}

/**
 * Collector numbers print as "074/073" — the left half is what we query on.
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
export function extractCardNumber(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
    if (match) return String(Number(match[1]));
  }

  // Collector numbers sit at the end of the bottom line, so scan from the
  // back — the copyright year runs earlier in the line are the main decoys.
  // The denominator must not start with 0: "47102" is ambiguous between
  // "4/102" and "47/02", and set totals are never zero-padded, so requiring a
  // leading 1-9 there forces the reading that's actually printed on cards.
  const loose = /(\d{1,3})\s*[\/17lI|\\]\s*([1-9]\d{1,2})\b/g;
  for (const line of [...lines].reverse()) {
    const matches = [...line.matchAll(loose)];
    const last = matches[matches.length - 1];
    if (last) return String(Number(last[1]));
  }

  return null;
}
