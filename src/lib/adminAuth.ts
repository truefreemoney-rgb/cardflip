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
/**
 * Idle timeout (Chris, 09-10: "time out users after 5 minutes" — the helper
 * stayed signed in on her own computer). The console keeps the cookie alive
 * while someone is actually using it (POST /api/admin/touch from
 * AdminKeepAlive); five quiet minutes and the next request is a login.
 */
export const ADMIN_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes idle
/** A token that expires further out than TTL was issued under an older rule: refuse it. */
const CLOCK_SKEW_MS = 60 * 1000;
export function tokenLifeOk(expiresAt: number, now: number): boolean {
  return Number.isFinite(expiresAt) && expiresAt > now && expiresAt - now <= ADMIN_SESSION_TTL_MS + CLOCK_SKEW_MS;
}

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

/**
 * Roles. "owner" is the operator login above — everything. "helper" is a
 * second, optional login (ADMIN_HELPER_USER / ADMIN_HELPER_PASSWORD) for
 * someone Chris hands the board to (09-10: his girlfriend runs social-media
 * tasks through the runner — "put some training wheels on so she doesn't
 * break everything"). A helper sees only the Tasks page, and only her own
 * category on it: add a note, a photo, ▶ Run, ↳ Reply. No Merge, no edits
 * to anyone else's rows, no users / switches / system. Unset = no helper
 * login exists.
 */
export type AdminRole = "owner" | "helper";

export function helperCredentials(env: NodeJS.ProcessEnv = process.env): AdminCredentials | null {
  const user = env.ADMIN_HELPER_USER?.trim();
  const password = env.ADMIN_HELPER_PASSWORD;
  return user && password ? { user, password } : null;
}

/** The helper's display name — "Sam" from ADMIN_HELPER_USER=sam; her notes and replies carry it. */
export function helperName(env: NodeJS.ProcessEnv = process.env): string {
  const u = helperCredentials(env)?.user ?? "Helper";
  return u.charAt(0).toUpperCase() + u.slice(1);
}

/** Which login these credentials are, or null. The owner wins a tie on username. */
export function verifyAdminLogin(user: string, password: string, env: NodeJS.ProcessEnv = process.env): AdminRole | null {
  if (verifyAdminCredentials(user, password, adminCredentials(env))) return "owner";
  const h = helperCredentials(env);
  if (h && verifyAdminCredentials(user, password, h)) return "helper";
  return null;
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
  if (!tokenLifeOk(expiresAt, now)) return false;
  const expected = createHmac("sha256", signingKey(creds, env)).update(String(expiresAt)).digest("base64url");
  return safeEqual(mac, expected);
}

/**
 * Helper session: "<expiresAtMs>.h.<hmac>" signed with the helper's own
 * credentials, so the owner's key never verifies it and changing the helper
 * password ends her sessions alone. The ".h." segment is inside the MAC.
 */
export function signHelperToken(now = Date.now(), creds = helperCredentials(), env: NodeJS.ProcessEnv = process.env): { token: string; expiresAt: number } {
  if (!creds) throw new Error("No helper login is configured");
  const expiresAt = now + ADMIN_SESSION_TTL_MS;
  const mac = createHmac("sha256", signingKey(creds, env)).update(`h:${expiresAt}`).digest("base64url");
  return { token: `${expiresAt}.h.${mac}`, expiresAt };
}

/** Which role a cookie value carries — owner, helper, or nothing. */
export function adminRoleOf(token: string | undefined | null, now = Date.now(), env: NodeJS.ProcessEnv = process.env): AdminRole | null {
  if (!token) return null;
  if (verifyAdminToken(token, now, adminCredentials(env), env)) return "owner";
  const m = /^(\d+)\.h\.([A-Za-z0-9_-]+)$/.exec(token);
  const creds = helperCredentials(env);
  if (!m || !creds) return null;
  const expiresAt = Number(m[1]);
  if (!tokenLifeOk(expiresAt, now)) return null;
  const expected = createHmac("sha256", signingKey(creds, env)).update(`h:${expiresAt}`).digest("base64url");
  return safeEqual(m[2], expected) ? "helper" : null;
}
