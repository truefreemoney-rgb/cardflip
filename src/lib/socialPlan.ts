import type { GameId } from "@/lib/types";
import type { PostKind } from "@/lib/server/social";

/**
 * One-off social plans for a given Eastern day (Chris 09-30: "for the posts
 * on 9/30 … i want to make sure we get as many users coming in as
 * possible"). A day with no entry posts the standing mix (socialPublish.ts
 * SLOTS: 7am set spotlight, 1pm Pokémon movers video, 7pm Pokémon drops).
 * Pure, so the publisher, the picture route and the video script
 * (scripts/social-video.mjs) all read the same plan.
 */
export interface DayPlan {
  /** The 7am slot posts this kind instead of SLOTS.morning. */
  morning?: PostKind;
  /** The 7pm slot posts this kind instead of SLOTS.evening ("games" = all five games in one picture). */
  evening?: PostKind;
  /** The 1pm movers post and video mix Pokémon and Magic gainers (MIXED_PER_GAME each) and the video ends on every game. */
  mixedMovers?: boolean;
  /** Pokémon pictures and captions say the scanner also reads the other games. */
  alsoScans?: boolean;
  /**
   * The set spotlight's set (a Pokémon set id, "base4"), when Chris approved a
   * preview: the date hash runs over the sets that qualify that minute, so a
   * price run or an engine change can move the pick after he said yes (09-30:
   * Base Set 2 approved, a pool fix turned it into Call of Legends).
   */
  set?: string;
}

export const DAY_PLANS: Record<string, DayPlan> = {
  // 7am keeps the set spotlight (Pokémon, "also scans"), 7pm is the all-games picture (Chris: "switch 7am and 7pm";
  // that day's drops were -8% moves, so the set post stayed and the drops sat out).
  "2026-09-30": { mixedMovers: true, alsoScans: true, evening: "games", set: "base4" },
};

/** "five" for the small counts a caption says out loud. */
export function countWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}

export function dayPlan(day: string | undefined): DayPlan {
  return (day && DAY_PLANS[day]) || {};
}

/** The games a mixed movers post draws from, in the order they alternate. */
export const MIXED_GAMES: GameId[] = ["pokemon", "mtg"];
export const MIXED_PER_GAME = 3;

/** Every game, in the site's switch order. */
export const POST_GAME_ORDER: GameId[] = ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"];

/** Game names as posts write them: "Yu-Gi-Oh" without the "!" (house voice, no exclamation marks). */
export const POST_GAME_NAMES: Record<GameId, string> = {
  pokemon: "Pokémon",
  mtg: "Magic",
  lorcana: "Lorcana",
  onepiece: "One Piece",
  yugioh: "Yu-Gi-Oh",
};

/** "A, B, C and D". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The games a post does NOT cover, by post name, in switch order. */
export function otherGameNames(covered: GameId[]): string[] {
  return POST_GAME_ORDER.filter((g) => !covered.includes(g)).map((g) => POST_GAME_NAMES[g]);
}

/**
 * Hashtags, at most five (Instagram's cap; Threads turns only the FIRST
 * into its topic, so the biggest community goes first). Bluesky makes a
 * facet only of [A-Za-z][A-Za-z0-9]*, so no hyphens.
 */
export const PLAN_TAGS = {
  games: ["PokemonTCG", "MTG", "DisneyLorcana", "OPTCG", "Yugioh"],
  mixedMovers: ["PokemonTCG", "MTG", "MagicTheGathering", "TCG", "TradingCards"],
  pokemonAlsoScans: ["PokemonTCG", "PokemonCards", "TCG", "TradingCards"],
} as const;
