import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { isDemoUser } from "@/lib/server/users";
import { syncEbaySales } from "@/lib/server/ebayOrders";

/**
 * Pull the seller's recent eBay orders and flip matching listed cards to
 * sold (lib/server/ebayOrders.ts). Called fire-and-forget when the ledger
 * views load; throttled server-side so a busy tab can't hammer eBay.
 */
export async function POST() {
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ sold: [], skipped: "not_connected" });
    }
    const result = await syncEbaySales(user.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
