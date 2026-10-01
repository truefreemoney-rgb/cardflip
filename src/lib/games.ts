/**
 * Per-game facts. Everything that differs between Pokémon and Magic: The
 * Gathering — words in listing titles, eBay aspects, sealed product types,
 * search tokens, vision hints — lives here so the rest of the pipeline stays
 * a single code path keyed by `GameId`.
 *
 * eBay note: since the 2020 restructure every CCG single lists in the same
 * leaf category (183454 "CCG Individual Cards") and the game is an item
 * specific ("Game: Magic: The Gathering"), so category ids don't vary per
 * game — only the aspect and the words do. Same for sealed (183456 packs /
 * 261044 boxes).
 */

import type { GameId } from "@/lib/types";

export interface GameInfo {
  id: GameId;
  /** Short UI name ("Pokémon", "Magic"). */
  label: string;
  /** Full name for copy and eBay's Game aspect. */
  fullName: string;
  /** Word(s) that go into eBay listing titles ("Pokemon TCG", "MTG"). */
  titleToken: string;
  /** Word appended to eBay search queries so comps stay in-game. */
  searchToken: string;
  /** eBay item specific "Game" value. */
  ebayGameAspect: string;
  /** Category breadcrumb shown in the editor. */
  singlesCategoryName: string;
  sealedCategoryName: string;
  /** Sealed product types offered in the "sell sealed product" picker. */
  sealedProductTypes: string[];
  /** Placeholder for the manual search box. */
  searchPlaceholder: string;
  /** Example printed number for hints. */
  numberExample: string;
}

export const GAMES: Record<GameId, GameInfo> = {
  pokemon: {
    id: "pokemon",
    label: "Pokémon",
    fullName: "Pokémon TCG",
    titleToken: "Pokemon TCG",
    searchToken: "pokemon",
    ebayGameAspect: "Pokémon TCG",
    singlesCategoryName: "Collectible Card Games > Pokémon TCG > Individual Cards",
    sealedCategoryName: "Collectible Card Games > Pokémon TCG > Sealed Products",
    sealedProductTypes: [
      "Booster Pack",
      "Booster Box",
      "Elite Trainer Box",
      "Booster Bundle",
      "Collection Box",
      "Premium Collection",
      "Tin",
      "Blister Pack",
      "Build & Battle Box",
      "Theme Deck",
      "Starter Deck",
      "Half Booster Box",
    ],
    searchPlaceholder: "e.g. Charizard 4/102",
    numberExample: "4/102",
  },
  mtg: {
    id: "mtg",
    label: "Magic",
    fullName: "Magic: The Gathering",
    titleToken: "MTG",
    searchToken: "mtg",
    ebayGameAspect: "Magic: The Gathering",
    singlesCategoryName: "Collectible Card Games > Magic: The Gathering > Individual Cards",
    sealedCategoryName: "Collectible Card Games > Magic: The Gathering > Sealed Products",
    sealedProductTypes: [
      "Play Booster Pack",
      "Play Booster Box",
      "Draft Booster Pack",
      "Draft Booster Box",
      "Set Booster Pack",
      "Set Booster Box",
      "Collector Booster Pack",
      "Collector Booster Box",
      "Bundle",
      "Gift Bundle",
      "Commander Deck",
      "Prerelease Pack",
      "Starter Kit",
      "Secret Lair Drop",
    ],
    searchPlaceholder: "e.g. Lightning Bolt LTR 187",
    numberExample: "187/281",
  },
  // 09-10: the games after Magic (docs/NEW-GAMES.md). Same eBay CCG
  // categories; only the Game aspect and the words differ.
  lorcana: {
    id: "lorcana",
    label: "Lorcana",
    fullName: "Disney Lorcana",
    titleToken: "Disney Lorcana",
    searchToken: "lorcana",
    ebayGameAspect: "Disney Lorcana",
    singlesCategoryName: "Collectible Card Games > Disney Lorcana > Individual Cards",
    sealedCategoryName: "Collectible Card Games > Disney Lorcana > Sealed Products",
    sealedProductTypes: ["Booster Pack", "Booster Box", "Illumineer's Trove", "Starter Deck", "Gift Set", "Blister Pack"],
    searchPlaceholder: "e.g. Elsa 42/204",
    numberExample: "42/204",
  },
  onepiece: {
    id: "onepiece",
    label: "One Piece",
    fullName: "One Piece Card Game",
    titleToken: "One Piece TCG",
    searchToken: "one piece",
    ebayGameAspect: "One Piece Card Game",
    singlesCategoryName: "Collectible Card Games > One Piece Card Game > Individual Cards",
    sealedCategoryName: "Collectible Card Games > One Piece Card Game > Sealed Products",
    sealedProductTypes: ["Booster Pack", "Booster Box", "Starter Deck", "Double Pack", "Premium Card Collection"],
    searchPlaceholder: "e.g. Roronoa Zoro OP01-001",
    numberExample: "OP01-001",
  },
  // 09-29 (Chris: "add yugioh to the list"). Printed key = the set code
  // "LOB-EN005"; sellers title it "Yugioh" (sold listings), eBay's Game aspect
  // says "Yu-Gi-Oh! TCG".
  yugioh: {
    id: "yugioh",
    label: "Yu-Gi-Oh!",
    fullName: "Yu-Gi-Oh! TCG",
    titleToken: "Yugioh",
    searchToken: "yugioh",
    ebayGameAspect: "Yu-Gi-Oh! TCG",
    singlesCategoryName: "Collectible Card Games > Yu-Gi-Oh! TCG > Individual Cards",
    sealedCategoryName: "Collectible Card Games > Yu-Gi-Oh! TCG > Sealed Products",
    sealedProductTypes: ["Booster Pack", "Booster Box", "Structure Deck", "Tin", "Special Edition", "Collection Box"],
    searchPlaceholder: "e.g. Dark Magician LOB-EN005",
    numberExample: "LOB-EN005",
  },
};

