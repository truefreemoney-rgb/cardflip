import "server-only";
import { cookies } from "next/headers";
import { AuthError } from "@/lib/server/auth";
import { ADMIN_COOKIE, ADMIN_SESSION_TTL_MS, signAdminToken, verifyAdminToken } from "@/lib/adminAuth";

/**
 * The admin panel's own gate — a signed cookie issued by POST /api/admin/login
 * with the operator username/password (lib/adminAuth.ts). Independent of user
 * accounts: you don't need to be signed in as a seller to run the panel, and
 * being a seller never gets you in.
 */

export async function hasAdminSession(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminToken(store.get(ADMIN_COOKIE)?.value);
}

export async function requireAdminPanel(): Promise<void> {
  if (!(await hasAdminSession())) throw new AuthError("Admin sign-in required");
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

export function issueAdminSession() {
  return signAdminToken();
}

export { ADMIN_COOKIE, ADMIN_SESSION_TTL_MS };
