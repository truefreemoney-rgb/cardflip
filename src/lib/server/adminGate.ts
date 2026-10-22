import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/server/auth";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_MS,
  type AdminRole,
  type AdminSession,
  adminSessionOf,
  maxLifeOf,
  signAdminToken,
  signHelperToken,
} from "@/lib/adminAuth";

/**
 * The admin panel's own gate — a signed cookie issued by POST /api/admin/login
 * with the operator username/password (lib/adminAuth.ts). Independent of user
 * accounts: you don't need to be signed in as a seller to run the panel, and
 * being a seller never gets you in.
 *
 * Two roles (lib/adminAuth.ts): the owner, and an optional helper who only
 * gets the Tasks page and her own category on it. Routes that change
 * anything outside that call requireOwnerPanel().
 *
 * Sign Out really ends the session (#32): the cookie names the sign-in it came
 * from, and admin_logouts lists the sign-ins that were ended.
 */

async function signedOut(s: AdminSession): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS x FROM admin_logouts WHERE role = ? AND login_at = ?").get(s.role, s.loginAt);
  return Boolean(row);
}

export async function adminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const s = adminSessionOf(store.get(ADMIN_COOKIE)?.value);
  if (!s || (await signedOut(s))) return null;
  return s;
}

export async function adminRole(): Promise<AdminRole | null> {
  return (await adminSession())?.role ?? null;
}

export async function hasAdminSession(): Promise<boolean> {
  return (await adminRole()) !== null;
}

/** 401 = no panel session, 403 = a session whose role may not do this (10-22: the routes used to mix the two). */
export class AdminAuthError extends AuthError {
  status: 401 | 403;
  constructor(message: string, status: 401 | 403) {
    super(message);
    this.status = status;
  }
}

/** The JSON answer for an auth failure from an /api/admin route. */
export function adminAuthResponse(err: AuthError): NextResponse {
  return NextResponse.json({ error: err.message }, { status: err instanceof AdminAuthError ? err.status : 401 });
}

/** The JSON catch-all for an /api/admin route: auth failures keep their status, anything else is a JSON 500, not Next's HTML page. */
export function adminFailure(err: unknown): NextResponse {
  if (err instanceof AuthError) return adminAuthResponse(err);
  console.error("admin route failed:", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function requireAdminPanel(): Promise<AdminRole> {
  const role = await adminRole();
  if (!role) throw new AdminAuthError("Admin sign-in required", 401);
  return role;
}

export async function requireOwnerPanel(): Promise<void> {
  const role = await adminRole();
  if (role === null) throw new AdminAuthError("Admin sign-in required", 401);
  if (role !== "owner") throw new AdminAuthError("Only the owner can do that", 403);
}

/** Sign Out: this browser's sign-in is ended everywhere its cookie went. Old rows are pruned on the way. */
export async function endAdminSession(): Promise<void> {
  const store = await cookies();
  const s = adminSessionOf(store.get(ADMIN_COOKIE)?.value);
  const now = Date.now();
  await db.prepare("DELETE FROM admin_logouts WHERE until < ?").run(now);
  if (!s) return;
  await db
    .prepare("INSERT OR IGNORE INTO admin_logouts (role, login_at, until) VALUES (?, ?, ?)")
    .run(s.role, s.loginAt, s.loginAt + maxLifeOf(s.role) + 60_000);
}

export function adminCookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  };
}

/** A new session (login: loginAt = now) or the same one re-signed (touch: its loginAt carries over). */
export function issueAdminSession(role: AdminRole = "owner", loginAt = Date.now()) {
  const now = Date.now();
  return role === "helper" ? signHelperToken(now, undefined, process.env, loginAt) : signAdminToken(now, undefined, process.env, loginAt);
}

export { ADMIN_COOKIE, ADMIN_SESSION_TTL_MS };
