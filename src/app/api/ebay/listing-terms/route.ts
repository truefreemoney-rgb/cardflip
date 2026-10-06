import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { setListingTerms } from "@/lib/server/users";
import { DEFAULT_OFFER_ACCEPT_PERCENT, DEFAULT_OFFER_DECLINE_PERCENT } from "@/lib/ebayInventory";

/**
 * The seller's opt-in listing terms (Account > Selling): Best Offer with
 * auto-accept / auto-decline floors, and tracked postage over a price. Both off
 * by default. They apply to listings CardFlip sends or reprices from then on;
 * a live listing picks them up on its next price change or re-send.
 * `valueShippingLive` tells the page whether the owner has switched tracked
 * postage on server-side (EBAY_VALUE_SHIPPING=1); until then it is hidden.
 */

function terms(user: Awaited<ReturnType<typeof requireUser>>) {
  return {
    acceptOffers: user.acceptOffers,
    offerAcceptPercent: user.offerAcceptPercent ?? DEFAULT_OFFER_ACCEPT_PERCENT,
    offerDeclinePercent: user.offerDeclinePercent ?? DEFAULT_OFFER_DECLINE_PERCENT,
    trackedShipOver: user.trackedShipOver,
    trackedShipCost: user.trackedShipCost,
    valueShippingLive: process.env.EBAY_VALUE_SHIPPING === "1",
  };
}

export async function GET() {
  try {
    return NextResponse.json(terms(await requireUser()));
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Missing settings" }, { status: 400 });

    const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
    const acceptOffers = body.acceptOffers === true;
    let accept = user.offerAcceptPercent ?? DEFAULT_OFFER_ACCEPT_PERCENT;
    let decline = user.offerDeclinePercent ?? DEFAULT_OFFER_DECLINE_PERCENT;
    if (body.offerAcceptPercent != null) accept = Math.round(Number(body.offerAcceptPercent));
    if (body.offerDeclinePercent != null) decline = Math.round(Number(body.offerDeclinePercent));
    if (acceptOffers) {
      if (!Number.isFinite(accept) || accept < 50 || accept > 99) return bad("Auto-accept must be between 50% and 99% of your price.");
      if (!Number.isFinite(decline) || decline < 10 || decline > 98) return bad("Auto-decline must be between 10% and 98% of your price.");
      if (decline >= accept) return bad("Auto-decline has to be lower than auto-accept.");
    }

    let over: number | null = null;
    let cost: number | null = null;
    if (body.trackedShipOver != null) {
      over = Math.round(Number(body.trackedShipOver) * 100) / 100;
      cost = Math.round(Number(body.trackedShipCost) * 100) / 100;
      if (!Number.isFinite(over) || over < 5 || over > 5000) return bad("Tracked shipping threshold must be between $5 and $5,000.");
      if (!Number.isFinite(cost) || cost < 0.5 || cost > 100) return bad("Tracked shipping price must be between $0.50 and $100.");
    }

    await setListingTerms(user.id, {
      acceptOffers,
      offerAcceptPercent: accept,
      offerDeclinePercent: decline,
      trackedShipOver: over,
      trackedShipCost: cost,
    });
    return NextResponse.json({
      acceptOffers,
      offerAcceptPercent: accept,
      offerDeclinePercent: decline,
      trackedShipOver: over,
      trackedShipCost: cost,
      valueShippingLive: process.env.EBAY_VALUE_SHIPPING === "1",
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
