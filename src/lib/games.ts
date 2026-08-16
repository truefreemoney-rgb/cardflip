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
};

export const GAME_IDS: GameId[] = ["pokemon", "mtg"];

export function isGameId(value: unknown): value is GameId {
  return value === "pokemon" || value === "mtg";
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
  return card.setTotal ? `${card.number}/${card.setTotal}` : card.number;
}

/** MTG finish keys as they appear in `CardPrice.variant`, with UI labels. */
export const MTG_FINISH_LABEL: Record<string, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched foil",
};

/**
 * "Lightning Bolt LTR 187", "Sol Ring 0243/0341", "Ragavan 138 MH2" —
 * MTG search text into name + collector number + set code. Set codes are
 * 3–5 letters/digits printed beside the number; a bare all-caps token that
 * short is treated as one only when a number is also present (or it's the
 * last token), so "Fury Sliver" isn't split.
 */
export function parseMtgQuery(query: string): {
  name: string;
  number: string | null;
  setCode: string | null;
} {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  let number: string | null = null;
  let setCode: string | null = null;
  const nameTokens: string[] = [];
  for (const raw of tokens) {
    const token = raw.replace(/[,]/g, "");
    const fraction = token.match(/^0*(\d{1,4}[a-z★]?)\s*\/\s*\d{1,4}$/i);
    if (fraction && !number) {
      number = fraction[1].toLowerCase();
      continue;
    }
    if (/^0*\d{1,4}[a-z★]?$/i.test(token) && !number && nameTokens.length > 0) {
      number = token.replace(/^0+(?=\d)/, "").toLowerCase();
      continue;
    }
    if (/^#\d{1,4}[a-z]?$/i.test(token) && !number) {
      number = token.slice(1).replace(/^0+(?=\d)/, "").toLowerCase();
      continue;
    }
    if (/^[A-Z][A-Z0-9]{2,4}$/.test(token) && !setCode && nameTokens.length > 0) {
      setCode = token.toLowerCase();
      continue;
    }
    nameTokens.push(token);
  }
  return { name: nameTokens.join(" "), number, setCode };
}
