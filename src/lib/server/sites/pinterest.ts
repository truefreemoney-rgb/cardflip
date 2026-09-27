import "server-only";
import { createHash } from "node:crypto";
import { getSetting, setSetting } from "@/lib/server/settings";
import type { SocialSite, SitePost } from "@/lib/server/socialPublish";

/**
 * Pinterest adapter (docs/SOCIAL-AUTOPILOT.md §5): a pin per post = the
 * rendered picture + a link back to cardflip.io. Pictures only; Pinterest is a
 * search engine for images, the movers/dips/set cards are exactly what it
 * indexes. Same shape as TikTok: real OAuth2, not a pasted token. Chris makes
 * the business account, creates the app at developers.pinterest.com, pastes
 * the id + secret, then clicks "connect" on /admin/social once
 * (api/social/pinterest/connect → pinterest.com consent →
 * api/social/pinterest/callback). Tokens live in settings
 * (social_token:pinterest) and refresh themselves (access 30d, refresh 365d).
 *
 *   PINTEREST_APP_ID / PINTEREST_APP_SECRET   the developer app (Vercel env)
 *   PINTEREST_BOARD                           board name, default "Pokémon Card Prices";
 *                                             created on first post if missing
 *   PINTEREST_HANDLE                          username, default cardflipio
 *
 * A trial-access app may only pin to the owner's own account, which is all we
 * do; standard access (public data) is never needed.
 */
const API = process.env.PINTEREST_API_BASE ?? "https://api.pinterest.com";
const AUTH = "https://www.pinterest.com/oauth/";
export const PINTEREST_SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write"];
/** Pin description cap; the title is the first line, cut to 100. */
export const PINTEREST_MAX_CHARS = 500;
export const PINTEREST_TITLE_MAX = 100;
export const PINTEREST_TOKEN_KEY = "social_token:pinterest";
export const PINTEREST_STATE_KEY = "social_oauth_state:pinterest";
export const PINTEREST_BOARD_KEY = "social_pinterest_board";
const REFRESH_AHEAD_MS = 10 * 60_000;

interface StoredToken {
  access_token: string;
  refresh_token: string;
  /** ms epoch */
  expires_at: number;
  refresh_expires_at: number;
  scope: string;
  /** Fingerprint of the app id the tokens were minted for; a new app = reconnect. */
  from: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
  message?: string;
}

