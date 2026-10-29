import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_MAX_AGE_S,
  appReturnAllowed,
  devReturnsAllowed,
  encodeState,
  safeNext,
  type GoogleAppState,
  type GoogleMode,
  type GoogleState,
} from "@/lib/googleAuth";
import { googleConfigured, googleOrigin, googleRedirectUri } from "@/lib/server/googleAuth";
import { parseTouch } from "@/lib/attribution";
import { ipGate } from "@/lib/server/rateLimitDb";

/**
 * "Continue with Google", step 1: remember who is asking (random state + nonce, the page they
 * came from, the invite code and first-touch attribution the normal signup would send) in a
 * short-lived httpOnly cookie, then send the browser to Google.
 *
 * The iPhone app (10-29) comes through the same door from its browser sheet with app=1, its PKCE
 * challenge, its own return address and install id (lib/googleAuth.ts GoogleAppState); the
 * callback then hands it a sealed ticket instead of the website's cookies. A malformed or
 * foreign return address ends the sign-in right here: a ticket is never sent anywhere else.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode: GoogleMode = url.searchParams.get("mode") === "signup" ? "signup" : "login";
  let app: GoogleAppState | undefined;
  if (url.searchParams.get("app") === "1") {
    const pkce = url.searchParams.get("pkce") ?? "";
    const back = url.searchParams.get("back");
    const device = url.searchParams.get("device");
    if (!appReturnAllowed(back, devReturnsAllowed())) return NextResponse.redirect(`${googleOrigin(req)}/login?google_error=1`, 302);
    if (!/^[A-Za-z0-9_-]{43}$/.test(pkce)) return NextResponse.redirect(`${back}?google_error=1`, 302);
    app = { pkce, back, device: device && /^[A-Za-z0-9-]{8,64}$/.test(device) ? device : null };
  }
  const back = app ? app.back : `${googleOrigin(req)}/${mode === "signup" ? "signup" : "login"}`;
  if (!googleConfigured()) return NextResponse.redirect(`${back}?google_error=1`, 302);
  const limited = await ipGate(req, "auth:google:start");
  if (limited) return NextResponse.redirect(`${back}?google_error=1`, 302);

  let touch = null;
  try {
    const raw = url.searchParams.get("touch");
    touch = raw && raw.length < 600 ? parseTouch(JSON.parse(raw)) : null;
  } catch {
    touch = null;
  }
  const refRaw = url.searchParams.get("ref");
  const state: GoogleState = {
    s: randomBytes(24).toString("base64url"),
    n: randomBytes(24).toString("base64url"),
    mode,
    next: safeNext(url.searchParams.get("next")),
    ref: refRaw && /^[A-Za-z0-9]{4,16}$/.test(refRaw) ? refRaw.toUpperCase() : null,
    touch,
    fromScan: url.searchParams.get("from") === "scan",
    ...(app ? { app } : {}),
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
