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
 * Hashtags. Threads turns only the FIRST into its topic, so the biggest
 * community goes first; Bluesky makes a facet only of [A-Za-z][A-Za-z0-9]*,
 * so no hyphens. Lists are cut from the END to fit a site (fitText: X and
 * Bluesky by length, Instagram and TikTok at five tags), so order = priority.
 * games (Chris 09-30: "include hashtags for all the games, i want the
 * biggest reach possible"): one tag per game first, so every site names every
 * game. Capped at FIVE (10-01: more reads as spam and TikTok shows five):
 * gamesTags picks the five best for the games a post covers.
 */
export const GAME_HASHTAGS: Record<GameId, string[]> = {
  pokemon: ["PokemonTCG", "PokemonCards"],
  mtg: ["MTG", "MagicTheGathering"],
  lorcana: ["DisneyLorcana", "Lorcana"],
  onepiece: ["OPTCG", "OnePieceCardGame"],
  yugioh: ["Yugioh", "YuGiOhTCG"],
};
/** The general tags that fill the room a post's game tags leave. */
export const GENERAL_TAGS = ["TCG", "TradingCards", "CardCollector"];
/** The most hashtags any post carries (TikTok and Instagram both stop at five). */
export const MAX_TAGS = 5;

/**
 * The tags for a post that covers `games`: each game's own first tag (in the
 * order given), then the general ones, then each game's second tag, cut at
 * MAX_TAGS. Five games = the five game tags; four = four plus #TCG.
 */
export function gamesTags(games: GameId[]): string[] {
  const out: string[] = [];
  const add = (t: string | undefined) => {
    if (t && !out.includes(t)) out.push(t);
  };
  // The site's game order, not the post's (Threads makes the first tag its topic: the biggest community goes first).
  const ordered = POST_GAME_ORDER.filter((g) => games.includes(g));
  for (const g of ordered) add(GAME_HASHTAGS[g][0]);
  for (const t of GENERAL_TAGS) add(t);
  for (const g of ordered) add(GAME_HASHTAGS[g][1]);
  return out.slice(0, MAX_TAGS);
}

export const PLAN_TAGS = {
  games: gamesTags(POST_GAME_ORDER),
  mixedMovers: ["PokemonTCG", "MTG", "MagicTheGathering", "TCG", "TradingCards"],
  pokemonAlsoScans: ["PokemonTCG", "PokemonCards", "TCG", "TradingCards"],
} as const;

/**
 * 10-01 (the owner: "most views and clicks on every site"). From this Eastern
 * day on, the standing 7pm post is "the biggest price jump in each game this
 * week" (a per-game top gainer, the old lead card where a game has none), and
 * the 7am set spotlight leads with the card that moved UP the most. Earlier
 * days keep what already went out, so a re-render of an old day is unchanged.
 */
export const JUMPS_FROM = "2026-10-01";
export function jumpsOn(day: string | undefined): boolean {
  return Boolean(day) && (day as string) >= JUMPS_FROM;
}
/**
 * A game's top gainer must have moved at least this much to be "the biggest jump" (a +2% week is no headline: that game
 * keeps its lead card). The set spotlight uses it too: a riser takes the lead over the set's most valuable card when it
 * rose this much, or when that card fell (a +3% riser under a steady leader changes nothing).
 */
export const JUMP_MIN_PCT = 5;

/** Items laid out as a fan, the middle one on top: the first of `sorted` goes in the centre, the rest alternate right and left of it. */
export function fanOrder<T>(sorted: T[]): T[] {
  const n = sorted.length;
  const out: (T | undefined)[] = new Array(n).fill(undefined);
  const mid = Math.floor((n - 1) / 2);
  let k = 0;
  for (let d = 0; k < n; d++) {
    for (const i of d === 0 ? [mid] : [mid + d, mid - d]) if (i >= 0 && i < n && k < n && out[i] === undefined) out[i] = sorted[k++];
  }
  return out as T[];
}