function creds(): { id: string; secret: string } | null {
  const id = process.env.PINTEREST_APP_ID?.trim();
  const secret = process.env.PINTEREST_APP_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

function fingerprint(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

export function pinterestHandle(): string {
  return (process.env.PINTEREST_HANDLE ?? "cardflipio").replace(/^@/, "");
}

export function pinterestBoardName(): string {
  return process.env.PINTEREST_BOARD?.trim() || "Pokémon Card Prices";
}

export function pinterestRedirectUri(origin: string): string {
  return process.env.PINTEREST_REDIRECT_URI ?? `${origin}/api/social/pinterest/callback`;
}

/** The consent URL for /admin/social's connect link. */
export function pinterestAuthUrl(origin: string, state: string): string {
  const c = creds();
  if (!c) throw new Error("pinterest: PINTEREST_APP_ID / PINTEREST_APP_SECRET missing");
  const q = new URLSearchParams({
    client_id: c.id,
    redirect_uri: pinterestRedirectUri(origin),
    response_type: "code",
    scope: PINTEREST_SCOPES.join(","),
    state,
  });
  return `${AUTH}?${q}`;
}

/**
 * Split one caption into Pinterest's title + description: the first line (up
 * to 100 chars, cut at a word) is the title, the whole text (≤500) the
 * description. Pure, so the test can pin it down.
 */
export function pinterestFields(text: string): { title: string; description: string } {
  const clean = text.replace(/\r/g, "").trim();
  const firstLine = clean.split("\n")[0]?.trim() ?? "";
  let title = firstLine;
  if (title.length > PINTEREST_TITLE_MAX) {
    const cut = title.slice(0, PINTEREST_TITLE_MAX - 1);
    const sp = cut.lastIndexOf(" ");
    title = (sp > 40 ? cut.slice(0, sp) : cut).trimEnd() + "…";
  }
  const description = clean.length > PINTEREST_MAX_CHARS ? clean.slice(0, PINTEREST_MAX_CHARS - 1).trimEnd() + "…" : clean;
  return { title: title || "CardFlip", description };
}

async function tokenCall(fields: Record<string, string>, step: string, keepRefresh?: string): Promise<StoredToken> {
  const c = creds();
  if (!c) throw new Error("pinterest: app credentials missing");
  const res = await fetch(`${API}/v5/oauth/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let j: TokenResponse = {};
  try {
    j = JSON.parse(text) as TokenResponse;
  } catch {
    /* non-JSON error page */
  }
  const refresh = j.refresh_token ?? keepRefresh;
  if (!res.ok || !j.access_token || !refresh) throw new Error(`pinterest ${step} ${res.status}: ${j.error_description ?? j.message ?? j.error ?? text.slice(0, 200)}`);
  const now = Date.now();
  return {
    access_token: j.access_token,
    refresh_token: refresh,
    expires_at: now + (j.expires_in ?? 30 * 86_400) * 1000,
    // A refresh reply carries no refresh_token_expires_in; the old one keeps its clock.
    refresh_expires_at: j.refresh_token_expires_in ? now + j.refresh_token_expires_in * 1000 : now + 365 * 86_400 * 1000,
    scope: j.scope ?? "",
    from: fingerprint(c.id),
  };
}

/** Callback step: swap the consent code for tokens and keep them. */
export async function pinterestExchangeCode(code: string, origin: string): Promise<StoredToken> {
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: pinterestRedirectUri(origin) }, "token exchange");
  await setSetting(PINTEREST_TOKEN_KEY, JSON.stringify(t));
  await setSetting(PINTEREST_BOARD_KEY, "");
  return t;
}

async function stored(): Promise<StoredToken | null> {
  const c = creds();
  if (!c) return null;
  try {
    const raw = await getSetting(PINTEREST_TOKEN_KEY);
    const t = raw ? (JSON.parse(raw) as StoredToken) : null;
    if (!t?.access_token || !t.refresh_token || t.from !== fingerprint(c.id)) return null;
    return t;
  } catch {
    return null;
  }
}

/** A usable access token, refreshed when it is about to expire. Null = never connected (or a new app id). */
export async function pinterestAccessToken(): Promise<string | null> {
  const t = await stored();
  if (!t) return null;
  if (t.expires_at - Date.now() > REFRESH_AHEAD_MS) return t.access_token;
  if (t.refresh_expires_at < Date.now()) throw new Error("pinterest: refresh token expired, reconnect on /admin/social");
  const fresh = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh_token, scope: PINTEREST_SCOPES.join(",") }, "token refresh", t.refresh_token);
  fresh.refresh_expires_at = Math.min(fresh.refresh_expires_at, t.refresh_expires_at);
  await setSetting(PINTEREST_TOKEN_KEY, JSON.stringify(fresh));
  return fresh.access_token;
}

async function api<T>(path: string, token: string, step: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let j: { code?: number; message?: string } = {};
  try {
    j = JSON.parse(text) as { code?: number; message?: string };
  } catch {
    /* fall through to the status check */
  }
  if (!res.ok) throw new Error(`pinterest ${step} ${res.status}${j.code ? ` [${j.code}]` : ""}: ${j.message ?? text.slice(0, 200)}`);
  return j as T;
}

interface Board {
  id: string;
  name: string;
}

/** The board id we pin to: cached in settings, else found by name, else created (public). */
async function boardId(token: string): Promise<string> {
  const cached = await getSetting(PINTEREST_BOARD_KEY);
  if (cached) return cached;
  const want = pinterestBoardName().toLowerCase();
  let bookmark: string | undefined;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ page_size: "100", ...(bookmark ? { bookmark } : {}) });
    const list = await api<{ items?: Board[]; bookmark?: string | null }>(`/v5/boards?${q}`, token, "boards");
    const hit = list.items?.find((b) => b.name.trim().toLowerCase() === want);
    if (hit) {
      await setSetting(PINTEREST_BOARD_KEY, hit.id);
      return hit.id;
    }
    if (!list.bookmark) break;
    bookmark = list.bookmark;
  }
  const made = await api<Board>("/v5/boards", token, "create board", {
    name: pinterestBoardName(),
    description: "Live Pokémon card prices, weekly movers and dips from cardflip.io",
    privacy: "PUBLIC",
  });
  if (!made.id) throw new Error("pinterest create board: no id");
  await setSetting(PINTEREST_BOARD_KEY, made.id);
  return made.id;
}

export const pinterest: SocialSite = {
  id: "pinterest",
  label: "Pinterest",
  maxChars: PINTEREST_MAX_CHARS,
  maxImageBytes: 7_900_000,
  connectPath: "/api/social/pinterest/connect",
  connected: () => creds() !== null,
  authorized: async () => (await stored()) !== null,
  async post(p: SitePost) {
    const token = await pinterestAccessToken();
    if (!token) throw new Error("pinterest: not connected, open /admin/social and connect");
    const board = await boardId(token);
    const { title, description } = pinterestFields(p.text);
    const pin = await api<{ id?: string }>("/v5/pins", token, "create pin", {
      board_id: board,
      title,
      description,
      alt_text: p.alt.slice(0, 500),
      link: "https://cardflip.io/",
      media_source: { source_type: "image_base64", content_type: p.mime === "image/jpeg" ? "image/jpeg" : "image/png", data: p.image.toString("base64") },
    });
    if (!pin.id) throw new Error("pinterest create pin: no id");
    return { uri: `https://www.pinterest.com/pin/${pin.id}/` };
  },
};
