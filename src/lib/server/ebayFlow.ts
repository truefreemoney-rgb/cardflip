import "server-only";
import { NextResponse } from "next/server";

/** Carries the OAuth state nonce between /api/ebay/connect and /callback. */
export const EBAY_STATE_COOKIE = "cardflip_ebay_state";

/**
 * Redirect within the site. A relative Location keeps the flow on whichever
 * origin the seller is actually using (localhost in dev, fly.dev in prod)
 * instead of hard-coding the canonical host — NextResponse.redirect insists
 * on an absolute URL, hence the hand-built response.
 */
export function localRedirect(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}
