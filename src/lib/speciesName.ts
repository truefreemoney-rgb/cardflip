/**
 * The species behind a printed Pokémon card name: "Charizard ex",
 * "Charizard VMAX" and "Mega Charizard Y ex" all search as "Charizard", and
 * the mirror's substring match then returns every card carrying it. Magic
 * names are exact — no stripping there (callers pass the name through).
 *
 * Pure and browser-free so scripts/test-ocr-text.mjs can pin it: the two
 * regexes shipped with a literal `s+` instead of `\s+` (09-09), so "Not your
 * card?" never stripped a suffix and searched "Charizard ex" verbatim.
 */
const OWNER_PREFIX =
  /^(mega|m|dark|light|shining|radiant|shadow|team rocket's|giovanni's|blaine's|brock's|erika's|koga's|lt\. surge's|misty's|sabrina's|rocket's)\s+/i;
const SUFFIX =
  /\s+(vmax|vstar|v-union|v|gx|ex|lv\.?\s?x|break|prime|legend|star|δ|delta species|[XY])$/i;

export function speciesName(name: string): string {
  let base = name.trim().replace(OWNER_PREFIX, "");
  for (let guard = 0; guard < 3; guard++) {
    const next = base.replace(SUFFIX, "").trim();
    if (next === base) break;
    base = next;
  }
  return base || name;
}
