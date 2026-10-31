import type { PokemonCard, VisionCardRead } from "../../src/lib/types";

/**
 * Hand-built catalog cards and vision reads (10-31). A fresh clone has no
 * mirror, so a scan only finds a card through the reply's `prefetch` (the
 * search the scan route already ran, lib/server/scanPrefetch.ts) or a mocked
 * /api/search-card. No real customer photos or reads: every value is made up
 * to look like the real thing. imageSmall is empty so nothing is fetched from
 * a card CDN (the chip shows its placeholder).
 */

/** A plain Pokémon card under $100: the reveal's "nice" tier, whose price is green (TIER_STYLE). */
export const DRAGONITE: PokemonCard = {
  id: "e2e-fossil-4",
  name: "Dragonite",
  setName: "Fossil",
  setSeries: "Base",
  number: "4",
  rarity: "Rare Holo",
  imageSmall: "",
  imageLarge: "",
  englishName: null,
  setTotal: 62,
  setCode: null,
  game: "pokemon",
  prices: [{ source: "tcgplayer", variant: "holofoil", label: "Holofoil", currency: "USD", market: 42.17, low: 35, high: 60 }],
};

/** A second card for the bulk paths. */
export const MACHAMP: PokemonCard = {
  ...DRAGONITE,
  id: "e2e-base1-8",
  name: "Machamp",
  setName: "Base Set",
  number: "8",
  setTotal: 102,
  prices: [{ source: "tcgplayer", variant: "holofoil", label: "Holofoil", currency: "USD", market: 9.5, low: 7, high: 14 }],
};

/** A Magic printing, for the game-switch path. */
export const SOL_RING: PokemonCard = {
  id: "e2e-mtg-c21-263",
  name: "Sol Ring",
  setName: "Commander 2021",
  setSeries: "Commander",
  number: "263",
  rarity: "uncommon",
  imageSmall: "",
  imageLarge: "",
  englishName: null,
  setCode: "C21",
  game: "mtg",
  finishes: ["nonfoil"],
  prices: [{ source: "tcgplayer", variant: "nonfoil", label: "Normal", currency: "USD", market: 1.89, low: 1, high: 3 }],
};

/** A clean read of `card`: what vision returns for a sharp photo of it. */
export function readOf(card: PokemonCard, extra: Partial<VisionCardRead> = {}): VisionCardRead {
  return {
    name: card.name,
    englishName: null,
    setName: card.setName,
    cardNumber: card.number,
    setTotal: card.setTotal ?? null,
    setCode: card.setCode ?? null,
    artStyle: "standard",
    language: "en",
    condition: "Near Mint",
    conditionNotes: null,
    confidence: 0.97,
    kind: "card",
    slab: false,
    game: card.game ?? "pokemon",
    ...extra,
  } as VisionCardRead;
}

/** The empty outcomes of 10-31 (each says why, is given back, saves nothing). */
export const READS = {
  slab: readOf(DRAGONITE, { slab: true, slabGrader: "PSA" }),
  sealed: readOf({ ...DRAGONITE, name: "Fossil Booster Pack", number: "", setTotal: null }, { kind: "sealed", cardNumber: null }),
  otherGame: readOf(DRAGONITE, { name: "Sol Ring", cardNumber: "263", setCode: "C21", setTotal: null, detectedGame: "mtg" }),
  unreadable: readOf(DRAGONITE, { name: "Unknown", cardNumber: null, setTotal: null, confidence: 0.05 }),
  mtgToken: readOf(SOL_RING, { name: "Treasure", cardNumber: "T 0016", kind: "token" }),
  mtgArt: readOf(SOL_RING, { name: "Sol Ring", cardNumber: "54", kind: "art" }),
} satisfies Record<string, VisionCardRead>;
