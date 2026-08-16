import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { isDemoUser } from "@/lib/server/users";
import { getEbayLink, isEbayOAuthConfigured } from "@/lib/server/ebayAuth";

/**
 * What the connect UI needs to render honestly: whether the server can start
 * an eBay sign-in at all, and whether this user has one. Configuration lives
 * in server secrets, so the client has to ask.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const link = getEbayLink(user.id);
    return NextResponse.json({
      available: isEbayOAuthConfigured(),
      demo: isDemoUser(user),
      connected: Boolean(link),
      ebayUsername: link?.ebayUsername ?? null,
      connectedAt: link?.connectedAt ?? null,
      refreshExpiresAt: link?.refreshExpiresAt ?? null,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
