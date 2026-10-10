/**
 * "Continue with X" - the pure parts (no I/O, no server-only, so scripts/test-x-auth.mjs can pin
 * them). The routes are app/api/auth/x/{start,callback,finish}; the network and cookie work is
 * lib/server/xAuth.ts. OAuth 2.0 authorization code with PKCE, plain fetch, no library.
 * Mirrors lib/googleAuth.ts; the no-password marker and safeNext are shared with it.
 */
import { createHash } from "node:crypto";
import { parseTouch, type Touch } from "@/lib/attribution";
import { safeNext } from "@/lib/googleAuth";

export const X_STATE_COOKIE = "x_oauth";
export const X_STATE_MAX_AGE_S = 10 * 60;
export const X_PENDING_COOKIE = "x_pending";
export const X_PENDING_MAX_AGE_S = 15 * 60;
export const X_AUTH_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_PROFILE_URL = "https://api.x.com/2/users/me?user.fields=confirmed_email,name,username";
export const X_SCOPE = "tweet.read users.read users.email";

/** Shown on /login and /signup (?x_error=1) when anything in the round trip fails. */
export const X_FAIL_MESSAGE = "X sign-in didn't finish. Try again or use email.";

export type XMode = "signup" | "login";

export interface XState {
  /** Random value sent to X as `state` and compared on the way back. */
  s: string;
  /** PKCE code_verifier; X only ever sees its S256 hash until the token exchange. */
  v: string;
  mode: XMode;
  /** Same-site path to land on after an existing account signs in. */
  next: string | null;
  /** Invite code (localStorage cardflip.ref) and first-touch attribution, carried like the normal signup does. */
  ref: string | null;
  touch: Touch | null;
  /** /signup came from the /scan ad page (the signup form's from=scan). */
  fromScan: boolean;
}

/** PKCE S256: base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function encodeXState(st: XState): string {
  return Buffer.from(JSON.stringify(st), "utf8").toString("base64url");
}

export function decodeXState(raw: string | null | undefined): XState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof v.s !== "string" || typeof v.v !== "string" || v.s.length < 16 || v.v.length < 43 || v.v.length > 128) return null;
    if (v.mode !== "signup" && v.mode !== "login") return null;
    const ref = typeof v.ref === "string" && /^[A-Za-z0-9]{4,16}$/.test(v.ref) ? v.ref.toUpperCase() : null;
    return {
      s: v.s,
      v: v.v,
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

/** Constant-time-ish compare of the `state` X sent back with the one in our cookie. */
export function xStateMatches(cookie: XState | null, returned: string | null | undefined): boolean {
  if (!cookie || !returned || returned.length !== cookie.s.length) return false;
  let diff = 0;
  for (let i = 0; i < returned.length; i++) diff |= returned.charCodeAt(i) ^ cookie.s.charCodeAt(i);
  return diff === 0;
}

export type XProfileResult =
  | { ok: true; sub: string; name: string; username: string; email: string | null }
  | { ok: false; reason: "claims" | "id" };

/**
 * The body of GET /2/users/me: {data: {id, name, username, confirmed_email?}}. The email is only
 * there when X returned one it confirmed; missing, empty or not a string means "no email" (null).
 */
export function parseXProfile(body: unknown): XProfileResult {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  if (!data || typeof data !== "object") return { ok: false, reason: "claims" };
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "string" || !/^\d{1,30}$/.test(d.id)) return { ok: false, reason: "id" };
  const username = typeof d.username === "string" ? d.username.trim() : "";
  const full = typeof d.name === "string" ? d.name.trim() : "";
  const name = (full || username || "X user").slice(0, 80);
  const raw = typeof d.confirmed_email === "string" ? d.confirmed_email.trim().toLowerCase() : "";
  const email = raw.length <= 254 && /^\S+@\S+\.\S+$/.test(raw) ? raw : null;
  return { ok: true, sub: d.id, name, username: username.slice(0, 40), email };
}

export type XDecision = "login" | "link" | "create" | "need-email" | "refuse-stronger-account";

/**
 * What to do with an X identity.
 *  - bySub: the account already tied to this X id → log in.
 *  - byEmail (only when X confirmed an email): same email, not yet tied → tie it and log in.
 *  - email but no account → make one. No email at all → ask for one (need-email).
 * Accounts with an extra lock (admin role, authenticator on) are never opened by X alone.
 */
export function decideXAccount(found: {
  bySub: { hasSecondStep: boolean } | null;
  hasEmail: boolean;
  byEmail: { hasSecondStep: boolean; xSub: string | null } | null;
}): XDecision {
  if (found.bySub) return found.bySub.hasSecondStep ? "refuse-stronger-account" : "login";
  if (!found.hasEmail) return "need-email";
  if (found.byEmail) {
    // Already tied to a DIFFERENT X id: never re-point it.
    if (found.byEmail.xSub) return "refuse-stronger-account";
    return found.byEmail.hasSecondStep ? "refuse-stronger-account" : "link";
  }
  return "create";
}

/** What the "x_pending" cookie carries between the callback and the one-field email step. */
export interface XPending {
  sub: string;
  name: string;
  username: string;
  mode: XMode;
  next: string | null;
  ref: string | null;
  touch: Touch | null;
  fromScan: boolean;
  /** Epoch ms the cookie was made. */
  iat: number;
}
