/**
 * Art versions (Chris 10-17, #11): one set number printed with different
 * artwork that TCGplayer sells as separate products at different prices —
 * Vivillon xy1-17 Meadow / High Plains, Base Set Pikachu Red Cheeks, the
 * Pokémon GO Peelable Ditto cards. Each version is its own catalog card
 * (scripts/sync-art-versions.mjs): own id, own picture, own product, own price.
 *
 * The version's catalog name carries a label ("Vivillon (High Plains Orange)")
 * but the printed card just says "Vivillon", so the scan ranks it on the bare
 * name: it ties with the plain card and the picture tiebreak picks the art.
 * Client-safe.
 */

import versions from "@/data/pokemon-art-versions.json" with { type: "json" };

const ART_VERSION_IDS: ReadonlySet<string> = new Set(versions.map((v) => v.id));

/** Whether a Pokémon catalog id is an art version twin. */
export function isArtVersionId(id: string): boolean {
  return ART_VERSION_IDS.has(id);
}

/** The name printed on the card: an art version's label dropped, any other name as is. */
export function printedName(id: string, name: string): string {
  return ART_VERSION_IDS.has(id) ? name.replace(/\s*\([^)]*\)$/, "") : name;
}
