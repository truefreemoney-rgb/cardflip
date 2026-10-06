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

const warnedKeyPaths = new Set<string>();

/**
 * The key a machine caller presented: the Authorization Bearer header first, then the legacy ?key= query.
 * A ?key= in the URL lands in access logs, so the first use per path per process logs one warning (path only,
 * never the key) to find whichever pinger still sends it before the query form is removed.
 */
export function presentedKey(req: { headers: Headers; nextUrl?: URL }): string | null {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;
  const key = req.nextUrl?.searchParams.get("key") ?? null;
  if (key) warnKeyInUrl(req.nextUrl?.pathname ?? "unknown");
  return key;
}

/** One server-log warning per path per process when a secret arrived as ?key= (never logs the value). */
export function warnKeyInUrl(pathname: string): void {
  if (warnedKeyPaths.has(pathname)) return;
  warnedKeyPaths.add(pathname);
  console.warn(`Secret presented in the URL (?key=) on ${pathname}; use the Authorization: Bearer header so it stays out of access logs.`);
}
