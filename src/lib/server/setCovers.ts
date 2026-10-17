import "server-only";
import { db } from "@/lib/db";
import { cachedStaleOk, SET_LIST_TTL_MS } from "@/lib/server/listCache";
import { toPics } from "@/lib/pics";
import type { GameId } from "@/lib/types";

/**
 * A picture for every set, every game (Chris 10-14: "can we get images for all the sets, all games?"). Only part of
 * the Pokémon sets have a TCGdex logo, Magic's Scryfall icons are small black symbols, and Lorcana / One Piece /
 * Yu-Gi-Oh! have none; every card has our own stored picture. So each set gets its most valuable card's tile
 * (cardflip.io/pics), its value and its card count, keyed the way /api/sets keys the set. One grouped read per game,
 * cached like the set list itself.
 */
export interface SetCover {
  coverUrl: string;
  /** The cover card's USD price (0 when the set has none priced). */
  coverValue: number;
  cards: number;
}

interface Row {
  k: string;
  tile: string;
  v: number | null;
  n: number;
}

async function build(game: GameId): Promise<Record<string, SetCover>> {
  let rows: Row[];
  if (game === "pokemon") {
    // SQLite's bare-column rule: with MAX(v), tile comes from the dearest row. Keyed by set name, as /api/sets.
    const priced = (await db
      .prepare(
        `SELECT c.set_name AS k, c.own_tile_url AS tile, MAX(json_extract(p.prices, '$[#-1]')) AS v
           FROM en_cards c JOIN price_series p ON p.card_id = c.id
          WHERE p.game = 'pokemon' AND p.source = 'tcgplayer' AND p.currency = 'USD' AND c.own_tile_url <> ''
          GROUP BY c.set_name`,
      )
      .all()) as unknown as Omit<Row, "n">[];
    const counts = (await db
      .prepare(`SELECT set_name AS k, MAX(own_tile_url) AS tile, COUNT(*) AS n FROM en_cards WHERE set_name <> '' GROUP BY set_name`)
      .all()) as unknown as Row[];
    const best = new Map(priced.map((r) => [r.k, r]));
    rows = counts.map((r) => ({ ...r, tile: best.get(r.k)?.tile || r.tile, v: best.get(r.k)?.v ?? null }));
  } else if (game === "mtg") {
    rows = (await db
      .prepare(
        `SELECT set_code AS k, own_tile_url AS tile, MAX(MAX(COALESCE(price_usd, 0), COALESCE(price_usd_foil, 0))) AS v, COUNT(*) AS n
           FROM mtg_cards WHERE lang = 'en' AND own_tile_url <> '' GROUP BY set_code`,
      )
      .all()) as unknown as Row[];
  } else {
    rows = (await db
      .prepare(
        `SELECT set_code || '|' || set_name AS k, own_tile_url AS tile, MAX(MAX(COALESCE(price_usd, 0), COALESCE(price_usd_foil, 0))) AS v, COUNT(*) AS n
           FROM tcg_cards WHERE game = ? AND own_tile_url <> '' GROUP BY set_code, set_name`,
      )
      .all(game)) as unknown as Row[];
  }
  const out: Record<string, SetCover> = {};
  // The stored Blob URL is cached; toPics runs on every read (its origin differs between dev and production).
  for (const r of rows) if (r.tile) out[r.k] = { coverUrl: r.tile, coverValue: Number(r.v) || 0, cards: Number(r.n) || 0 };
  return out;
}

export async function setCovers(game: GameId): Promise<Record<string, SetCover>> {
  // Stale-ok (10-17): the Pokemon build walks every price series (~21 s on Turso) and failed the 2am + 7am smoke on a
  // cold memo; the old covers serve while it rebuilds after the response.
  const cached = await cachedStaleOk(`sets:covers:v2:${game}`, SET_LIST_TTL_MS, () => build(game), Date.now(), { skipEmpty: true });
  const out: Record<string, SetCover> = {};
  for (const [k, c] of Object.entries(cached)) out[k] = { ...c, coverUrl: toPics(c.coverUrl) };
  return out;
}
