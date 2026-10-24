import type { GameId } from "./types";

/**
 * Rarity tiers per game, rarest first, in each catalog's own spelling
 * (lowercased, "_" and curly apostrophes folded). One list per game because
 * the same word ranks differently across games ("Super Rare" is Lorcana's
 * fourth tier, mid-pack in Yu-Gi-Oh), and a shared list put Magic's "mythic"
 * after "common" (10-24, Chris: "obviously not picking the rarest cards").
 */
const TIERS: Record<GameId, string[]> = {
  // TCGplayer / pokemontcg.io / TCGdex spellings.
  pokemon: [
    "mega hyper rare", "black white rare", "special illustration rare", "hyper rare", "secret rare", "rare secret",
    "rare rainbow", "rare shiny gx", "rare ultra", "ultra rare", "illustration rare", "shiny ultra rare", "shiny rare",
    "rare shiny", "rare shining", "double rare", "ace spec rare", "rare ace", "amazing rare", "radiant rare",
    "trainer gallery rare holo", "rare holo vmax", "rare holo vstar", "rare holo v", "rare holo gx", "rare holo ex",
    "rare holo lv.x", "rare prism star", "rare break", "rare prime", "legend", "classic collection", "rare holo",
    "holo rare", "rare", "promo", "uncommon", "common",
  ],
  // Scryfall's.
  mtg: ["bonus", "mythic", "special", "rare", "uncommon", "common"],
  lorcana: ["iconic", "enchanted", "epic", "legendary", "super rare", "rare", "promo", "uncommon", "common"],
  // Bandai's codes: Treasure Rare, SP card, Secret, Super Rare, Leader, Rare, Promo, Uncommon, DON!!, Common.
  onepiece: ["tr", "sp", "sp card", "sec", "sr", "l", "r", "pr", "p", "uc", "don!!", "c"],
  yugioh: [
    "10000 secret rare", "starlight rare", "ghost rare", "ghost/gold rare", "quarter century secret rare",
    "grand master rare", "prismatic collector's rare", "collector's rare", "prismatic ultimate rare", "ultimate rare",
    "platinum secret rare", "prismatic secret rare", "secret pharaoh's rare", "ultra pharaoh's rare",
    "emblazoned secret rare", "gold secret rare", "premium gold rare", "secret rare", "emblazoned ultra rare",
    "platinum rare", "gold rare", "ultra rare", "duel terminal ultra parallel rare", "duel terminal technology ultra rare",
    "super rare", "duel terminal super parallel rare", "parallel rare", "mosaic rare", "starfoil rare",
    "shatterfoil rare", "duel terminal rare parallel rare", "rare", "promo", "duel terminal normal parallel rare",
    "short print", "common", "duel terminal technology common",
  ],
};

const fold = (s: string) => s.trim().toLowerCase().replace(/_/g, " ").replace(/[‘’]/g, "'").replace(/\s+/g, " ");

/**
 * Sort rank, lower = rarer. No game = Pokémon (the original game). An
 * unknown spelling that still says "rare"/"secret" sits just above the
 * game's plain Rare, any other unknown just below it; no rarity goes last.
 */
export function rarityRank(game: GameId | null | undefined, rarity: string | null | undefined): number {
  if (!rarity) return 1000;
  const tiers = TIERS[game ?? "pokemon"] ?? TIERS.pokemon;
  const key = fold(rarity);
  const i = tiers.indexOf(key);
  if (i !== -1) return i;
  const rare = tiers.indexOf("rare");
  return /rare|secret/.test(key) ? rare - 0.5 : rare + 0.5;
}
