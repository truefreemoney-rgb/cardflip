import "server-only";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/homeCookie";

/**
 * The iPhone app (docs/APP-PLAN.md, 10-28) talks to the same API as the
 * website but has no browser cookie jar worth trusting. It sends this header
 * on every request and carries its session as `Authorization: Bearer <token>`
 * instead of the cardflip_session cookie. The token is the very same value
 * the cookie would hold (sessions.ts), so nothing else about sessions changes:
 * same table, same sliding expiry, same "sign out everywhere" sweep.
 *
 * Only a request that announces itself as the app gets the token in a JSON
 * body (login, signup, renewal). The website keeps its httpOnly cookie and
 * never sees the value.
 */
export const APP_HEADER = "x-cardflip-app";

/** True when the caller is the native app (header looks like "ios/1.0.0"). */
export function isAppRequest(req: { headers: Headers }): boolean {
  return Boolean(req.headers.get(APP_HEADER));
}

/** The bearer token on a request, or null when there is none / it is not shaped like one we issued. */
export function bearerToken(h: Headers): string | null {
  const auth = h.get("authorization") ?? "";
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(auth.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * The session token behind the current request: the browser cookie first,
 * else the app's bearer header. Works in route handlers and server components.
 */
export async function currentSessionToken(): Promise<{ token: string; via: "cookie" | "bearer" } | null> {
  const h = await headers();
  const fromHeader = bearerToken(h);
  // The app's own call: its bearer wins. The in-app pages share a cookie jar with it, and a dead
  // cookie left there must not shadow the live token the app just signed in with (10-29).
  if (fromHeader && isAppRequest({ headers: h })) return { token: fromHeader, via: "bearer" };
  const jar = await cookies();
  const fromCookie = jar.get(SESSION_COOKIE_NAME)?.value;
  if (fromCookie) return { token: fromCookie, via: "cookie" };
  return fromHeader ? { token: fromHeader, via: "bearer" } : null;
}

/** What login/signup add to their JSON for the app: the token the cookie would have carried. */
export function appSessionBody(req: { headers: Headers }, session: { token: string; expiresAt: number }) {
  return isAppRequest(req) ? { session: { token: session.token, expiresAt: session.expiresAt } } : {};
}
