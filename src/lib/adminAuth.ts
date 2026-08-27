import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Admin panel credentials + stateless session tokens. Pure (no DB, no
 * "server-only") so scripts/test-admin.mjs can drive it.
 *
 * The panel has its own login, separate from user accounts: one operator
 * username/password from the environment (ADMIN_PANEL_USER /
 * ADMIN_PANEL_PASSWORD; Chris's choice of defaults when unset), and a signed
 * cookie `cardflip_admin` = "<expiresAtMs>.<hmac>" that needs no table. The
 * HMAC key is derived from the password itself plus the app secret, so
 * changing the password invalidates every session.
 */

export const ADMIN_COOKIE = "cardflip_admin";
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface AdminCredentials {
  user: string;
  password: string;
}

// Matches the admin *user* account (admin@cardflip.dev) so there is one set of
// credentials to remember, not two. This is only the fallback — setting
// ADMIN_PANEL_USER / ADMIN_PANEL_PASSWORD in the environment overrides it, and
// that is what should be done before real users are on the site, since this
// default is visible to anyone reading the repo.
const DEFAULTS: AdminCredentials = { user: "admin", password: "password" };

export function adminCredentials(env: NodeJS.ProcessEnv = process.env): AdminCredentials {
  return {
    user: env.ADMIN_PANEL_USER?.trim() || DEFAULTS.user,
    password: env.ADMIN_PANEL_PASSWORD || DEFAULTS.password,
  };
}

/** True when the panel still runs on the built-in credentials. */
export function adminUsingDefaults(env: NodeJS.ProcessEnv = process.env): boolean {
  const c = adminCredentials(env);
  return c.user === DEFAULTS.user && c.password === DEFAULTS.password;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Compare against self to keep timing flat, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function verifyAdminCredentials(user: string, password: string, creds = adminCredentials()): boolean {
  const u = safeEqual(user.trim().toLowerCase(), creds.user.toLowerCase());
  const p = safeEqual(password, creds.password);
  return u && p;
}

function signingKey(creds: AdminCredentials, env: NodeJS.ProcessEnv): Buffer {
  return createHmac("sha256", `${creds.user}:${creds.password}:${env.EBAY_TOKEN_KEY ?? env.EBAY_CLIENT_SECRET ?? "cardflip"}`)
    .update("admin-session-key")
    .digest();
}

export function signAdminToken(now = Date.now(), creds = adminCredentials(), env: NodeJS.ProcessEnv = process.env): { token: string; expiresAt: number } {
  const expiresAt = now + ADMIN_SESSION_TTL_MS;
  const mac = createHmac("sha256", signingKey(creds, env)).update(String(expiresAt)).digest("base64url");
  return { token: `${expiresAt}.${mac}`, expiresAt };
}

export function verifyAdminToken(token: string | undefined | null, now = Date.now(), creds = adminCredentials(), env: NodeJS.ProcessEnv = process.env): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAt = Number(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expected = createHmac("sha256", signingKey(creds, env)).update(String(expiresAt)).digest("base64url");
  return safeEqual(mac, expected);
}
