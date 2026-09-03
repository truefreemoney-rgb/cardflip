import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { isDemoUser } from "@/lib/server/users";
import { getCardForUser, setCardListingEnded } from "@/lib/server/cards";
import { withdrawOffer } from "@/lib/server/ebaySell";
import { sellErrorResponse } from "@/lib/server/ebaySellRoute";

/**
 * "Auction ended" from the ledger (Chris, 09-03): end the live eBay listing,
 * then stamp ebay_ended_at so the row reads Auction ended with Relist /
 * Delete. The eBay call goes first — if eBay refuses, the card stays Live
 * and the seller hears why, rather than the ledger lying about a listing
 * that's still up. Cards listed outside the API (CSV road, no listing id)
 * just get the stamp.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => null)) as { cardId?: unknown } | null;
    const cardId = typeof body?.cardId === "string" ? body.cardId : null;
    if (!cardId) return NextResponse.json({ error: "invalid", message: "cardId is required" }, { status: 400 });

    const card = await getCardForUser(cardId, user.id);
    if (!card) return NextResponse.json({ error: "invalid", message: "Card not found" }, { status: 404 });
    if (card.status !== "listed") {
      return NextResponse.json({ error: "invalid", message: "Only a live listing can be ended" }, { status: 409 });
    }
    if (card.ebayListingId && !card.ebayEndedAt && !isDemoUser(user)) {
      await withdrawOffer(user.id, cardId);
    }
    const updated = await setCardListingEnded(cardId, user.id, card.ebayEndedAt ?? Date.now());
    return NextResponse.json({ card: updated });
  } catch (err) {
    return sellErrorResponse(err);
  }
}
