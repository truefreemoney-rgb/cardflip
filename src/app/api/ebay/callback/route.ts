import { getCurrentUser } from "@/lib/server/auth";
import { isDemoUser } from "@/lib/server/users";
import {
  completeEbayConnect,
  isEbayOAuthConfigured,
  verifyOAuthState,
} from "@/lib/server/ebayAuth";
import { EBAY_STATE_COOKIE, localRedirect } from "@/lib/server/ebayFlow";

/**
 * Where eBay sends the seller back after the consent screen. This URL is the
 * "auth accepted" AND "auth declined" URL registered against the RuName in
 * the developer portal, so it has to handle both: a decline arrives with no
 * `code`. Failures land on /connect-ebay with a status the page can explain.
 * Success goes straight to the scanner (`/app?ebay=connected`) — the seller
 * came from there to connect, and the point of connecting is to list, so
 * the app confirms it with a banner instead of parking them on a status page.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const finish = (path: string) => {
    const res = localRedirect(path);
    res.cookies.delete(EBAY_STATE_COOKIE);
    return res;
  };
  const back = (status: string) => finish(`/connect-ebay?${status}`);

  const user = await getCurrentUser();
  if (!user) return localRedirect(`/login`);
  if (!isEbayOAuthConfigured()) return back("error=unavailable");
  if (isDemoUser(user)) return back("error=demo");

  // eBay signals a decline by redirecting without a code (an `error` param
  // may or may not accompany it).
  if (!code) return back("error=declined");

  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookieState = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${EBAY_STATE_COOKIE}=`))
    ?.slice(EBAY_STATE_COOKIE.length + 1);

  // Both halves must agree: the state eBay echoed back, and the one this
  // browser was issued — and it must have been minted for this very user.
  if (
    !state ||
    !cookieState ||
    state !== decodeURIComponent(cookieState) ||
    !verifyOAuthState(state, user.id)
  ) {
    return back("error=state");
  }

  try {
    await completeEbayConnect(user.id, code);
    return finish("/app?ebay=connected");
  } catch (err) {
    console.error("eBay connect failed:", err);
    return back("error=exchange");
  }
}
