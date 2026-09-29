import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { collectionInsights } from "@/lib/server/insights";
import type { GameId } from "@/lib/types";
import { parseGame } from "@/lib/games";

/** Collection insights (Tier 3 #17): movers, top 10, value by set, the listed/sitting split. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const game: GameId = parseGame(req.nextUrl.searchParams.get("game"));
    return NextResponse.json(await collectionInsights(user.id, game));
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("collection insights failed:", err);
    return NextResponse.json({ error: "Couldn't load collection insights" }, { status: 500 });
  }
}
