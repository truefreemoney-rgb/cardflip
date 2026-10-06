import "server-only";
import { cachedList } from "@/lib/server/listCache";
import { pageTilesByIds } from "@/lib/server/cardPages";
import { MOVER_DAYS, MOVER_GAMES, topMovers, variantLabel, type Mover } from "@/lib/server/social";
import type { GameId } from "@/lib/types";

/**
 * The public top-movers page's read (/cards/{game}/movers). It reuses the social
 * autopilot's topMovers, so every guard is the same one the posts use: the $10
 * floor on both ends, a price that held, a believable old price, the step-jump
 * rule, the price trust check. Built once per range per six hours into card_cache;
 * a failure is an empty list (the page says so), never an error page.
 */

export type MoverRange = 7 | 30;
export const MOVER_RANGES: MoverRange[] = [7, 30];
export const MOVERS_SHOWN = 10;
const TTL_MS = 6 * 60 * 60 * 1000;

/** The games the autopilot's movers read covers (Pokémon, Magic). */
export const hasMovers = (game: GameId): boolean => MOVER_GAMES.includes(game);

export interface MoverRow {
  key: string;
  name: string;
  number: string;
  image: string;
  setSlug: string;
  setName: string;
  variant: string;
  from: number;
  to: number;
  pct: number;
}

export interface GameMovers {
  up: MoverRow[];
  down: MoverRow[];
}

async function rowsFor(game: GameId, movers: Mover[]): Promise<MoverRow[]> {
  const tiles = await pageTilesByIds(game, movers.map((m) => m.cardId));
  const out: MoverRow[] = [];
  for (const m of movers) {
    const t = tiles.get(m.cardId);
    if (!t || m.unsettled) continue;
    out.push({ key: t.key, name: t.name, number: t.number, image: t.image, setSlug: t.setSlug, setName: t.setName, variant: variantLabel(m.variant), from: m.from, to: m.to, pct: m.pct });
  }
  return out.slice(0, MOVERS_SHOWN);
}

async function build(game: GameId, days: number): Promise<GameMovers> {
  // Magic's history has a gap, so an empty look back is retried a day shorter (as mixedMovers does).
  const read = async (direction: "up" | "down") => {
    const opts = { direction, limit: MOVERS_SHOWN + 10 };
    let list = await topMovers(game, undefined, { ...opts, days });
    if (list.length === 0 && days === MOVER_DAYS) list = await topMovers(game, undefined, { ...opts, days: days - 1 });
    return rowsFor(game, list);
  };
  const [up, down] = await Promise.all([read("up"), read("down")]);
  return { up, down };
}

/** Never throws; empty lists when the price tables cannot be read. */
export async function gameMovers(game: GameId, days: MoverRange): Promise<GameMovers> {
  if (!hasMovers(game)) return { up: [], down: [] };
  try {
    const hit = await cachedList(`seo:movers:v1:${game}:${days}`, TTL_MS, () => build(game, days));
    return { up: hit.up ?? [], down: hit.down ?? [] };
  } catch (err) {
    console.warn(`movers page: could not read ${game} ${days}-day movers`, err);
    return { up: [], down: [] };
  }
}
