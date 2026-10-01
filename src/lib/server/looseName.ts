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

const STRIPPED = [" ", "-", "'", "’", ",", ".", ":", "!", "?", "&", "/", '"', "(", ")", "[", "]"];

/** The SQL twin of squash() for a column or expression (the common punctuation and é). */
export function squashSql(expr: string): string {
  let sql = `LOWER(${expr})`;
  for (const ch of STRIPPED) sql = `REPLACE(${sql}, '${ch === "'" ? "''" : ch}', '')`;
  return `REPLACE(${sql}, 'é', 'e')`;
}

/** Shortest squashed needle worth a walk: two letters match half a catalog. */
export const LOOSE_MIN = 4;
