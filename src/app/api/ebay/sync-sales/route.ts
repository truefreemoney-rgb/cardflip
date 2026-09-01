import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { isDemoUser } from "@/lib/server/users";
import { syncEbaySales } from "@/lib/server/ebayOrders";
import { syncEndedEbayListings } from "@/lib/server/ebayListings";
import { syncEbayFees } from "@/lib/server/ebayFinances";

/**
 * Pull the seller's recent eBay orders and flip matching listed cards to
 * sold (lib/server/ebayOrders.ts), then stamp listings that ended without
 * selling (lib/server/ebayListings.ts) — sales first, so a sold-out listing
 * flips to sold rather than reading as "ended". Called fire-and-forget when
 * the ledger views load; throttled server-side so a busy tab can't hammer
 * eBay.
 */
export async function POST() {
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ sold: [], ended: [], skipped: "not_connected" });
    }
    const result = await syncEbaySales(user.id);
    const endedResult = await syncEndedEbayListings(user.id);
    // Fees last: fresh sold rows from this same pass get their actual fee
    // looked up right away when eBay already has the transaction.
    const feeResult = await syncEbayFees(user.id);
    return NextResponse.json({ ...result, ended: endedResult.ended, feesUpdated: feeResult.updated });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
