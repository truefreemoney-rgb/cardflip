import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { inventoryValueSeries, MAX_VALUE_DAYS, type ValueScope } from "@/lib/server/inventoryValue";
import type { GameId } from "@/lib/types";
import { parseGame } from "@/lib/games";

/** The seller's inventory value, one point per day (Inventory panel graph). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = req.nextUrl.searchParams;
    const game: GameId = parseGame(params.get("game"));
    const days = Math.min(MAX_VALUE_DAYS, Math.max(2, Number(params.get("days")) || 90));
    // The page's tab and category: ?status=ready|listed|ended|sold|sealed, ?category=<name> or ?uncategorized=1.
    const status = params.get("status");
    const category = params.get("uncategorized") === "1" ? null : params.get("category")?.slice(0, 40) || undefined;
    const scope: ValueScope = {
      category,
      status: status === "ready" || status === "listed" || status === "ended" || status === "sold" || status === "sealed" ? status : undefined,
    };
    return NextResponse.json({ game, days, points: await inventoryValueSeries(user.id, game, days, Date.now(), scope) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("inventory value history failed:", err);
    return NextResponse.json({ error: "Couldn't load inventory value history" }, { status: 500 });
  }
}