export const GAME_IDS: GameId[] = ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"];

/** The footer's disclaimer, one line for every game we read (09-30: the lineup is closed at five, so no more per-switch wording). */
export const NOT_AFFILIATED =
  "Not affiliated with Nintendo, The Pokémon Company, Wizards of the Coast, Ravensburger, Disney, Konami, Bandai, or eBay Inc.";

/** Games whose printed number is one token with the set inside ("OP01-077", "LOB-EN005"). */
export const SET_IN_NUMBER_GAMES: GameId[] = ["onepiece", "yugioh"];

export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && (GAME_IDS as string[]).includes(value);
}

/** Query-string / form value → GameId, Pokémon when absent or unknown. */
export function parseGame(value: string | null | undefined): GameId {
  return isGameId(value) ? value : "pokemon";
}

const GAME_STORAGE_KEY = "cardflip.game";

/**
 * The game the browser last chose (scanner, price check and wishlist share
 * it). Safe on the server and in private mode — falls back to Pokémon. Use as
 * a lazy `useState` initializer on pages that render nothing until auth
 * resolves, so there is no hydration mismatch to worry about.
 */
export function readSavedGame(): GameId {
  if (typeof window === "undefined") return "pokemon";
  try {
    return parseGame(window.localStorage.getItem(GAME_STORAGE_KEY));
  } catch {
    return "pokemon";
  }
}

export function saveGame(game: GameId): void {
  try {
    window.localStorage.setItem(GAME_STORAGE_KEY, game);
  } catch {
    // Private mode / quota — the choice just doesn't persist.
  }
}

/**
 * How a card's number reads in the UI: Pokémon "4/102" (number over set
 * total), MTG "LTR 187" (set code + collector number — the two facts printed
 * together on the card and the way buyers search).
 */
export function displayCardNumber(card: {
  number: string;
  setTotal?: number | null;
  setCode?: string | null;
  game?: GameId;
}): string {
  if (card.game === "mtg") return `${card.setCode ?? ""} ${card.number}`.trim();
  // One Piece / Yu-Gi-Oh! print the set inside the number ("OP01-077",
  // "LOB-EN005"); Lorcana prints number/total like Pokémon.
  if (card.game && SET_IN_NUMBER_GAMES.includes(card.game)) return card.number;
  return card.setTotal ? `${card.number}/${card.setTotal}` : card.number;
}

/**
 * The number exactly as the card prints it, for eBay titles and the Card
 * Number specific: "083/086", "161/131", "4/102". Modern sets zero-pad the
 * number to three digits and print the total the same width; our catalog
 * keeps the padded number ("083") but the bare total (86), so the total is
 * padded out to the number's width. Old sets ("4" of 102) are untouched.
 * Buyers search the printed form, so this is what the title must say.
 */
