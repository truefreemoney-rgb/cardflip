"use client";

import { apiPath } from "@/lib/client/basePath";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  ebayConnected: boolean;
  createdAt: number;
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

export async function login(email: string, password: string): Promise<SessionUser> {
  const res = await fetch(apiPath("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error ?? "Login failed.");
  return data.user;
}

export async function startDemoSession(): Promise<SessionUser> {
  const res = await fetch(apiPath("/api/auth/demo"), { method: "POST" });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error ?? "Couldn't start the demo.");
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
