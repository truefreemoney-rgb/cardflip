import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { disconnectEbay } from "@/lib/server/ebayAuth";

/** Unlink the seller's eBay account — deletes our stored tokens. */
export async function POST() {
  try {
    const user = await requireUser();
    disconnectEbay(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
