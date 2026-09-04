"use client";

import { apiPath } from "@/lib/client/basePath";

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

export async function fetchCurrentUser(): Promise<SessionUser | null> {
  const res = await fetch(apiPath("/api/auth/me"));
  if (!res.ok) return null;
  const data = await readJson(res);
  return data.user ?? null;
}

export async function signup(
  name: string,
  email: string,
  password: string,
): Promise<SessionUser> {
  const res = await fetch(apiPath("/api/auth/signup"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error ?? "Sign up failed.");
  return data.user;
}

export async function login(email: string, password: string, code?: string): Promise<SessionUser> {
  const res = await fetch(apiPath("/api/auth/login"), {
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
  await fetch(apiPath("/api/auth/logout"), { method: "POST" });
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

/** Subscribed, or still inside the 10-scan free trial. */
export function canUseApp(user: Pick<SessionUser, "subStatus" | "trialScansLeft"> | null | undefined): boolean {
  return isSubscribed(user) || (user?.trialScansLeft ?? 0) > 0;
}
