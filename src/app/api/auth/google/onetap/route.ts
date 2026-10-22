import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decodeJwtPayload, safeNext, validateClaims } from "@/lib/googleAuth";
import { googleConfigured, verifyGoogleIdToken } from "@/lib/server/googleAuth";
import { completeGoogleSignIn } from "@/lib/server/googleSignIn";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { parseTouch } from "@/lib/attribution";
import { ipGate } from "@/lib/server/rateLimitDb";

/**
 * Google One Tap (components/GoogleOneTap.tsx on the public pages). The browser gets an id_token
 * from Google's prompt and POSTs it here; there is no code, no state cookie and no redirect, so:
 *  - Google's tokeninfo endpoint checks the signature (verifyGoogleIdToken) and we check that the
 *    `sub` it vouches for is the one in the token we decode;
 *  - the claims go through the same validateClaims as the code flow (iss, aud = our client id,
 *    exp, email_verified, and the nonce the page handed Google when it opened the prompt);
 *  - then lib/server/googleSignIn.ts does exactly what the callback does (make / link / log in).
 * The nonce is minted HERE (10-22, review 10-19): GET hands the page a random one and keeps it in a 10-minute httpOnly cookie;
 * the POST compares the token's nonce to that cookie, then clears it. It used to come from the request body, so anyone who
 * could replay a token could replay its nonce too and the check protected nothing.
 * Answers { next } for the page to go to: a new account → the welcome step; an existing account
 * → the page it was on (`next`, same-site only), else /app. Refusals are plain JSON errors.
 */
const NONCE_COOKIE = "cf_onetap_nonce";
const NONCE_MAX_AGE_S = 10 * 60;

export async function GET(req: Request) {
  if (!googleConfigured()) return NextResponse.json({ error: "Google sign-in is off." }, { status: 503 });
  const limited = await ipGate(req, "auth:google:onetap-nonce");
  if (limited) return limited;
  const nonce = randomBytes(24).toString("hex");
  const res = NextResponse.json({ nonce }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google/onetap",
    maxAge: NONCE_MAX_AGE_S,
  });
  return res;
}

export async function POST(req: Request) {
  if (!googleConfigured()) return NextResponse.json({ error: "Google sign-in is off." }, { status: 503 });
  const limited = await ipGate(req, "auth:google:onetap");
  if (limited) return limited;
  // Already signed in: the prompt should never have shown; do nothing rather than switch accounts.
  const jar = await cookies();
  if (jar.get(SESSION_COOKIE)?.value) return NextResponse.json({ error: "Already signed in." }, { status: 409 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const credential = typeof body.credential === "string" ? body.credential : "";
  // The server's own nonce from the cookie; whatever the body says is ignored.
  const nonce = jar.get(NONCE_COOKIE)?.value ?? "";
  if (!credential || credential.length > 4096 || credential.split(".").length !== 3 || nonce.length < 16 || nonce.length > 128) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const vouchedSub = await verifyGoogleIdToken(credential);
    const claims = validateClaims(decodeJwtPayload(credential), { clientId: process.env.GOOGLE_CLIENT_ID ?? "", nonce });
    if (!vouchedSub || !claims.ok || claims.sub !== vouchedSub) {
      console.warn("google one tap: token refused:", !vouchedSub ? "tokeninfo" : claims.ok ? "sub mismatch" : claims.reason);
      return NextResponse.json({ error: "Google sign-in didn't finish." }, { status: 401 });
    }

    const result = await completeGoogleSignIn(req, claims, {
      next: safeNext(typeof body.next === "string" ? body.next : null),
      ref: typeof body.ref === "string" && /^[A-Za-z0-9]{4,16}$/.test(body.ref) ? body.ref.toUpperCase() : null,
      touch: parseTouch(body.touch),
      fromScan: body.fromScan === true,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.code === 2 ? "That account has extra security. Log in with your email and password." : "Google sign-in didn't finish." },
        { status: result.code === 2 ? 403 : 401 },
      );
    }
    const res = NextResponse.json({ next: result.dest, isNew: result.isNew });
    res.cookies.set(NONCE_COOKIE, "", { path: "/api/auth/google/onetap", maxAge: 0 }); // one use
    result.apply(res);
    return res;
  } catch (err) {
    console.error("google one tap failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Google sign-in didn't finish." }, { status: 500 });
  }
}