export function printedCardNumber(card: {
  number: string;
  setTotal?: number | null;
  setCode?: string | null;
  game?: GameId;
}): string {
  if (card.game === "mtg" || (card.game && SET_IN_NUMBER_GAMES.includes(card.game)) || !card.setTotal) return displayCardNumber(card);
  const digits = /^\d+$/.test(card.number) ? card.number.length : 0;
  const total = String(card.setTotal).padStart(digits, "0");
  return `${card.number}/${total}`;
}

/** MTG finish keys as they appear in `CardPrice.variant`, with UI labels. */
export const MTG_FINISH_LABEL: Record<string, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched foil",
};

/**
 * "Lightning Bolt LTR 187", "Sol Ring 0243/0341", "Ragavan 138 MH2" —
 * MTG search text into name + collector number + set code.
 *
 * The number is the LAST number-like token (digits with at most one letter or
 * a star, a fraction, "#187", or a List number "2XM-77"); the set code is the
 * token beside it: 3–5 capitals / digits with a letter in it, so "40K", "2XM"
 * and "10E" count and "Fury Sliver" isn't split. "BLB 280" with no name is a
 * whole search. `loose` also takes a lowercase neighbour as the code ("forest
 * blb 280"): the second try when the strict parse found nothing (10-01).
 */
const MTG_NUMBER = /^#?0*(\d{1,4}[a-z★]?)$/i;
const MTG_FRACTION = /^0*(\d{1,4}[a-z★]?)\/\d{1,4}$/i;
const MTG_LIST_NUMBER = /^[A-Z0-9]{2,5}-\d{1,4}[a-z]?$/i;
const MTG_CODE = /^(?=.*[A-Z])[A-Z0-9]{3,5}$/;
const MTG_CODE_LOOSE = /^(?=.*[a-z])[a-z0-9]{3,5}$/i;

const MTG_LETTERED_NUMBER = /^[A-Z]{1,2}\d{1,4}$/i;

export function parseMtgQuery(query: string, loose = false, lettered = !loose): {
  name: string;
  number: string | null;
  setCode: string | null;
} {
  const tokens = query.trim().split(/\s+/).map((t) => t.replace(/,/g, "")).filter(Boolean);
  const isCode = (t: string | undefined) => t !== undefined && (MTG_CODE.test(t) || (loose && MTG_CODE_LOOSE.test(t)));
  // A few promo sets number with a letter in front ("PUMA U32"). It reads
  // like a set code ("M21"), so it is the number only as the last token,
  // right after a set code; `lettered` is its own try in a loose parse.
  const last = tokens.length - 1;
  if (lettered && last > 0 && MTG_LETTERED_NUMBER.test(tokens[last]) && isCode(tokens[last - 1]) && (loose || tokens[last] === tokens[last].toUpperCase())) {
    return { name: tokens.slice(0, last - 1).join(" "), number: tokens[last].toLowerCase(), setCode: tokens[last - 1].toLowerCase() };
  }
  const numberOf = (i: number): string | null => {
    const t = tokens[i];
    const fraction = MTG_FRACTION.exec(t);
    if (fraction) return fraction[1].toLowerCase();
    if (MTG_LIST_NUMBER.test(t)) return t.toLowerCase();
    // A bare number needs something before it (the name or the set): "151" alone is a name.
    const plain = MTG_NUMBER.exec(t);
    return plain && (i > 0 || t.startsWith("#")) ? plain[1].toLowerCase() : null;
  };
  let at = -1;
  for (let i = tokens.length - 1; i >= 0; i--) if (numberOf(i) !== null) { at = i; break; }
  // "Forest 380 10E": the last token reads as a number and as a set code; the number is the one before it.
  if (at > 1 && MTG_CODE.test(tokens[at]) && MTG_NUMBER.test(tokens[at - 1])) at -= 1;
  let codeAt = -1;
  if (at >= 0) {
    if (isCode(tokens[at + 1])) codeAt = at + 1;
    else if (at > 0 && isCode(tokens[at - 1])) codeAt = at - 1;
  } else if (tokens.length > 1 && isCode(tokens[tokens.length - 1])) codeAt = tokens.length - 1;
  return {
    name: tokens.filter((_, i) => i !== at && i !== codeAt).join(" "),
    number: at >= 0 ? numberOf(at) : null,
    setCode: codeAt >= 0 ? tokens[codeAt].toLowerCase() : null,
  };
}
