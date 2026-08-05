import "server-only";
import { cookies } from "next/headers";
import { getSessionUserId, destroySession } from "@/lib/server/sessions";
import { findUserById, type User } from "@/lib/server/users";

export const SESSION_COOKIE = "cardflip_session";

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const userId = getSessionUserId(token);
  if (!userId) return null;

  return findUserById(userId);
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Not signed in");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("Admin access required");
  return user;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  store.delete(SESSION_COOKIE);
}

export class AuthError extends Error {}
