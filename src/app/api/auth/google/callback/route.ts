import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  GOOGLE_STATE_COOKIE,
  decodeJwtPayload,
  decodeState,
  stateMatches,
  validateClaims,
} from "@/lib/googleAuth";
import { exchangeGoogleCode, googleConfigured, googleOrigin, googleRedirectUri, sealAppTicket } from "@/lib/server/googleAuth";
import { completeGoogleSignIn } from "@/lib/server/googleSignIn";
import { ipGate } from "@/lib/server/rateLimitDb";

/**
 * "Continue with Google", step 2. Checks the state cookie, trades the code for an id_token,
 * validates its claims (lib/googleAuth.ts), then logs in / links / creates the account
 * (lib/server/googleSignIn.ts, shared with One Tap).
 * Every failure lands back on the page they started from with ?google_error=N (the page
 * shows the plain-words message): 1 = didn't finish, 2 = that account has extra security.
 *
 * The iPhone app (state.app, 10-29): the browser sheet is sent back to the app's own address
 * instead, with ?ticket=… (a sealed one-time ticket the app trades for its session at
 * /api/auth/google/finish with the PKCE verifier it kept) or ?google_error=N. No website
 * cookies are set on the sheet: the app never uses them, and the sheet is closed at once.
 */
export async function GET(req: Request) {
  const origin = googleOrigin(req);
  const url = new URL(req.url);
  const jar = await cookies();
  const st = decodeState(jar.get(GOOGLE_STATE_COOKIE)?.value);
  const page = st?.mode === "signup" ? "/signup" : "/login";
  const app = st?.app;

  const fail = (code: 1 | 2 = 1) => {
    const res = NextResponse.redirect(app ? `${app.back}?google_error=${code}` : `${origin}${page}?google_error=${code}`, 302);
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  };

  try {
    if (!googleConfigured()) return fail();
    const limited = await ipGate(req, "auth:google");
    if (limited) return fail();
    // Denied consent, or anything Google itself refused.
    if (url.searchParams.get("error")) return fail();
    const code = url.searchParams.get("code");
    if (!st || !code || !stateMatches(st, url.searchParams.get("state"))) return fail();

    const idToken = await exchangeGoogleCode(code, googleRedirectUri(req));
    if (!idToken) return fail();
    const claims = validateClaims(decodeJwtPayload(idToken), { clientId: process.env.GOOGLE_CLIENT_ID ?? "", nonce: st.n });
    if (!claims.ok) {
      console.warn("google sign-in: claims refused:", claims.reason);
      return fail();
    }

    // The app's install id travels in the state (the browser sheet sends no x-cardflip-device header), so the
    // sign-up guards and the free first scan see the same device the app's own requests name.
    let signInReq = req;
    if (app?.device) {
      const h = new Headers(req.headers);
      h.set("x-cardflip-device", app.device);
      signInReq = new Request(req.url, { headers: h });
    }
    const result = await completeGoogleSignIn(signInReq, claims, st);
    if (!result.ok) return fail(result.code);
    if (app) {
      const to = new URL(app.back);
      to.searchParams.set("ticket", sealAppTicket(result.session, app.pkce));
      to.searchParams.set("new", result.isNew ? "1" : "0");
      const res = NextResponse.redirect(to.toString(), 302);
      res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
      return res;
    }
    const res = NextResponse.redirect(`${origin}${result.dest}`, 302);
    result.apply(res);
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("google sign-in failed:", err instanceof Error ? err.message : err);
    return fail();
  }
}
