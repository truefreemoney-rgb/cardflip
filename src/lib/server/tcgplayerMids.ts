import "server-only";
import { db } from "@/lib/db";
import { tcgplayerVariantKey } from "@/lib/tcgcsv";
import { tcgcsvFetch } from "@/lib/server/tcgcsv";
import type { GameId } from "@/lib/types";

/** tcgcsv category per game (TCGplayer's own numbering). */
const CATEGORY: Partial<Record<GameId, number>> = { pokemon: 3, mtg: 1 };

/** One tcgcsv prices file per group per process: the sleepers pick reads mids several times a run (drafts, video, caption). */
const groupCache = new Map<string, Promise<{ productId: number; subTypeName?: string | null; midPrice?: number | null }[]>>();

/**
 * TCGplayer's mid listing price for each picked printing, keyed "cardId|variant" (lib/server/social.ts sleepers: a
 * market far over the mid listing was lifted by one sale). Reads the tcgcsv prices file of each card's group through
 * the house-rules fetch (tcgcsv.ts). Advisory: a card with no product row, a failed group read or no mid is simply
 * absent, and the caller keeps the card (11-05: the guard narrows a pick, it never empties a post on an outage).
 */
export async function tcgplayerMids(game: GameId, picks: { cardId: string; variant: string }[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const cat = CATEGORY[game];
  if (!cat || picks.length === 0) return out;
  try {
    const ids = [...new Set(picks.map((p) => p.cardId))];
    const rows = (await db
      .prepare(`SELECT card_id, product_id, group_id FROM tcgplayer_products WHERE game = ? AND card_id IN (${ids.map(() => "?").join(",")})`)
      .all(game, ...ids)) as unknown as { card_id: string; product_id: number; group_id: number }[];
    for (const r of rows) {
      const key = `${cat}/${r.group_id}`;
      if (!groupCache.has(key)) {
        groupCache.set(
          key,
          tcgcsvFetch(`https://tcgcsv.com/tcgplayer/${key}/prices`)
            .then(async (res) => (res.ok ? ((await res.json()) as { results?: [] }).results ?? [] : []))
            .catch(() => []),
        );
      }
      const prices = await groupCache.get(key)!;
      for (const p of prices) {
        if (p.productId !== Number(r.product_id) || !(Number(p.midPrice) > 0)) continue;
        const v = tcgplayerVariantKey(p.subTypeName);
        // Magic's catalog says nonfoil/foil where TCGplayer says Normal/Foil.
        const variant = game === "mtg" ? (v === "normal" ? "nonfoil" : v) : v;
        if (picks.some((x) => x.cardId === r.card_id && x.variant === variant)) out.set(`${r.card_id}|${variant}`, Number(p.midPrice));
      }
    }
  } catch (err) {
    console.warn("sleepers: TCGplayer mid read failed, the one-sale test is off this run:", err instanceof Error ? err.message : err);
  }
  return out;
}
