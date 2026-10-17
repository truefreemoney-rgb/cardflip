import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Admin panel credentials + stateless session tokens. Pure (no DB, no
 * "server-only") so scripts/test-admin.mjs can drive it.
 *
 * The panel has its own login, separate from user accounts: one operator
 * username/password from the environment (ADMIN_PANEL_USER /
 * ADMIN_PANEL_PASSWORD; no password set = owner login off), and a signed
 * cookie `cardflip_admin` = "<expiresAtMs>.<hmac>" that needs no table. The
 * HMAC key is derived from the password itself plus the app secret, so
 * changing the password invalidates every session.
 */

export const ADMIN_COOKIE = "cardflip_admin";
/**
 * Idle timeouts. The console keeps the cookie alive while someone is actually
 * using it (POST /api/admin/touch from AdminKeepAlive); once the quiet
 * stretch passes the TTL, the next request is a login.
 * - Owner: 8 hours (Chris, 09-27: the 5-minute cut "logs me out way too
 *   fast, it's just annoying at this point").
 * - Helper: still 5 minutes (Chris, 09-10: "time out users after 5 minutes",
 *   the helper stayed signed in on her own computer).
 */
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // owner, 8 hours idle
export const HELPER_SESSION_TTL_MS = 5 * 60 * 1000; // helper, 5 minutes idle
/**
 * Hard limits from the sign-in itself (#32, audit 10-16): touches keep a
 * session alive only this long after the login that started it, so a cookie
 * copied off a machine can't be kept alive forever. Owner a week, helper 12 h.
 */
export const ADMIN_MAX_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
export const HELPER_MAX_LIFE_MS = 12 * 60 * 60 * 1000;
export const maxLifeOf = (role: AdminRole) => (role === "helper" ? HELPER_MAX_LIFE_MS : ADMIN_MAX_LIFE_MS);
/** A token that expires further out than its TTL was issued under an older rule: refuse it. */
const CLOCK_SKEW_MS = 60 * 1000;
export function tokenLifeOk(expiresAt: number, now: number, ttl = ADMIN_SESSION_TTL_MS): boolean {
  return Number.isFinite(expiresAt) && expiresAt > now && expiresAt - now <= ttl + CLOCK_SKEW_MS;
}

export interface AdminCredentials {
  user: string;
  password: string;
}

// The owner username defaults to "admin" (not a secret). There is no built-in
// password (10-16, A-H #23): with ADMIN_PANEL_PASSWORD unset the owner login is
// off everywhere, local dev included (.env.local sets it there).
const DEFAULT_USER = "admin";

let warnedNoPassword = false;

/**
 * An empty password means "no owner login": verifyAdminCredentials and the
 * session checks refuse it.
 */
export function adminCredentials(env: NodeJS.ProcessEnv = process.env): AdminCredentials {
  const user = env.ADMIN_PANEL_USER?.trim() || DEFAULT_USER;
  if (env.ADMIN_PANEL_PASSWORD) return { user, password: env.ADMIN_PANEL_PASSWORD };
  if (!warnedNoPassword) {
    warnedNoPassword = true;
    console.warn("ADMIN_PANEL_PASSWORD is not set: the admin console login is disabled.");
  }
  return { user, password: "" };
}

/** True when the panel has no owner password set (the login is off). */
export function adminUsingDefaults(env: NodeJS.ProcessEnv = process.env): boolean {
  return !adminCredentials(env).password;
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
  if (!creds.password) return false; // fail closed: no password configured
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

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

/**
 * The app secret mixed into the session key. Production has EBAY_TOKEN_KEY (it also seals eBay tokens); without
 * it or EBAY_CLIENT_SECRET there is NO admin session on production (#32: the old "cardflip" fallback left the
 * password as the only secret). Local dev without either still works on a fixed dev-only value.
 */
function appSecret(env: NodeJS.ProcessEnv): string | null {
  const secret = env.EBAY_TOKEN_KEY || env.EBAY_CLIENT_SECRET;
  if (secret) return secret;
  return isProduction(env) ? null : "cardflip-dev-only";
}

/** False when this server cannot sign admin sessions at all (production with no app secret). */
export function adminSessionsAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return appSecret(env) !== null;
}

function signingKey(creds: AdminCredentials, env: NodeJS.ProcessEnv): Buffer | null {
  const secret = appSecret(env);
  if (!secret) return null;
  return createHmac("sha256", `${creds.user}:${creds.password}:${secret}`).update("admin-session-key").digest();
}

