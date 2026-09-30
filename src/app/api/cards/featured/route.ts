import { NextResponse, type NextRequest } from "next/server";
import { magicPublic } from "@/lib/server/settings";
import { getGameStageCards, getStageCards } from "@/lib/server/stageCards";
import { isGameId } from "@/lib/games";

/**
 * The cards on the empty scanner's stage: ten real, priced catalog cards
 * (Chris, 09-04: "the cards need to rotate, pick like 10"). Magic rows only
 * once Magic is switched on for everyone (admin → Switches) — the stage is
 * the public demo reel, so admins see the same Pokémon-only reel until then
 * (Chris, 09-06: "this should only show Pokémon cards"). Served from
 * lib/server/stageCards.ts —
 * mirror-first, cached six hours — after the pokemontcg.io version measured
 * 12s cold on prod (09-06).
 *
 * ?game=lorcana|onepiece|yugioh|mtg (09-30): that game's own stage — the
 * card in the middle follows the game switch, about $50.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const game = req.nextUrl.searchParams.get("game");
  if (game && game !== "pokemon" && isGameId(game)) {
    const { cards, cached } = await getGameStageCards(game);
    return NextResponse.json({ cards, cached });
  }
  const { cards, cached } = await getStageCards(await magicPublic());
  return NextResponse.json({ cards, cached });
}
