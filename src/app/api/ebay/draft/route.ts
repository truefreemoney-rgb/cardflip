import { NextResponse } from "next/server";
import { requireUser, subscriptionGate } from "@/lib/server/auth";
import { createDraft } from "@/lib/server/ebaySell";
import { sellErrorResponse } from "@/lib/server/ebaySellRoute";
import { draftInputFromBody } from "@/lib/server/ebayDraftBody";

/**
 * "Send draft to eBay": create a Listing API item draft in the seller's
 * account — the one that shows in My eBay › Drafts and opens in eBay's
 * listing tool. Body is the DraftInput the editor already has.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const wall = subscriptionGate(user);
    if (wall) return wall;
    const input = draftInputFromBody(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ error: "invalid", message: "Malformed draft" }, { status: 400 });
    }
    const result = await createDraft(user.id, input);
    return NextResponse.json({
      draftId: result.draftId,
      draftUrl: result.draftUrl,
      draftAt: result.card.ebayDraftAt,
    });
  } catch (err) {
    return sellErrorResponse(err);
  }
}