/** "x" is never a valid MAC: a server with no key hands out tokens nothing will accept. */
function mac(key: Buffer | null, payload: string): string {
  return key ? createHmac("sha256", key).update(payload).digest("base64url") : "x";
}

/**
 * Owner token "<expiresAtMs>.<loginAtMs>.<hmac>". loginAt is the sign-in that started the session; a touch keeps
 * it, so the hard limit (ADMIN_MAX_LIFE_MS) and a sign-out (adminGate.endAdminSession) cover every re-signed copy.
 */
export function signAdminToken(now = Date.now(), creds = adminCredentials(), env: NodeJS.ProcessEnv = process.env, loginAt = now): { token: string; expiresAt: number } {
  const expiresAt = Math.min(now + ADMIN_SESSION_TTL_MS, loginAt + ADMIN_MAX_LIFE_MS);
  return { token: `${expiresAt}.${loginAt}.${mac(signingKey(creds, env), `${expiresAt}.${loginAt}`)}`, expiresAt };
}

export interface AdminSession {
  role: AdminRole;
  expiresAt: number;
  loginAt: number;
}

function lifeOk(expiresAt: number, loginAt: number, now: number, ttl: number, maxLife: number): boolean {
  return (
    tokenLifeOk(expiresAt, now, ttl) &&
    Number.isFinite(loginAt) &&
    loginAt <= now + CLOCK_SKEW_MS &&
    now - loginAt <= maxLife &&
    expiresAt <= loginAt + maxLife + CLOCK_SKEW_MS
  );
}

function ownerSession(token: string, now: number, creds: AdminCredentials, env: NodeJS.ProcessEnv): AdminSession | null {
  if (!creds.password) return null;
  const m = /^(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return null;
  const expiresAt = Number(m[1]);
  const loginAt = Number(m[2]);
  if (!lifeOk(expiresAt, loginAt, now, ADMIN_SESSION_TTL_MS, ADMIN_MAX_LIFE_MS)) return null;
  const key = signingKey(creds, env);
  return key && safeEqual(m[3], mac(key, `${expiresAt}.${loginAt}`)) ? { role: "owner", expiresAt, loginAt } : null;
}

export function verifyAdminToken(token: string | undefined | null, now = Date.now(), creds = adminCredentials(), env: NodeJS.ProcessEnv = process.env): boolean {
  return token ? ownerSession(token, now, creds, env) !== null : false;
}

/**
 * Helper session: "<expiresAtMs>.h.<loginAtMs>.<hmac>" signed with the helper's own
 * credentials, so the owner's key never verifies it and changing the helper
 * password ends her sessions alone. The ".h." segment is inside the MAC.
 */
export function signHelperToken(now = Date.now(), creds = helperCredentials(), env: NodeJS.ProcessEnv = process.env, loginAt = now): { token: string; expiresAt: number } {
  if (!creds) throw new Error("No helper login is configured");
  const expiresAt = Math.min(now + HELPER_SESSION_TTL_MS, loginAt + HELPER_MAX_LIFE_MS);
  return { token: `${expiresAt}.h.${loginAt}.${mac(signingKey(creds, env), `h:${expiresAt}.${loginAt}`)}`, expiresAt };
}

/** The session a cookie value carries (role + when its sign-in happened), or null. */
export function adminSessionOf(token: string | undefined | null, now = Date.now(), env: NodeJS.ProcessEnv = process.env): AdminSession | null {
  if (!token) return null;
  const owner = ownerSession(token, now, adminCredentials(env), env);
  if (owner) return owner;
  const m = /^(\d+)\.h\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token);
  const creds = helperCredentials(env);
  if (!m || !creds) return null;
  const expiresAt = Number(m[1]);
  const loginAt = Number(m[2]);
  if (!lifeOk(expiresAt, loginAt, now, HELPER_SESSION_TTL_MS, HELPER_MAX_LIFE_MS)) return null;
  const key = signingKey(creds, env);
  return key && safeEqual(m[3], mac(key, `h:${expiresAt}.${loginAt}`)) ? { role: "helper", expiresAt, loginAt } : null;
}

/** Which role a cookie value carries — owner, helper, or nothing. (Signature only: adminGate also checks sign-outs.) */
export function adminRoleOf(token: string | undefined | null, now = Date.now(), env: NodeJS.ProcessEnv = process.env): AdminRole | null {
  return adminSessionOf(token, now, env)?.role ?? null;
}