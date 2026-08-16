/**
 * Graded slabs and sealed product, as domain data.
 *
 * Both exist because a seller's inventory isn't only raw singles: the
 * expensive end of a collection is usually a graded card or an unopened box,
 * and both sell on eBay through exactly the pipeline this app already has.
 * What differs is identification (a slab's grade is printed on the label and
 * a box has no collector number — nothing to OCR) and pricing (no free API
 * quotes graded or sealed prices), so both are declared by the seller and
 * priced by hand against eBay comps.
 *
 * Pure and dependency-free so scripts/test-pricing.mjs can exercise it.
 */

import type { GameId, GradedInfo, GradingCompany, PokemonCard } from "@/lib/types";
import { GAMES } from "./games.ts";

export const GRADING_COMPANIES: GradingCompany[] = ["PSA", "CGC"];

/**
 * Each grader's real scale, best grade first (the common case — people slab
 * cards they expect to grade well).
 *
 * The scales genuinely differ and must not be merged: PSA uses whole grades
 * with 1.5 as its only half step ("Fair"), while CGC half-grades the whole
 * ladder and caps it with Pristine 10 above 10. Grades are strings, not
 * numbers, precisely because of entries like "10 Pristine" — and because
 * "8.5" must round-trip through the UI and the listing title unchanged.
 */
const GRADE_SCALES: Record<GradingCompany, string[]> = {
  PSA: ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1.5", "1"],
  CGC: [
    "10 Pristine",
    "10",
    "9.5",
    "9",
    "8.5",
    "8",
    "7.5",
    "7",
    "6.5",
    "6",
    "5.5",
    "5",
    "4.5",
    "4",
    "3.5",
    "3",
    "2.5",
    "2",
    "1.5",
    "1",
  ],
};

export function gradesFor(company: GradingCompany): string[] {
  return GRADE_SCALES[company];
}

/**
 * The label as it appears on the slab and in eBay searches: "PSA 10",
 * "CGC 9.5", "CGC 10 Pristine". This exact string goes into listing titles
 * and comp searches, so it has to match what buyers type.
 */
export function gradeLabel(grading: GradedInfo): string {
  return `${grading.company} ${grading.grade}`;
}

/**
 * Pull a typed grade out of a search query: "Charizard 4/102 PSA 10" →
 * the grade plus "Charizard 4/102" for the card search.
 *
 * Sellers holding a slab type what's on the label, and without this the
 * trailing "10" would be read as a collector number (see parseCardQuery) and
 * match nothing. Strip the grade FIRST, then parse the remainder as a card.
 *
 * Only grades on the company's real ladder parse ("PSA 9.5" doesn't exist —
 * PSA's only half step is 1.5). An off-ladder grade returns the query
 * untouched rather than guessing: the search will then miss and the seller
 * re-reads the label, which beats silently adding the card raw or snapping
 * to a grade the slab doesn't say.
 */
export function parseGradeQuery(query: string): {
  /** The query with the grade removed — what the card search should see. */
  rest: string;
  grading: GradedInfo | null;
} {
  const match = query.match(
    /\b(PSA|CGC)\s*(10\s+Pristine|Pristine\s*10|\d{1,2}(?:\.\d)?)\b/i,
  );
  if (!match) return { rest: query, grading: null };

  const company = match[1].toUpperCase() as GradingCompany;
  const grade = /pristine/i.test(match[2]) ? "10 Pristine" : match[2];
  if (!gradesFor(company).includes(grade)) return { rest: query, grading: null };

  return {
    rest: query.replace(match[0], " ").replace(/\s+/g, " ").trim(),
    grading: { company, grade },
  };
}

/**
 * Sealed product types a set could have shipped as. A curated menu, not a
 * per-set database: no free source knows which products each of 218 sets
 * actually had, and the seller is holding the box — they know what it is.
 * Ordered by how often they're resold.
 */
export const SEALED_PRODUCT_TYPES = GAMES.pokemon.sealedProductTypes;

/** Sealed product menu for a game (MTG: Play/Draft/Set/Collector boosters, Bundles, Commander decks…). */
export function sealedProductTypesFor(game: GameId): string[] {
  return GAMES[game].sealedProductTypes;
}

/** A set as the /api/sets endpoint serves it, for the sealed-product picker. */
export interface SetInfo {
  name: string;
  releaseDate: string;
  /** Set logo (TCGdex, derived from the card image path; Scryfall's set icon for MTG). May 404 — CardImage falls back. */
  logoUrl: string;
  /** MTG only: Scryfall set code ("ltr"). */
  code?: string;
}

/**
 * A set's logo URL, derived from any of its cards' image URLs. TCGdex hosts
 * assets as .../en/<serie>/<set>/<cardId>/low.webp with the set logo one level
 * up at .../en/<serie>/<set>/logo.webp — the mirror stores card images only,
 * so this is how a set gets a thumbnail without another sync field.
 */
export function setLogoFromCardImage(cardImageUrl: string): string {
  const match = cardImageUrl.match(/^(.*)\/[^/]+\/low\.webp$/);
  return match ? `${match[1]}/logo.webp` : "";
}

/**
 * A sealed product shaped as a PokemonCard, so the queue, editing pane,
 * pricing plumbing, and server ledger can carry it without a parallel type
 * threaded through every component. The fields that don't apply are empty
 * rather than fake: no collector number, no rarity, no catalogue prices —
 * an empty prices array is what makes the editor fall back to manual
 * pricing, which for sealed product is the only honest kind.
 */
export function makeSealedProduct(
  set: SetInfo,
  productType: string,
  game: GameId = "pokemon",
): PokemonCard {
  return {
    id: `sealed-${game}-${set.name}-${productType}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: `${set.name} ${productType}`,
    setName: set.name,
    setSeries: "",
    number: "",
    rarity: null,
    imageSmall: set.logoUrl,
    imageLarge: set.logoUrl,
    prices: [],
    englishName: null,
    setTotal: null,
    setCode: set.code ?? null,
    isSecretRare: false,
    game,
  };
}
