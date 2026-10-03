import type { GameId } from "@/lib/types";

/**
 * The homepage card wall's recipe (Chris 10-02 night: "pokemon should
 * definitely lead mostly but i want magic to come in second and then a mix
 * of the other games"). Pure: lib/server/wallCards.ts gathers the pools,
 * this orders them. Tested in scripts/test-wall-mix.mjs.
 *
 * The first eight (the wall) are 4 Pokémon, 2 Magic, 2 from the other games;
 * the rest of the list (the ticker, the demo Inventory rows) keeps the same
 * ratio, P P M O. The "other" slot rotates through the other games that have
 * a card, starting from a seed (the day) so the mix moves day to day. A game
 * that comes up short hands its slots to Pokémon, then Magic: the wall is
 * never shorter for a missing game.
 */
export const WALL_SIZE = 8;
export const WALL_RECIPE: ("pokemon" | "mtg" | "other")[] = ["pokemon", "pokemon", "pokemon", "pokemon", "mtg", "mtg", "other", "other"];
const TICKER_RECIPE: ("pokemon" | "mtg" | "other")[] = ["pokemon", "pokemon", "mtg", "other"];

export function composeWall<T extends { id: string }>(pools: Partial<Record<GameId, T[]>>, limit = 24, seed = 0): T[] {
  const take = { pokemon: [...(pools.pokemon ?? [])], mtg: [...(pools.mtg ?? [])] };
  const others = (["lorcana", "onepiece", "yugioh"] as const).filter((g) => (pools[g]?.length ?? 0) > 0).map((g) => [...pools[g]!]);
  let turn = others.length ? Math.abs(seed) % others.length : 0;
  const nextOther = (): T | undefined => {
    for (let i = 0; i < others.length; i++) {
      const pool = others[(turn + i) % others.length];
      if (pool.length) {
        turn = (turn + i + 1) % others.length;
        return pool.shift();
      }
    }
    return undefined;
  };
  const next = (want: "pokemon" | "mtg" | "other"): T | undefined => {
    if (want === "other") return nextOther() ?? take.pokemon.shift() ?? take.mtg.shift();
    if (want === "mtg") return take.mtg.shift() ?? take.pokemon.shift() ?? nextOther();
    return take.pokemon.shift() ?? take.mtg.shift() ?? nextOther();
  };
  const out: T[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < limit; i++) {
    const want = i < WALL_RECIPE.length ? WALL_RECIPE[i] : TICKER_RECIPE[(i - WALL_RECIPE.length) % TICKER_RECIPE.length];
    const card = next(want);
    if (!card) break;
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    out.push(card);
  }
  return out;
}
