import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { isDemoUser, setAutoOffer } from "@/lib/server/users";
import { db } from "@/lib/db";
import { getCardForUser } from "@/lib/server/cards";
import { findEligibleListingIds, sendWatcherOffer } from "@/lib/server/ebayNegotiation";

/**
 * Offers to watchers. GET answers which of the seller's listed cards eBay
 * considers offer-eligible right now (has interested buyers to message) plus
 * the seller's auto-offer setting; POST sends ONE offer for ONE card the
 * seller explicitly picked (optionally with their message); PATCH stores the
 * auto-offer opt-in that the daily sweep acts on (percent = on, null = off).
 * Chris approved the auto-fire design 09-02: opt-in only, 14-day slow movers,
 * 10/day cap per seller.
 */

const OFFER_MESSAGE_MAX = 2000;

function cleanMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, OFFER_MESSAGE_MAX);
  return text || null;
}

export async function GET() {
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ eligibleCardIds: [], autoOfferPercent: null, autoOfferMessage: null });
    }
    const auto = {
      autoOfferPercent: user.autoOfferPercent,
      autoOfferMessage: user.autoOfferMessage,
    };

    const listed = (await db
      .prepare(
        `SELECT id, ebay_listing_id FROM cards
         WHERE user_id = ? AND status = 'listed' AND ebay_listing_id IS NOT NULL`,
      )
      .all(user.id)) as { id: string; ebay_listing_id: string }[];
    if (listed.length === 0) return NextResponse.json({ eligibleCardIds: [], ...auto });

    const result = await findEligibleListingIds(user.id);
    if (result.skipped) {
      return NextResponse.json({ eligibleCardIds: [], skipped: result.skipped, ...auto });
    }
    const eligible = new Set(result.listingIds);
    const eligibleCardIds = listed.filter((c) => eligible.has(c.ebay_listing_id)).map((c) => c.id);
    return NextResponse.json({ eligibleCardIds, ...auto });
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

    const result = await sendWatcherOffer(user.id, card, discountPercent, cleanMessage(body?.message) ?? undefined);
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

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ error: "The demo account can't change offer settings." }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Missing settings" }, { status: 400 });
    }

    // null percent = auto-offers off (and the message is cleared with it).
    let percent: number | null = null;
    if (body.autoOfferPercent !== null && body.autoOfferPercent !== undefined) {
      percent = Math.round(Number(body.autoOfferPercent));
      if (!Number.isFinite(percent) || percent < 5 || percent > 50) {
        return NextResponse.json({ error: "Discount must be between 5% and 50%." }, { status: 400 });
      }
    }
    const message = percent === null ? null : cleanMessage(body.autoOfferMessage);

    await setAutoOffer(user.id, percent, message);
    return NextResponse.json({ ok: true, autoOfferPercent: percent, autoOfferMessage: message });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
