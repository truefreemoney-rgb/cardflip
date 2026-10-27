import { NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { setManualCall } from "@/lib/server/ebayReferee";
import { revalidatePath } from "next/cache";
import { dropCardLists, loadCardRecord } from "@/lib/server/cardPages";
import { cardPath, setPath } from "@/lib/cardPages";
import type { GameId } from "@/lib/types";
import { adminAuthResponse } from "@/lib/server/adminGate";

/**
 * /api/admin/prices: owner only. POST `{ game, cardId, variant, call }` records an
 * eBay sold check on /admin/prices: "hide" (the price is wrong), "keep" (it is
 * right, even if the nightly eBay rule hid it) or "clear" (back to the rule).
 */
export const dynamic = "force-dynamic";

const GAMES: ReadonlySet<string> = new Set(["pokemon", "mtg", "lorcana", "onepiece", "yugioh"]);
const CALLS: ReadonlySet<string> = new Set(["hide", "keep", "clear"]);

export async function POST(req: Request) {
  try {
    await requireAdminOwner();
    const body = (await req.json().catch(() => null)) as { game?: string; cardId?: string; variant?: string; call?: string; price?: number; label?: string } | null;
    const { game, cardId, variant, call, price, label } = body ?? {};
    if (!game || !GAMES.has(game) || !cardId || typeof variant !== "string" || !call || !CALLS.has(call)) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    // price + label: a card the referee never read (see setManualCall) gets a row for the call.
    const fresh = typeof price === "number" && Number.isFinite(price) && price > 0 ? { price, label: typeof label === "string" ? label : cardId } : undefined;
    const changed = await setManualCall(game as GameId, cardId.slice(0, 120), variant.slice(0, 40), call as "hide" | "keep" | "clear", undefined, fresh);
    // The cached strips that print this card (its set's top, its other printings, the game's top) are dropped so the
    // next page build shows the call, not the day-old number (10-14).
    if (changed) {
      await dropCardLists(game as GameId, cardId.slice(0, 120));
      // The card page itself is cached for two days: a keep must show the real price now, not after the cache (10-22,
      // 57 referee hides were cheaper-printing matches and the pages kept printing the $5 ask). Its set page too (10-26).
      // Best effort, as post-check.
      try {
        const rec = await loadCardRecord(game as GameId, cardId.slice(0, 120));
        if (rec) {
          revalidatePath(cardPath(game as GameId, rec.facts.setSlug, rec.facts.name, rec.facts.key));
          revalidatePath(setPath(game as GameId, rec.facts.setSlug));
        }
      } catch (err) {
        console.warn(`admin prices: could not rebuild the page of ${game} ${cardId}`, err);
      }
    }
    return changed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "No such row" }, { status: 404 });
  } catch (err) {
    if (err instanceof AuthError) return adminAuthResponse(err);
    console.error("admin prices call failed:", err);
    return NextResponse.json({ error: "Couldn't save the call" }, { status: 500 });
  }
}
