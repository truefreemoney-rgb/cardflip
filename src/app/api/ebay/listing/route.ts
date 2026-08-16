import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { isDemoUser } from "@/lib/server/users";
import { pushDraft } from "@/lib/server/ebaySell";
import { sellErrorResponse } from "@/lib/server/ebaySellRoute";
import { draftInputFromBody } from "@/lib/server/ebayDraftBody";

/**
 * Push a listing draft into the seller's eBay account (inventory item +
 * unpublished offer). Body is the DraftInput the editor already has; the
 * server re-validates it and owns the eBay ids that come back.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json(
        { error: "demo", message: "The demo account can't post to eBay — sign up to connect your own" },
        { status: 403 },
      );
    }
    const input = draftInputFromBody(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ error: "invalid", message: "Malformed draft" }, { status: 400 });
    }
    const result = await pushDraft(user.id, input);
    return NextResponse.json({
      offerId: result.offerId,
      sku: result.sku,
      updated: result.updated,
      attached: result.attached,
      degraded: result.degraded,
      pushedAt: result.card.ebayPushedAt,
      listingId: result.card.ebayListingId,
      listingUrl: result.card.ebayListingUrl,
    });
  } catch (err) {
    return sellErrorResponse(err);
  }
}
