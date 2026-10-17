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

/**
 * Versions the picture cannot tell from the plain card (`pickByPicture: false`):
 * a peeled Peelable Ditto is the plain reverse holo plus a small Ditto mark,
 * and the picture check would hand a $0.65 reverse holo the $14.70 version.
 * They rank just outside the tie gap: listed as a choice, never picked alone.
 */
const PICK_BY_HAND: ReadonlySet<string> = new Set(versions.filter((v) => v.pickByPicture === false).map((v) => v.id));

/** Ranking points an art version gives up (lib/server/enCards.ts score): 0, or past TIEBREAK_GAP. */
export function artVersionPenalty(id: string): number {
  return PICK_BY_HAND.has(id) ? 2 : 0;
}

/** The name printed on the card: an art version's label dropped, any other name as is. */
export function printedName(id: string, name: string): string {
  return ART_VERSION_IDS.has(id) ? name.replace(/\s*\([^)]*\)$/, "") : name;
}
