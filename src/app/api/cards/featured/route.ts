import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { magicVisibleFor } from "@/lib/server/settings";
import { getStageCards } from "@/lib/server/stageCards";

/**
 * The cards on the empty scanner's stage: ten real, priced catalog cards
 * (Chris, 09-04: "the cards need to rotate, pick like 10"). Magic rows only
 * for viewers who can see Magic. Served from lib/server/stageCards.ts —
 * mirror-first, cached six hours — after the pokemontcg.io version measured
 * 12s cold on prod (09-06).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const magic = await magicVisibleFor(user);
  const { cards, cached } = await getStageCards(magic);
  return NextResponse.json({ cards, cached });
}
