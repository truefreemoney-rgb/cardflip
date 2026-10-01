/**
 * Punctuation-blind name matching (10-01, scripts/typed-search-check.mjs): a
 * seller types "miracles wake", "raidraptor call", "thespians stage", "poke
 * ball" or "rapunzel creative captor" and the catalog says "Miracle's Wake",
 * "Raidraptor - Call", "Thespian's Stage", "Poké Ball", "Rapunzel" +
 * "Creative Captor". Both sides lose their spaces and punctuation and are
 * compared as one run of letters and digits.
 *
 * The SQL side is a full walk of the game's rows (no index can serve it), so
 * every search runs it LAST and only when the indexed tiers found nothing.
 */

/** Letters and digits only, lowercase, accents folded. */
export function squash(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// SQLite's parser gives up past 27 nested REPLACEs (measured 10-01, "parser
// stack overflow" = a 500 on every search), so the two lists below stay at 26
// together: the punctuation card names hold, and the commonest accents on
// e / u / o / i (SQLite's LOWER leaves É alone). Accents on a and n go
// through looseLike() instead.
const STRIPPED = [" ", "-", "'", "’", ",", ".", ":", "!", "?", "&", "/", '"', "(", ")", "[", "]", "#", "*", "@"];
const ACCENTS: [string, string][] = [["é", "e"], ["É", "e"], ["û", "u"], ["ú", "u"], ["ó", "o"], ["ö", "o"], ["í", "i"]];

/** The SQL twin of squash() for a column or expression. */
export function squashSql(expr: string): string {
  let sql = `LOWER(${expr})`;
  for (const ch of STRIPPED) sql = `REPLACE(${sql}, '${ch === "'" ? "''" : ch}', '')`;
  for (const [from, to] of ACCENTS) sql = `REPLACE(${sql}, '${from}', '${to}')`;
  return sql;
}

/**
 * The LIKE pattern for a squashed needle: a and n match any one character, so
 * "mamacoco" finds "Mamá Coco" and "teka" finds "Te Kā" (the SQL side cannot
 * fold those accents, see above). Kept only while three plain letters remain,
 * and every caller checks the rows it gets with squash() afterwards.
 */
export function looseLike(squashed: string): string {
  const wild = squashed.replace(/[an]/g, "_");
  return wild.replace(/_/g, "").length >= 3 ? wild : squashed;
}

/** Shortest squashed needle worth a walk: two letters match half a catalog. */
export const LOOSE_MIN = 4;
