import { NextRequest, NextResponse } from "next/server";
import { belowFloor, belowFloorFor, floorRefusal, floorRefusalFor } from "@/lib/fees";
import { toLocal } from "@/lib/localPricing";
import { isLocalMarketplace, marketplaceByEbayId, marketplaceLabel } from "@/lib/marketplaces";
import { requireUser, AuthError } from "@/lib/server/auth";
import { getCardForUser, updateCard } from "@/lib/server/cards";
import { EbayUnreachableError } from "@/lib/server/ebayAuth";
import { ledgerFloorProblem, sellerAccountType } from "@/lib/server/ebayMarket";
import { EbayNotConnectedError, EbaySellError, updateOfferPrice } from "@/lib/server/ebaySell";
import { FxUnavailableError, listingFxRate } from "@/lib/server/fx";

/**
 * One-click reprice from the collection's nudge: writes the new price on the
 * ledger row, then onto the card's eBay offer (live listings change in
 * place). The ledger write always sticks; an eBay failure is reported so the
 * seller knows the live listing still shows the old price.
 *
 * `price` is always the USD ledger figure. A card whose offer lives on another
 * eBay site (stored on the card, never the seller's current home) is sent to
 * that site converted at today's rate, checked against THAT site's floor, and
 * refused when no fresh rate is on hand (nothing changes in that case).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => null)) as { cardId?: unknown; price?: unknown } | null;
    const cardId = typeof body?.cardId === "string" ? body.cardId : null;
    const price =
      typeof body?.price === "number" && Number.isFinite(body.price) && body.price > 0
        ? Math.round(body.price * 100) / 100
        : null;
    if (!cardId || price == null) {
      return NextResponse.json({ error: "cardId and a positive price are required" }, { status: 400 });
    }

    const existing = await getCardForUser(cardId, user.id);
    if (!existing) return NextResponse.json({ error: "Card not found" }, { status: 404 });
    const mp = existing.ebayOfferId ? marketplaceByEbayId(existing.ebayMarketplace) : null;

    let localPrice: number | null = null;
    if (mp && isLocalMarketplace(mp)) {
      const account = await sellerAccountType(user.id);
      let rate: number;
      try {
        rate = (await listingFxRate(mp.currency, marketplaceLabel(mp))).rate;
      } catch (err) {
        if (err instanceof FxUnavailableError) return NextResponse.json({ error: err.message }, { status: 409 });
        throw err;
      }
      localPrice = toLocal(price, rate);
      if (belowFloorFor(mp, localPrice, account)) {
        return NextResponse.json({ error: floorRefusalFor(mp, account) }, { status: 400 });
      }
    } else {
      // A US offer keeps the US floor exactly; a card with no offer follows the seller's current site.
      const problem = existing.ebayOfferId ? (belowFloor(price) ? floorRefusal() : null) : await ledgerFloorProblem(user.id, price);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const card = await updateCard(cardId, user.id, { price, priceLocked: true });
    if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

    let ebayUpdated = false;
    let ebayError: string | null = null;
    if (card.ebayOfferId) {
      try {
        await updateOfferPrice(user.id, cardId, localPrice ?? price, localPrice != null ? { priceUsd: price } : {});
        ebayUpdated = true;
      } catch (err) {
        ebayError =
          err instanceof EbaySellError
            ? err.sellerMessage
            : err instanceof EbayNotConnectedError
              ? "Connect your eBay account first"
              : err instanceof EbayUnreachableError
                ? err.message
                : "eBay didn't take the new price";
        console.error("reprice: eBay offer update failed:", err);
      }
    }
    return NextResponse.json({ card: localPrice != null ? ((await getCardForUser(cardId, user.id)) ?? card) : card, ebayUpdated, ebayError });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
