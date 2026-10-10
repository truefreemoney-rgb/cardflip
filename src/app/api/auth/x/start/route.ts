import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  X_AUTH_URL,
  X_SCOPE,
  X_STATE_COOKIE,
  X_STATE_MAX_AGE_S,
  encodeXState,
  pkceChallenge,
  type XMode,
} from "@/lib/xAuth";
import { safeNext } from "@/lib/googleAuth";
import { xConfigured, xOrigin, xRedirectUri } from "@/lib/server/xAuth";
import { parseTouch } from "@/lib/attribution";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";

/**
 * "Continue with X", step 1: remember who is asking (random state, the PKCE verifier, the page they
 * came from, the invite code and first-touch attribution the normal signup would send) in a
 * short-lived httpOnly cookie, then send the browser to X.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode: XMode = url.searchParams.get("mode") === "signup" ? "signup" : "login";
  const back = `${xOrigin(req)}/${mode === "signup" ? "signup" : "login"}`;
  if (!xConfigured()) return NextResponse.redirect(`${back}?x_error=1`, 302);
  const limited = await limitOrRespondAsync(`auth:x:start:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return NextResponse.redirect(`${back}?x_error=1`, 302);

  let touch = null;
  try {
    const raw = url.searchParams.get("touch");
    touch = raw && raw.length < 600 ? parseTouch(JSON.parse(raw)) : null;
  } catch {
    touch = null;
  }
  const refRaw = url.searchParams.get("ref");
  const state = {
    s: randomBytes(24).toString("base64url"),
    v: randomBytes(48).toString("base64url"),
    mode,
    next: safeNext(url.searchParams.get("next")),
    ref: refRaw && /^[A-Za-z0-9]{4,16}$/.test(refRaw) ? refRaw.toUpperCase() : null,
    touch,
    fromScan: url.searchParams.get("from") === "scan",
  };

  const auth = new URL(X_AUTH_URL);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", process.env.X_CLIENT_ID ?? "");
  auth.searchParams.set("redirect_uri", xRedirectUri(req));
  auth.searchParams.set("scope", X_SCOPE);
  auth.searchParams.set("state", state.s);
  auth.searchParams.set("code_challenge", pkceChallenge(state.v));
  auth.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(auth.toString(), 302);
  res.cookies.set(X_STATE_COOKIE, encodeXState(state), {
    httpOnly: true,
    sameSite: "lax", // the return from X is a top-level GET, which Lax allows
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/x",
    maxAge: X_STATE_MAX_AGE_S,
  });
  return res;
}
