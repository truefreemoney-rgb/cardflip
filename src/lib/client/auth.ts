"use client";

import { apiFetch } from "@/lib/client/basePath";
import type { ScanQuota } from "@/lib/quotaTypes";
import type { Touch } from "@/lib/attribution";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  ebayConnected: boolean;
  createdAt: number;
  totpEnabled?: boolean;
  /** Stripe subscription mirror — null/absent = never subscribed. */
  subStatus?: string | null;
  subPeriodEnd?: number | null;
  /** Free-trial scans left (0 once used, or when subscribed). */
  trialScansLeft?: number;
  /** 'standard' | 'pro' when subscribed. */
  plan?: "standard" | "pro" | null;
  /** Scans each payment credits on the current plan. */
  monthlyScans?: number;
  /** owner | subscribed | legacy | pack | trial. */
  tier?: "owner" | "subscribed" | "legacy" | "pack" | "trial";
  /** Scan Pack scans banked (one-time buys, never expire). */
  packScans?: number;
  /** Server truth: is the app open to this account right now. */
  appAccess?: boolean;
  /** First-login tutorial done; null/absent = show it on the scanner. */
  tourSeenAt?: number | null;
  /** Site switches as they apply to this viewer (admins see everything). */
  /** Which gated games this viewer may see (admins: all). */
  features?: { magic: boolean; mtg?: boolean; lorcana?: boolean; onepiece?: boolean; yugioh?: boolean };
  /** Unused two-step backup codes left. */
  totpBackupCodesLeft?: number;
  /** The scan balance (header counter, account page): remaining null = unlimited. One shared type, so no field is dropped. */
  scans?: ScanQuota;
  /** The subscription is set to cancel at the end of the period (subEndsAt); banked plan scans pause then. */
  cancelAtPeriodEnd?: boolean;
  /** When a canceling subscription ends (ms epoch); null/absent = not ending. */
  subEndsAt?: number | null;
  /** Has this user scanned at least one card yet? Only set by /api/auth/me; drives the logo link. */
  hasCards?: boolean;
  /** Public collection page: the /u/<handle> slug and whether it is open. */
  handle?: string | null;
  handlePublic?: boolean;
  /** Email confirmation wall: true = the app is closed until the emailed code (or link) is used. */
  mustConfirmEmail?: boolean;
  /** Walled accounts only (auth/me, verify-email, signup): when the newest code stops working; null = none live. */
  emailCodeExpiresAt?: number | null;
  /** Signup country (ISO): the home-currency price hint follows it, never the IP. null = legacy/unknown. */
  homeCountry?: string | null;
}

/** Login needs a 6-digit authenticator code (two-step verification). */
export class TotpRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotpRequiredError";
  }
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

/**
 * Where to go after signing in: the `?next=` the app pages set when they
 * bounced an expired session, if it's a safe in-app path; else the scanner.
 * Read from location (not useSearchParams) so the login page needs no
 * Suspense boundary.
 */
export function afterLoginPath(fallback = "/app"): string {
  if (typeof window === "undefined") return fallback;
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

/** The login URL that brings the seller back to `pathname` afterwards. */
export function loginPathFor(pathname: string): string {
  return pathname && pathname !== "/app"
    ? `/login?next=${encodeURIComponent(pathname)}`
    : "/login";
}

/**
 * null = genuinely signed out. A 5xx (DB outage, cold deploy) THROWS so the
 * caller's retry path runs — a 500 used to read as "no session" and bounce a
 * perfectly valid cookie to /login.
 */
export async function fetchCurrentUser(): Promise<SessionUser | null> {
  const res = await apiFetch("/api/auth/me");
  if (res.status === 401 || res.status === 403) return null;
  if (res.status >= 500) throw new Error(`auth/me ${res.status}`);
  if (!res.ok) return null;
  const data = await readJson(res);
  return data.user ?? null;
}

/**
 * What a signup answers. With email confirmation on, `user.mustConfirmEmail`
 * is true and a code is on its way (`emailSent`); `emailProblem: "recipient"`
 * means the mail server refused that address (ask for a corrected one).
 * `resumed`: the same email and password came back for an account still
 * waiting on its code, so it was signed in again instead of refused.
 */
export interface SignupResult {
  user: SessionUser;
  emailSent: boolean;
  emailProblem: "recipient" | null;
  resumed: boolean;
}

export async function signup(
  name: string,
  email: string,
  password: string,
  ref?: string | null,
  /** The first touch this browser kept (components/AttributionCapture.tsx): which post or site brought the person. */
  touch?: Touch | null,
): Promise<SignupResult> {
  const res = await apiFetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, ...(ref ? { ref } : {}), ...(touch ? { touch } : {}) }),
  });
  const data = await readJson(res);
  // A confirmation-code limit answers { error: "slow_down", message }: show the message.
  if (!res.ok) throw new Error(data.message ?? data.error ?? "Sign up failed.");
  return {
    user: data.user,
    emailSent: Boolean(data.emailSent),
    emailProblem: data.emailProblem === "recipient" ? "recipient" : null,
    resumed: Boolean(data.resumed),
  };
}

export async function login(email: string, password: string, code?: string): Promise<SessionUser> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(code ? { email, password, code } : { email, password }),
  });
  const data = await readJson(res);
  if (!res.ok) {
    if (data.totpRequired) throw new TotpRequiredError(data.error ?? "Enter your authenticator code.");
    throw new Error(data.error ?? "Login failed.");
  }
  return data.user;
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
  // Per-account browser prefs must not leak into the next login.
  const { clearAccountPrefs } = await import("@/lib/client/scanPrefs");
  clearAccountPrefs();
}

// The eBay OAuth connect flow was removed until real API credentials exist:
// a "connect" endpoint that only flips a flag reads as a fake OAuth claim,
// which is worse than having none. The real flow (redirect to eBay's
// authorize URL, exchange the callback code server-side) lands with the
// production keyset.

/** Paid-only: the app is open to active, trialing and past-due subscribers. */
export function isSubscribed(user: Pick<SessionUser, "subStatus"> | null | undefined): boolean {
  const s = user?.subStatus ?? null;
  return s === "active" || s === "trialing" || s === "past_due";
}

/** Subscribed, or still inside the 5-scan free trial. */
export function canUseApp(
  user: Pick<SessionUser, "subStatus" | "trialScansLeft" | "appAccess"> | null | undefined,
): boolean {
  if (typeof user?.appAccess === "boolean") return user.appAccess;
  return isSubscribed(user) || (user?.trialScansLeft ?? 0) > 0;
}
