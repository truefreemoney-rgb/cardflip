import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  GOOGLE_STATE_COOKIE,
  decodeJwtPayload,
  decodeState,
  stateMatches,
  validateClaims,
} from "@/lib/googleAuth";
import { exchangeGoogleCode, googleConfigured, googleOrigin, googleRedirectUri } from "@/lib/server/googleAuth";
import { completeGoogleSignIn } from "@/lib/server/googleSignIn";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";

/**
 * "Continue with Google", step 2. Checks the state cookie, trades the code for an id_token,
 * validates its claims (lib/googleAuth.ts), then logs in / links / creates the account
 * (lib/server/googleSignIn.ts, shared with One Tap).
 * Every failure lands back on the page they started from with ?google_error=N (the page
 * shows the plain-words message): 1 = didn't finish, 2 = that account has extra security.
 */
export async function GET(req: Request) {
  const origin = googleOrigin(req);
  const url = new URL(req.url);
  const jar = await cookies();
  const st = decodeState(jar.get(GOOGLE_STATE_COOKIE)?.value);
  const page = st?.mode === "signup" ? "/signup" : "/login";

  const fail = (code: 1 | 2 = 1) => {
    const res = NextResponse.redirect(`${origin}${page}?google_error=${code}`, 302);
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  };

  try {
    if (!googleConfigured()) return fail();
    const limited = await limitOrRespondAsync(`auth:google:${clientIp(req)}`, LIMITS.authAttempt);
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

    const result = await completeGoogleSignIn(req, claims, st);
    if (!result.ok) return fail(result.code);
    const res = NextResponse.redirect(`${origin}${result.dest}`, 302);
    result.apply(res);
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("google sign-in failed:", err instanceof Error ? err.message : err);
    return fail();
  }
}
