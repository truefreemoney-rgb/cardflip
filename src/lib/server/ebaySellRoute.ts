import "server-only";
import { NextResponse } from "next/server";
import { AuthError } from "@/lib/server/auth";
import { EbayOAuthNotConfiguredError } from "@/lib/server/ebayAuth";
import {
  EbayDraftUnavailableError,
  EbayNotConnectedError,
  EbayPublishNeedsError,
  EbaySellError,
} from "@/lib/server/ebaySell";

/**
 * One error → HTTP mapping for both listing routes, so the client can rely on
 * the same `{ error, message }` shape whichever step failed:
 *
 *   401 auth        403 demo (set by the route)   404 card
 *   409 not_connected / not_pushed                503 unconfigured
 *   400 invalid draft                              502 ebay (with details)
 *   503 draft_unavailable (Listing API not enabled → client falls back)
 */
export function sellErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: "auth", message: err.message }, { status: 401 });
  }
  if (err instanceof EbayDraftUnavailableError) {
    return NextResponse.json({ error: "draft_unavailable", message: err.message }, { status: 503 });
  }
  if (err instanceof EbayOAuthNotConfiguredError) {
    return NextResponse.json(
      { error: "unconfigured", message: "eBay posting isn't live on this server yet" },
      { status: 503 },
    );
  }
  if (err instanceof EbayNotConnectedError) {
    return NextResponse.json({ error: "not_connected", message: err.message }, { status: 409 });
  }
  if (err instanceof EbayPublishNeedsError) {
    return NextResponse.json(
      { error: `needs_${err.needs}`, message: err.message },
      { status: 409 },
    );
  }
  if (err instanceof EbaySellError) {
    // Our own validation / state errors keep their status; anything eBay
    // itself said comes back as a 502 with eBay's wording attached.
    const ours = err.status === 400 || err.status === 404 || err.status === 409;
    return NextResponse.json(
      {
        error: ours ? "invalid" : "ebay",
        message: err.sellerMessage,
        details: err.errors.map((e) => e.longMessage || e.message).filter(Boolean),
      },
      { status: ours ? err.status : 502 },
    );
  }
  throw err;
}
