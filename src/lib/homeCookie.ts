import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * cf_home: a signed, httpOnly cookie that tells src/proxy.ts which country a
 * signed-in account was created in, WITHOUT a DB call (Chris 09-30 travel
 * rule: "they can use their account abroad but only if it's created in an
 * english speaking country").
 *
 * Value: v1.<userId>.<home|->.<sessionTag>.<issuedAt>.<sig>
 * - "-" = legacy account with no recorded home (pre-09-30) = allowed.
 * - sessionTag = first 16 hex of sha256(cardflip_session token): the proxy
 *   checks it against the session cookie sent alongside, so a copied cf_home
 *   without that exact login is worthless, and signing out kills it.
 */
export const HOME_COOKIE = "cf_home";
/** The login cookie's name; lives here (not server-only auth.ts) so the proxy can read it. */
export const SESSION_COOKIE_NAME = "cardflip_session";
export const HOME_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

function key(): string | null {
  const direct = process.env.GEO_COOKIE_SECRET;
  if (direct) return direct;
  const base = process.env.CRON_SECRET;
  return base ? createHmac("sha256", base).update("cf_home v1").digest("hex") : null;
}

/** False = no key configured: nothing is signed, and the proxy skips the gate rather than lock everyone out. */
export function homeCookieConfigured(): boolean {
  return key() !== null;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url");
}

export function sessionTag(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("hex").slice(0, 16);
}

/** null when no signing key is configured (the cookie is then never set or trusted). */
export function makeHomeCookie(userId: string, home: string | null, sessionToken: string, now = Date.now()): string | null {
  const k = key();
  if (!k) return null;
  const h = home && /^[A-Z]{2}$/.test(home) ? home : "-";
  const payload = `v1.${userId}.${h}.${sessionTag(sessionToken)}.${now}`;
  return `${payload}.${sign(payload, k)}`;
}

export interface HomeClaim {
  userId: string;
  /** null = legacy account (no recorded home). */
  home: string | null;
  issuedAt: number;
}

/**
 * The claim, or null if the cookie is missing, forged, expired, or not bound
 * to the session token presented with it.
 */
export function readHomeCookie(
  value: string | null | undefined,
  sessionToken: string | null | undefined,
  now = Date.now(),
): HomeClaim | null {
  if (!value || !sessionToken) return null;
  const k = key();
  if (!k) return null;
  const parts = value.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") return null;
  const [, userId, home, tag, issued, sig] = parts;
  const expected = Buffer.from(sign(parts.slice(0, 5).join("."), k));
  const got = Buffer.from(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  if (tag !== sessionTag(sessionToken)) return null;
  const at = Number(issued);
  if (!Number.isFinite(at) || now - at > HOME_COOKIE_MAX_AGE_S * 1000 || at > now + 60_000) return null;
  if (!userId || (home !== "-" && !/^[A-Z]{2}$/.test(home))) return null;
  return { userId, home: home === "-" ? null : home, issuedAt: at };
}

export function homeCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: HOME_COOKIE_MAX_AGE_S,
  };
}

type CookieJar = {
  set(name: string, value: string, opts: ReturnType<typeof homeCookieOptions>): unknown;
  delete(name: string): unknown;
};

/** Login / signup / reset / me: stamp the account's home, bound to the session just issued. */
export function setHomeCookie(res: { cookies: CookieJar }, userId: string, home: string | null, sessionToken: string): void {
  const value = makeHomeCookie(userId, home, sessionToken);
  if (value) res.cookies.set(HOME_COOKIE, value, homeCookieOptions());
}

/** Re-issue when missing, for someone else, for another session, a day old, or the home changed. */
export function homeCookieDue(
  current: string | null | undefined,
  userId: string,
  home: string | null,
  sessionToken: string,
  now = Date.now(),
): boolean {
  const claim = readHomeCookie(current, sessionToken, now);
  return !claim || claim.userId !== userId || claim.home !== (home ?? null) || now - claim.issuedAt > 24 * 60 * 60 * 1000;
}

export function clearHomeCookie(res: { cookies: CookieJar }): void {
  res.cookies.delete(HOME_COOKIE);
}
