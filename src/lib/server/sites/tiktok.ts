import "server-only";
import { createHash } from "node:crypto";
import { getSetting, setSetting } from "@/lib/server/settings";

/**
 * TikTok, read-only (docs/SOCIAL-AUTOPILOT.md §3). TikTok is posted BY HAND
 * since 09-30: the developer app was refused for production ("Applications
 * intended for personal use or internal company use are not eligible"), so
 * API uploads could only ever be private, and Chris declined a paid posting
 * service. There is no adapter in the publisher any more and nothing here
 * uploads a video; the night render builds tomorrow's three videos and
 * /admin/social hands them over (lib/socialTiktok.ts).
 *
 * What is left is the OAuth token, which only the stats reader uses
 * (socialPulse.ts, video.list). It stays quiet without one:
 * tiktokAccessToken() returns null when no account was ever connected.
 * Chris clicks the consent link once (api/social/tiktok/connect →
 * tiktok.com consent → api/social/tiktok/callback), the tokens land in the
 * settings table (social_token:tiktok) and refresh themselves (access 24h,
 * refresh 365d, every refresh hands back a new pair).
 *
 *   TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET   the developer app (Vercel env)
 *   TIKTOK_HANDLE                              username, default cardflipio
 */
const API = process.env.TIKTOK_API_BASE ?? "https://open.tiktokapis.com";
const AUTH = "https://www.tiktok.com/v2/auth/authorize/";
// video.list (09-28) lets the social pulse read our own videos' counts; the
// app must have the scope enabled in the TikTok developer portal AND the
// account must reconnect once so the token carries it.
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.upload", "video.list"];
/** TikTok's caption limit; the night render fits the hand-posted caption to it (socialTiktok.ts). */
export const TIKTOK_MAX_CHARS = 2200;
export const TIKTOK_TOKEN_KEY = "social_token:tiktok";
export const TIKTOK_STATE_KEY = "social_oauth_state:tiktok";
const REFRESH_AHEAD_MS = 10 * 60_000;

interface StoredToken {
  access_token: string;
  refresh_token: string;
  /** ms epoch */
  expires_at: number;
  refresh_expires_at: number;
  open_id: string;
  scope: string;
  /** Fingerprint of the client key the tokens were minted for; a new app = reconnect. */
  from: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

function creds(): { key: string; secret: string } | null {
  const key = process.env.TIKTOK_CLIENT_KEY?.trim();
  const secret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  return key && secret ? { key, secret } : null;
}

function fingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function tiktokHandle(): string {
  return (process.env.TIKTOK_HANDLE ?? "cardflipio").replace(/^@/, "");
}

export function tiktokRedirectUri(origin: string): string {
  return process.env.TIKTOK_REDIRECT_URI ?? `${origin}/api/social/tiktok/callback`;
}

/** The consent URL for the connect route. */
export function tiktokAuthUrl(origin: string, state: string): string {
  const c = creds();
  if (!c) throw new Error("tiktok: TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET missing");
  const q = new URLSearchParams({
    client_key: c.key,
    scope: TIKTOK_SCOPES.join(","),
    response_type: "code",
    redirect_uri: tiktokRedirectUri(origin),
    state,
  });
  return `${AUTH}?${q}`;
}

async function tokenCall(fields: Record<string, string>, step: string): Promise<StoredToken> {
  const c = creds();
  if (!c) throw new Error("tiktok: app credentials missing");
  const res = await fetch(`${API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: c.key, client_secret: c.secret, ...fields }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let j: TokenResponse = {};
  try {
    j = JSON.parse(text) as TokenResponse;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || !j.access_token || !j.refresh_token) throw new Error(`tiktok ${step} ${res.status}: ${j.error_description ?? j.error ?? text.slice(0, 200)}`);
  const now = Date.now();
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: now + (j.expires_in ?? 86_400) * 1000,
    refresh_expires_at: now + (j.refresh_expires_in ?? 365 * 86_400) * 1000,
    open_id: j.open_id ?? "",
    scope: j.scope ?? "",
    from: fingerprint(c.key),
  };
}

/** Callback step: swap the consent code for tokens and keep them. */
export async function tiktokExchangeCode(code: string, origin: string): Promise<StoredToken> {
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: tiktokRedirectUri(origin) }, "token exchange");
  await setSetting(TIKTOK_TOKEN_KEY, JSON.stringify(t));
  return t;
}

async function stored(): Promise<StoredToken | null> {
  const c = creds();
  if (!c) return null;
  try {
    const raw = await getSetting(TIKTOK_TOKEN_KEY);
    const t = raw ? (JSON.parse(raw) as StoredToken) : null;
    if (!t?.access_token || !t.refresh_token || t.from !== fingerprint(c.key)) return null;
    return t;
  } catch {
    return null;
  }
}

/** A usable access token, refreshed when it is about to expire. Null = never connected (or a new app key). */
export async function tiktokAccessToken(): Promise<string | null> {
  const t = await stored();
  if (!t) return null;
  if (t.expires_at - Date.now() > REFRESH_AHEAD_MS) return t.access_token;
  if (t.refresh_expires_at < Date.now()) throw new Error("tiktok: refresh token expired, reconnect");
  const fresh = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh_token }, "token refresh");
  await setSetting(TIKTOK_TOKEN_KEY, JSON.stringify(fresh));
  return fresh.access_token;
}
