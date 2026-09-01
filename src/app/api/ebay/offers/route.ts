import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { isDemoUser } from "@/lib/server/users";
import { db } from "@/lib/db";
import { getCardForUser } from "@/lib/server/cards";
import { findEligibleListingIds, sendWatcherOffer } from "@/lib/server/ebayNegotiation";

/**
 * Offers to watchers. GET answers which of the seller's listed cards eBay
 * considers offer-eligible right now (has interested buyers to message);
 * POST sends ONE offer for ONE card the seller explicitly picked — there is
 * deliberately no bulk fire-and-forget here, every send is a click.
 */

export async function GET() {
  try {
    const user = await requireUser();
    if (isDemoUser(user)) return NextResponse.json({ eligibleCardIds: [] });

    const listed = (await db
      .prepare(
        `SELECT id, ebay_listing_id FROM cards
         WHERE user_id = ? AND status = 'listed' AND ebay_listing_id IS NOT NULL`,
      )
      .all(user.id)) as { id: string; ebay_listing_id: string }[];
    if (listed.length === 0) return NextResponse.json({ eligibleCardIds: [] });

    const result = await findEligibleListingIds(user.id);
    if (result.skipped) {
      return NextResponse.json({ eligibleCardIds: [], skipped: result.skipped });
    }
    const eligible = new Set(result.listingIds);
    const eligibleCardIds = listed.filter((c) => eligible.has(c.ebay_listing_id)).map((c) => c.id);
    return NextResponse.json({ eligibleCardIds });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ error: "The demo account can't send offers." }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    const cardId = typeof body?.cardId === "string" ? body.cardId : null;
    const discountPercent = Number(body?.discountPercent);
    if (!cardId || !Number.isFinite(discountPercent)) {
      return NextResponse.json({ error: "Missing cardId or discountPercent" }, { status: 400 });
    }

    const card = await getCardForUser(cardId, user.id);
    if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
    if (card.status !== "listed" || !card.ebayListingId) {
      return NextResponse.json({ error: "That card isn't live on eBay." }, { status: 400 });
    }

    const result = await sendWatcherOffer(user.id, card, discountPercent);
    if (!result.ok) {
      return NextResponse.json({ error: result.message ?? "eBay declined the offer." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, watcherOfferAt: Date.now() });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
