import "server-only";
import { cookies } from "next/headers";
import { AuthError } from "@/lib/server/auth";
import { ADMIN_COOKIE, ADMIN_SESSION_TTL_MS, type AdminRole, adminRoleOf, signAdminToken, signHelperToken } from "@/lib/adminAuth";

/**
 * The admin panel's own gate — a signed cookie issued by POST /api/admin/login
 * with the operator username/password (lib/adminAuth.ts). Independent of user
 * accounts: you don't need to be signed in as a seller to run the panel, and
 * being a seller never gets you in.
 *
 * Two roles (lib/adminAuth.ts): the owner, and an optional helper who only
 * gets the Tasks page and her own category on it. Routes that change
 * anything outside that call requireOwnerPanel().
 */

export async function adminRole(): Promise<AdminRole | null> {
  const store = await cookies();
  return adminRoleOf(store.get(ADMIN_COOKIE)?.value);
}

export async function hasAdminSession(): Promise<boolean> {
  return (await adminRole()) !== null;
}

export async function requireAdminPanel(): Promise<AdminRole> {
  const role = await adminRole();
  if (!role) throw new AuthError("Admin sign-in required");
  return role;
}

export async function requireOwnerPanel(): Promise<void> {
  if ((await adminRole()) !== "owner") throw new AuthError("Only the owner can do that");
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

export function issueAdminSession(role: AdminRole = "owner") {
  return role === "helper" ? signHelperToken() : signAdminToken();
}

export { ADMIN_COOKIE, ADMIN_SESSION_TTL_MS };

