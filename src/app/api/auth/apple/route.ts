import { NextResponse } from "next/server";
import { verifyAppleIdentityToken } from "@/lib/server/appleAuth";
import { completeGoogleSignIn } from "@/lib/server/googleSignIn";
import { appSessionBody, isAppRequest } from "@/lib/server/appSession";
import { ipGate } from "@/lib/server/rateLimitDb";
import { toPublicUser } from "@/lib/server/users";

/**
 * Sign in with Apple, the iPhone app only (docs/APP-PLAN.md step 6, 10-29).
 * The app POSTs { identityToken, nonce, name? }: the token iOS handed it, the
 * SHA-256 hex nonce it minted for that request, and the name Apple gives the
 * app on the first sign-in only. lib/server/appleAuth.ts checks the token
 * against Apple's keys; lib/server/googleSignIn.ts then makes / links / logs
 * in the account under the same rules as Google (same guards, same travel
 * rule, admin / two-step accounts never opened this way). The answer is the
 * login route's: { user, session: { token, expiresAt } }, so the app stores
 * the bearer token like any other sign-in and the waiting guest scan lands.
 */
export async function POST(req: Request) {
  if (!isAppRequest(req)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const limited = await ipGate(req, "auth:apple");
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const identityToken = typeof body.identityToken === "string" ? body.identityToken : "";
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  // Apple's name arrives once; a blank one means a returning user, and the account keeps its name.
  const rawName = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";

  try {
    const verified = await verifyAppleIdentityToken(identityToken, nonce);
    if (!verified.ok) {
      console.warn("apple sign-in: token refused:", verified.reason);
      return NextResponse.json({ error: "Sign in with Apple didn't finish." }, { status: 401 });
    }
    const { claims } = verified;
    // A new account needs a name: Apple's, else the part of the email before the @ (a relay address gives "Card Collector").
    const name = rawName || (claims.privateEmail ? "" : claims.email.split("@")[0].slice(0, 40)) || "Card Collector";
    const result = await completeGoogleSignIn(
      req,
      { sub: claims.sub, email: claims.email, name },
      { next: null, ref: null, touch: null, fromScan: body.fromScan === true },
      { kind: "apple", privateEmail: claims.privateEmail },
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.code === 2 ? "That account has extra security. Log in with your email and password." : "Sign in with Apple didn't finish." },
        { status: result.code === 2 ? 403 : 401 },
      );
    }
    const res = NextResponse.json({ user: toPublicUser(result.user), isNew: result.isNew, ...appSessionBody(req, result.session) });
    result.apply(res);
    return res;
  } catch (err) {
    console.error("apple sign-in failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Sign in with Apple didn't finish." }, { status: 500 });
  }
}
