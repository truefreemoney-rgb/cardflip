import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";

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

/**
 * Revoking on account deletion (Apple's account-deletion rule, 10-31). The app sends the one-time
 * authorization code with its sign-in; the server trades it for a refresh token (stored sealed) and
 * revokes that token when the account is deleted, which also drops CardFlip from the user's Apple ID
 * "Sign in with Apple" list. Needs a Sign in with Apple key from developer.apple.com > Keys:
 * APPLE_TEAM_ID, APPLE_SIWA_KEY_ID and APPLE_SIWA_PRIVATE_KEY (the .p8 text; "\n" escapes allowed).
 * Without them nothing is stored and deletion skips the revoke, as before.
 * ROTATION: the seal key follows the private key, so a new .p8 leaves older tokens unrevocable.
 */
interface SiwaKey {
  teamId: string;
  keyId: string;
  privateKey: string;
}

function siwaKey(): SiwaKey | null {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_SIWA_KEY_ID?.trim();
  const privateKey = process.env.APPLE_SIWA_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  return teamId && keyId && privateKey ? { teamId, keyId, privateKey } : null;
}

export function appleRevokeConfigured(): boolean {
  return siwaKey() !== null;
}

/** The client secret Apple's token endpoints want: an ES256 JWT signed with the key, good for 5 minutes. */
async function clientSecret(key: SiwaKey): Promise<string> {
  const pk = await importPKCS8(key.privateKey, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: key.keyId })
    .setIssuer(key.teamId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience(APPLE_ISSUER)
    .setSubject(APPLE_BUNDLE_ID)
    .sign(pk);
}

function sealKey(key: SiwaKey): Buffer {
  return createHash("sha256").update(`cardflip-apple-token:${key.privateKey}`).digest();
}

export function sealAppleToken(plain: string, key = siwaKey()): string {
  if (!key) throw new Error("Sign in with Apple key not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(key), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function openAppleToken(sealed: string, key = siwaKey()): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (!key || version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", sealKey(key), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Trades the app's one-time authorization code for a refresh token; null when no key is set or Apple refuses. */
export async function exchangeAppleCode(code: string): Promise<string | null> {
  const key = siwaKey();
  if (!key || !code || code.length > 2048) return null;
  const res = await fetch(`${APPLE_ISSUER}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: APPLE_BUNDLE_ID, client_secret: await clientSecret(key), code, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.warn("apple code exchange refused:", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return null;
  }
  const body = (await res.json().catch(() => null)) as { refresh_token?: unknown } | null;
  return typeof body?.refresh_token === "string" ? body.refresh_token : null;
}

/** Revokes a refresh token; true when Apple answered 200. */
export async function revokeAppleToken(refreshToken: string): Promise<boolean> {
  const key = siwaKey();
  if (!key) return false;
  const res = await fetch(`${APPLE_ISSUER}/auth/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: APPLE_BUNDLE_ID, client_secret: await clientSecret(key), token: refreshToken, token_type_hint: "refresh_token" }),
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}
