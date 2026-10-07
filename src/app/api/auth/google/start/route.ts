import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_MAX_AGE_S,
  encodeState,
  safeNext,
  type GoogleMode,
} from "@/lib/googleAuth";
import { googleConfigured, googleOrigin, googleRedirectUri } from "@/lib/server/googleAuth";
import { parseTouch } from "@/lib/attribution";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";

/**
 * "Continue with Google", step 1: remember who is asking (random state + nonce, the page they
 * came from, the invite code and first-touch attribution the normal signup would send) in a
 * short-lived httpOnly cookie, then send the browser to Google.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode: GoogleMode = url.searchParams.get("mode") === "signup" ? "signup" : "login";
  const back = `${googleOrigin(req)}/${mode === "signup" ? "signup" : "login"}`;
  if (!googleConfigured()) return NextResponse.redirect(`${back}?google_error=1`, 302);
  const limited = await limitOrRespondAsync(`auth:google:start:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return NextResponse.redirect(`${back}?google_error=1`, 302);

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
    n: randomBytes(24).toString("base64url"),
    mode,
    next: safeNext(url.searchParams.get("next")),
    ref: refRaw && /^[A-Za-z0-9]{4,16}$/.test(refRaw) ? refRaw.toUpperCase() : null,
    touch,
    fromScan: url.searchParams.get("from") === "scan",
  };

  const auth = new URL(GOOGLE_AUTH_URL);
  auth.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  auth.searchParams.set("redirect_uri", googleRedirectUri(req));
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", state.s);
  auth.searchParams.set("nonce", state.n);
  auth.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(auth.toString(), 302);
  res.cookies.set(GOOGLE_STATE_COOKIE, encodeState(state), {
    httpOnly: true,
    sameSite: "lax", // the return from Google is a top-level GET, which Lax allows
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: GOOGLE_STATE_MAX_AGE_S,
  });
  return res;
}
