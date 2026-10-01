import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare of a presented key with a configured secret (10-01 sweep: the cron, ops and social routes used
 * ===). Both sides are hashed first, so the length of the secret leaks nothing either. An unset or empty secret never
 * matches: every caller fails closed.
 */
export function secretEqual(given: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/** The key a machine caller presented: the Authorization Bearer header first, then the legacy ?key= query. */
export function presentedKey(req: { headers: Headers; nextUrl?: URL }): string | null {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;
  return req.nextUrl?.searchParams.get("key") ?? null;
}
