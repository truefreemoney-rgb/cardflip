import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import {
  buildAuthorizeUrl,
  createOAuthState,
  isEbayOAuthConfigured,
} from "@/lib/server/ebayAuth";
import { EBAY_STATE_COOKIE, localRedirect } from "@/lib/server/ebayFlow";

/**
 * Start "Connect with eBay": mint a state nonce, pin it in a short-lived
 * cookie, and send the seller to eBay's consent page. The callback route
 * finishes the exchange. A plain GET so the button can be a normal link.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return localRedirect(`/login`);
  }

  if (!isEbayOAuthConfigured()) {
    return NextResponse.json(
      { error: "eBay sign-in isn't live on this server yet." },
      { status: 503 },
    );
  }

  const state = createOAuthState(user.id);
  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  res.cookies.set(EBAY_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
