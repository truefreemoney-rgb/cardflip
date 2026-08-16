import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { isDemoUser } from "@/lib/server/users";
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
