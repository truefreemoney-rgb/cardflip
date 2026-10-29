import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Sign in with Apple for the iPhone app (docs/APP-PLAN.md step 6, 10-29). The
 * app gets an identity token from iOS (expo-apple-authentication) and POSTs
 * it to api/auth/apple; this checks it the way Apple says to: RS256 signature
 * against Apple's published keys, iss = appleid.apple.com, aud = our bundle
 * id, not expired, and the nonce the app minted for that one request.
 *
 * Apple sends the user's name only on the FIRST sign-in and only to the app
 * (never inside the token), so the app passes it along; later sign-ins carry
 * no name and the account keeps the one it has. The email is in every token.
 * A Hide My Email address (privaterelay.appleid.com) is a real inbox Apple
 * forwards to, but only from senders registered with Apple (Chris's step:
 * Certificates, Identifiers & Profiles → Services → Sign in with Apple for
 * Email Communication → cardflip.io + the Resend sender).
 */
export const APPLE_ISSUER = "https://appleid.apple.com";
/** The app's bundle id (mobile/app.json ios.bundleIdentifier); env lets a TestFlight / dev build differ. */
export const APPLE_BUNDLE_ID = process.env.APPLE_APP_BUNDLE_ID || "io.cardflip.app";

const jwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`), { cooldownDuration: 60_000, cacheMaxAge: 24 * 60 * 60_000 });

export interface AppleClaims {
  /** Apple's stable user id for this app's team (the account link key). */
  sub: string;
  email: string;
  emailVerified: boolean;
  /** A Hide My Email relay address. */
  privateEmail: boolean;
}

export type AppleVerify = { ok: true; claims: AppleClaims } | { ok: false; reason: string };

/**
 * identityToken: the JWT from the device. nonce: the SHA-256 hex the app passed to Apple for this request
 * (the token carries the same hash); "" skips the check for an old app that sent none (refused: every build sends one).
 */
export async function verifyAppleIdentityToken(identityToken: string, nonce: string): Promise<AppleVerify> {
  if (!identityToken || identityToken.length > 8192 || identityToken.split(".").length !== 3) return { ok: false, reason: "not a token" };
  if (!/^[0-9a-f]{64}$/i.test(nonce)) return { ok: false, reason: "no nonce" };
  let payload: Record<string, unknown>;
  try {
    const res = await jwtVerify(identityToken, jwks, { issuer: APPLE_ISSUER, audience: APPLE_BUNDLE_ID, algorithms: ["RS256"], clockTolerance: 60 });
    payload = res.payload as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "verify failed" };
  }
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!sub || sub.length > 128) return { ok: false, reason: "no sub" };
  if (!email || !email.includes("@")) return { ok: false, reason: "no email" };
  const tokenNonce = typeof payload.nonce === "string" ? payload.nonce : "";
  if (tokenNonce.toLowerCase() !== nonce.toLowerCase()) return { ok: false, reason: "nonce mismatch" };
  // Apple sends these as booleans or the strings "true"/"false", depending on the client.
  const flag = (v: unknown) => v === true || v === "true";
  const emailVerified = payload.email_verified === undefined ? true : flag(payload.email_verified);
  if (!emailVerified) return { ok: false, reason: "email not verified" };
  const privateEmail = flag(payload.is_private_email) || email.endsWith("@privaterelay.appleid.com");
  return { ok: true, claims: { sub, email, emailVerified, privateEmail } };
}
