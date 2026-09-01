import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { isDemoUser } from "@/lib/server/users";
import { updateCard } from "@/lib/server/cards";
import { EbayNotConnectedError, EbaySellError, updateOfferPrice } from "@/lib/server/ebaySell";

/**
 * One-click reprice from the collection's nudge: writes the new price on the
 * ledger row, then onto the card's eBay offer (live listings change in
 * place). The ledger write always sticks; an eBay failure is reported so the
 * seller knows the live listing still shows the old price.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ error: "The demo account can't touch eBay" }, { status: 403 });
    }
    const body = (await req.json().catch(() => null)) as { cardId?: unknown; price?: unknown } | null;
    const cardId = typeof body?.cardId === "string" ? body.cardId : null;
    const price =
      typeof body?.price === "number" && Number.isFinite(body.price) && body.price > 0
        ? Math.round(body.price * 100) / 100
        : null;
    if (!cardId || price == null) {
      return NextResponse.json({ error: "cardId and a positive price are required" }, { status: 400 });
    }

    const card = await updateCard(cardId, user.id, { price });
    if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

    let ebayUpdated = false;
    let ebayError: string | null = null;
    if (card.ebayOfferId) {
      try {
        await updateOfferPrice(user.id, cardId, price);
        ebayUpdated = true;
      } catch (err) {
        ebayError =
          err instanceof EbaySellError
            ? err.sellerMessage
            : err instanceof EbayNotConnectedError
              ? "Connect your eBay account first"
              : "eBay didn't take the new price";
        console.error("reprice: eBay offer update failed:", err);
      }
    }
    return NextResponse.json({ card, ebayUpdated, ebayError });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
