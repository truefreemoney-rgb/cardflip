import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { inventoryValueSeries, MAX_VALUE_DAYS } from "@/lib/server/inventoryValue";
import type { GameId } from "@/lib/types";

/** The seller's inventory value, one point per day (Inventory panel graph). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = req.nextUrl.searchParams;
    const game: GameId = params.get("game") === "mtg" ? "mtg" : "pokemon";
    const days = Math.min(MAX_VALUE_DAYS, Math.max(2, Number(params.get("days")) || 90));
    return NextResponse.json({ game, days, points: await inventoryValueSeries(user.id, game, days) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("inventory value history failed:", err);
    return NextResponse.json({ error: "Couldn't load inventory value history" }, { status: 500 });
  }
}
