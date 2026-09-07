import { NextResponse } from "next/server";
import { magicPublic } from "@/lib/server/settings";
import { getStageCards } from "@/lib/server/stageCards";

/**
 * The cards on the empty scanner's stage: ten real, priced catalog cards
 * (Chris, 09-04: "the cards need to rotate, pick like 10"). Magic rows only
 * once Magic is switched on for everyone (admin → Switches) — the stage is
 * the public demo reel, so admins see the same Pokémon-only reel until then
 * (Chris, 09-06: "this should only show Pokémon cards"). Served from
 * lib/server/stageCards.ts —
 * mirror-first, cached six hours — after the pokemontcg.io version measured
 * 12s cold on prod (09-06).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { cards, cached } = await getStageCards(await magicPublic());
  return NextResponse.json({ cards, cached });
}
