import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { missingInSet, setCompletion } from "@/lib/server/setCompletion";
import { parseGame } from "@/lib/games";

/**
 * Set completion (09-27, every game 10-06):
 *   GET /api/cards/sets?game=mtg            → every set the seller owns a card from, with the cheapest ten to finish
 *   GET /api/cards/sets?game=mtg&set=<key>  → the full missing list for one set
 * `game` defaults to pokemon; an unknown value is pokemon too (parseGame).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const game = parseGame(req.nextUrl.searchParams.get("game"));
    const setId = req.nextUrl.searchParams.get("set");
    if (setId) return NextResponse.json({ missing: await missingInSet(user.id, setId.slice(0, 160), game) });
    return NextResponse.json({ sets: await setCompletion(user.id, game) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
