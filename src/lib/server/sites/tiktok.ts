import "server-only";
import { createHash } from "node:crypto";
import { getSetting, setSetting } from "@/lib/server/settings";
import type { SocialSite, SitePost } from "@/lib/server/socialPublish";

/**
 * TikTok adapter (docs/SOCIAL-AUTOPILOT.md §3, Chris 09-25: TikTok is "top of
 * the list"). Video only: TikTok has no picture post worth making, so the
 * publisher skips it on slots without a rendered MP4 (videoOnly).
 *
 * Unlike the Meta sites there is no paste-a-token shortcut. TikTok's Content
 * Posting API is real OAuth2: Chris clicks "connect" on /admin/social once
 * (api/social/tiktok/connect → tiktok.com consent → api/social/tiktok/callback),
 * the tokens land in the settings table (social_token:tiktok) and refresh
 * themselves (access 24h, refresh 365d, every refresh hands back a new pair).
 *
 *   TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET   the developer app (Vercel env)
 *   TIKTOK_HANDLE                              username, default cardflipio
 *   TIKTOK_PRIVACY                             PUBLIC_TO_EVERYONE once the app
 *                                              passes audit; unaudited apps may
 *                                              only post SELF_ONLY (private).
 *
 * Post = creator_info/query (required first call) → video/init FILE_UPLOAD
 * (one chunk, our clips are a few MB) → PUT the bytes → poll status/fetch
 * until PUBLISH_COMPLETE.
 */
const API = process.env.TIKTOK_API_BASE ?? "https://open.tiktokapis.com";
const AUTH = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.upload"];
export const TIKTOK_MAX_CHARS = 2200;
export const TIKTOK_TOKEN_KEY = "social_token:tiktok";
export const TIKTOK_STATE_KEY = "social_oauth_state:tiktok";
/** TikTok caps one chunk at 64 MB; a single chunk is fine for anything under that. */
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
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

/** The consent URL for /admin/social's connect link. */
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
  if (t.refresh_expires_at < Date.now()) throw new Error("tiktok: refresh token expired, reconnect on /admin/social");
  const fresh = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh_token }, "token refresh");
  await setSetting(TIKTOK_TOKEN_KEY, JSON.stringify(fresh));
  return fresh.access_token;
}

interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

async function api<T>(path: string, token: string, body: unknown, step: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let j: ApiEnvelope<T> = {};
  try {
    j = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    /* fall through to the status check */
  }
  if (!res.ok || (j.error?.code && j.error.code !== "ok")) {
    // TikTok's messages are generic ("review our integration guidelines"); the code says what happened
    // (e.g. unaudited_client_can_only_post_to_private_accounts = make the TikTok account private until the audit).
    const code = j.error?.code && j.error.code !== "ok" ? ` [${j.error.code}]` : "";
    throw new Error(`tiktok ${step} ${res.status}${code}: ${j.error?.message ?? text.slice(0, 200)}`);
  }
  return (j.data ?? {}) as T;
}

interface CreatorInfo {
  creator_username?: string;
  privacy_level_options?: string[];
  max_video_post_duration_sec?: number;
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
}

/** The privacy TikTok will accept: what we ask for if the account may, else private (unaudited apps). */
export function pickPrivacy(options: string[] | undefined, wanted = process.env.TIKTOK_PRIVACY ?? "SELF_ONLY"): string {
  const opts = options && options.length ? options : ["SELF_ONLY"];
  return opts.includes(wanted) ? wanted : "SELF_ONLY";
}

export const tiktok: SocialSite = {
  id: "tiktok",
  label: "TikTok",
  maxChars: TIKTOK_MAX_CHARS,
  maxImageBytes: 7_900_000,
  postsVideo: true,
  videoOnly: true,
  connectPath: "/api/social/tiktok/connect",
  connected: () => creds() !== null,
  authorized: async () => (await stored()) !== null,
  async post(p: SitePost) {
    if (!p.video) throw new Error("tiktok: video only, no MP4 for this post");
    const token = await tiktokAccessToken();
    if (!token) throw new Error("tiktok: not connected, open /admin/social and connect");
    const size = p.video.bytes.byteLength;
    if (size > MAX_SINGLE_CHUNK) throw new Error(`tiktok: video is ${Math.round(size / 1048576)} MB, over the single-chunk limit`);

    const who = await api<CreatorInfo>("/v2/post/publish/creator_info/query/", token, {}, "creator info");
    if (who.max_video_post_duration_sec && p.video.seconds > who.max_video_post_duration_sec) {
      throw new Error(`tiktok: video is ${p.video.seconds}s, account allows ${who.max_video_post_duration_sec}s`);
    }
    const init = await api<{ publish_id?: string; upload_url?: string }>(
      "/v2/post/publish/video/init/",
      token,
      {
        post_info: {
          title: p.text.slice(0, TIKTOK_MAX_CHARS),
          privacy_level: pickPrivacy(who.privacy_level_options),
          disable_duet: Boolean(who.duet_disabled),
          disable_comment: Boolean(who.comment_disabled),
          disable_stitch: Boolean(who.stitch_disabled),
          video_cover_timestamp_ms: 1000,
        },
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
      },
      "video init",
    );
    if (!init.publish_id || !init.upload_url) throw new Error("tiktok video init: no upload url");

    const up = await fetch(init.upload_url, {
      method: "PUT",
      headers: { "content-type": p.video.mime, "content-length": String(size), "content-range": `bytes 0-${size - 1}/${size}` },
      body: new Uint8Array(p.video.bytes),
      signal: AbortSignal.timeout(180_000),
    });
    if (!up.ok) throw new Error(`tiktok upload ${up.status}: ${(await up.text()).slice(0, 200)}`);

    let postId: string | undefined;
    let complete = false;
    for (let i = 0; i < 48 && !complete; i++) {
      const s = await api<{ status?: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> }>(
        "/v2/post/publish/status/fetch/",
        token,
        { publish_id: init.publish_id },
        "status",
      );
      if (s.status === "PUBLISH_COMPLETE") {
        postId = s.publicaly_available_post_id?.[0] !== undefined ? String(s.publicaly_available_post_id[0]) : undefined;
        complete = true;
        break;
      }
      if (s.status === "FAILED") throw new Error(`tiktok publish failed: ${s.fail_reason ?? "unknown"}`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
    if (!complete) throw new Error("tiktok: publish never completed");
    const handle = who.creator_username ?? tiktokHandle();
    return { uri: postId ? `https://www.tiktok.com/@${handle}/video/${postId}` : `https://www.tiktok.com/@${handle}` };
  },
};
