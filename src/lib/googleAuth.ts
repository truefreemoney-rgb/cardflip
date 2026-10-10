/**
 * "Continue with Google" — the pure parts (no I/O, no server-only, so scripts/test-google-auth.mjs
 * can pin them). The routes are app/api/auth/google/{start,callback}; the account work is
 * lib/server/googleAuth.ts. Authorization-code flow, plain fetch, no library.
 */
import { parseTouch, type Touch } from "@/lib/attribution";

export const GOOGLE_STATE_COOKIE = "cf_gstate";
export const GOOGLE_STATE_MAX_AGE_S = 10 * 60;
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Shown on /login and /signup (?google_error=1) when anything in the round trip fails. */
export const GOOGLE_FAIL_MESSAGE = "Google sign-in didn't finish. Try again or use email.";

/**
 * users.password_hash is NOT NULL, so an account made through Google stores this instead.
 * It has no ":" so password.verifyPassword() always says no — nobody can type their way in.
 */
export const NO_PASSWORD = "!google-sign-in";

export function hasPassword(passwordHash: string): boolean {
  return passwordHash !== NO_PASSWORD;
}

/** Wrong-password answer for an account that has no password (login route). */
export const GOOGLE_ONLY_MESSAGE = "This account signs in with Google or X. Tap that button, or use Forgot Password to set a password.";

export type GoogleMode = "signup" | "login";

export interface GoogleState {
  /** Random value sent to Google as `state` and compared on the way back. */
  s: string;
  /** Random value Google puts in the id_token as `nonce`. */
  n: string;
  mode: GoogleMode;
  /** Same-site path to land on after an existing account signs in. */
  next: string | null;
  /** Invite code (localStorage cardflip.ref) and first-touch attribution, carried like the normal signup does. */
  ref: string | null;
  touch: Touch | null;
  /** /signup came from the /scan ad page (the signup form's from=scan). */
  fromScan: boolean;
}

/** A same-site path or null. Mirrors lib/client/auth.safeNextPath (no backslashes, no whitespace, no //host). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\s]/.test(next) || next.length > 300) return null;
  // Never bounce back into the auth pages themselves.
  if (/^\/(login|signup|api\/)/.test(next)) return null;
  return next;
}

export function encodeState(st: GoogleState): string {
  return Buffer.from(JSON.stringify(st), "utf8").toString("base64url");
}

export function decodeState(raw: string | null | undefined): GoogleState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof v.s !== "string" || typeof v.n !== "string" || v.s.length < 16 || v.n.length < 16) return null;
    if (v.mode !== "signup" && v.mode !== "login") return null;
    const ref = typeof v.ref === "string" && /^[A-Za-z0-9]{4,16}$/.test(v.ref) ? v.ref.toUpperCase() : null;
    return {
      s: v.s,
      n: v.n,
      mode: v.mode,
      next: safeNext(typeof v.next === "string" ? v.next : null),
      ref,
      touch: parseTouch(v.touch),
      fromScan: v.fromScan === true,
    };
  } catch {
    return null;
  }
}

/** Constant-time-ish compare of the `state` Google sent back with the one in our cookie. */
export function stateMatches(cookie: GoogleState | null, returned: string | null | undefined): boolean {
  if (!cookie || !returned || returned.length !== cookie.s.length) return false;
  let diff = 0;
  for (let i = 0; i < returned.length; i++) diff |= returned.charCodeAt(i) ^ cookie.s.charCodeAt(i);
  return diff === 0;
}

export interface IdClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  sub?: unknown;
  nonce?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  given_name?: unknown;
}

/** The payload of a JWT, unverified: it came straight from Google's token endpoint over TLS, which is the trust. */
export function decodeJwtPayload(idToken: string): IdClaims | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const v = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return v && typeof v === "object" ? (v as IdClaims) : null;
  } catch {
    return null;
  }
}

export type ClaimResult =
  | { ok: true; sub: string; email: string; name: string }
  | { ok: false; reason: "claims" | "iss" | "aud" | "expired" | "nonce" | "unverified" | "no_email" };

export function validateClaims(
  claims: IdClaims | null,
  opts: { clientId: string; nonce: string; now?: number },
): ClaimResult {
  if (!claims) return { ok: false, reason: "claims" };
  if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") return { ok: false, reason: "iss" };
  const aud = claims.aud;
  const audOk = typeof aud === "string" ? aud === opts.clientId : Array.isArray(aud) && aud.length === 1 && aud[0] === opts.clientId;
  if (!opts.clientId || !audOk) return { ok: false, reason: "aud" };
  const now = opts.now ?? Date.now();
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return { ok: false, reason: "expired" };
  if (typeof claims.nonce !== "string" || claims.nonce !== opts.nonce) return { ok: false, reason: "nonce" };
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) return { ok: false, reason: "claims" };
  if (typeof claims.email !== "string" || !claims.email.includes("@")) return { ok: false, reason: "no_email" };
  // Google can send the flag as a string in old tokens; only a real true counts.
  if (claims.email_verified !== true) return { ok: false, reason: "unverified" };
  const email = claims.email.trim().toLowerCase();
  const given = typeof claims.given_name === "string" ? claims.given_name.trim() : "";
  const full = typeof claims.name === "string" ? claims.name.trim() : "";
  const name = (given || full.split(/\s+/)[0] || email.split("@")[0]).slice(0, 80);
  return { ok: true, sub: claims.sub, email, name };
}

export type AccountDecision = "login" | "link" | "create" | "refuse-stronger-account";

/**
 * What to do with a verified Google identity.
 *  - bySub: the account already tied to this Google id → log in.
 *  - byEmail: an account with the same email, not yet tied → tie it and log in.
 *  - neither → make a new account.
 * Accounts with an extra lock (admin role, authenticator on) are never opened by Google alone:
 * their sign-in asks for a second step the Google route cannot give.
 */
export function decideAccount(found: {
  bySub: { hasSecondStep: boolean } | null;
  byEmail: { hasSecondStep: boolean; googleSub: string | null } | null;
}): AccountDecision {
  if (found.bySub) return found.bySub.hasSecondStep ? "refuse-stronger-account" : "login";
  if (found.byEmail) {
    // Already tied to a DIFFERENT Google id: never re-point it.
    if (found.byEmail.googleSub) return "refuse-stronger-account";
    return found.byEmail.hasSecondStep ? "refuse-stronger-account" : "link";
  }
  return "create";
}
