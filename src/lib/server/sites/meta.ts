import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getSetting, setSetting } from "@/lib/server/settings";
import type { SocialSite, SitePost } from "@/lib/server/socialPublish";

/**
 * Meta adapters (docs/SOCIAL-AUTOPILOT.md §3): Facebook Page, Instagram and
 * Threads, one file, three sites, because each surface has its own id,
 * token and post URL and the publisher tracks slots per site. One Meta
 * developer app covers all three; Chris does the clicks once and pastes:
 *
 *   META_PAGE_TOKEN (+ optional META_PAGE_ID) Facebook Page (page OR user token, see fbCreds)
 *   INSTAGRAM_TOKEN                       Instagram (Instagram Login; or META_IG_USER_ID + META_PAGE_TOKEN via the Page)
 *   THREADS_TOKEN (+ optional THREADS_USER_ID)  Threads (its own long-lived token)
 *
 * Facebook takes the picture as an upload. Instagram and Threads only take a
 * PUBLIC image URL, so the fitted picture is parked on our Vercel Blob store
 * (the same store the board photos use) for the length of the post and
 * deleted afterwards. Instagram wants JPEG; the publisher hands us PNG when
 * it fits, so we convert here.
 */
const GRAPH = process.env.META_GRAPH_BASE ?? "https://graph.facebook.com/v21.0";
const THREADS = process.env.THREADS_GRAPH_BASE ?? "https://graph.threads.net/v1.0";

export const FACEBOOK_MAX_CHARS = 5000;
export const INSTAGRAM_MAX_CHARS = 2200;
export const THREADS_MAX_CHARS = 500;
/** Instagram caps images at 8 MB; Threads and Facebook allow more, same cap keeps one picture. */
export const META_MAX_IMAGE_BYTES = 7_900_000;

/** Best-guess post URL when the API answers without a permalink. */
export function metaPostUrl(site: "facebook" | "instagram" | "threads", id: string): string {
  if (site === "facebook") return `https://www.facebook.com/${id}`;
  if (site === "instagram") return `https://www.instagram.com/p/${id}/`;
  return `https://www.threads.net/post/${id}`;
}

async function graph<T>(url: string, init: RequestInit, step: string): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${step} ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}
const FORM = { "content-type": "application/x-www-form-urlencoded" };

/** Instagram refuses PNG through image_url; give every Meta surface a JPEG. */
async function asJpeg(p: SitePost): Promise<Buffer> {
  if (p.mime === "image/jpeg") return p.image;
  const sharp = (await import("sharp")).default;
  return sharp(p.image).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** Park a picture on the public Blob store; returns the URL and a cleanup. */
async function parkImage(site: string, jpeg: Buffer): Promise<{ url: string; done: () => Promise<void> }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error(`${site}: BLOB_READ_WRITE_TOKEN missing (needed to hand Meta a public image URL)`);
  const { put, del } = await import("@vercel/blob");
  const blob = await put(`social/${site}/${randomUUID()}.jpg`, jpeg, {
    access: "public",
    addRandomSuffix: false,
    contentType: "image/jpeg",
  });
  return {
    url: blob.url,
    done: async () => {
      try {
        await del(blob.url);
      } catch {
        /* a leftover picture costs nothing that matters */
      }
    },
  };
}

/** Meta media containers are async; poll until FINISHED (or give up after ~1 min). */
async function waitForContainer(url: string, step: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const j = await graph<{ status_code?: string; status?: string }>(url, {}, `${step} status`);
    const status = j.status_code ?? j.status ?? "FINISHED";
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`${step}: container ${status}`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`${step}: container never finished`);
}

/* ---------- 60-day tokens (Instagram Login + Threads) ---------- */

/**
 * Instagram Login and Threads tokens are long-lived but die after 60 days.
 * Both APIs hand out a fresh 60-day token from GET /refresh_access_token
 * once the current one is over a day old, so the publisher calls
 * refreshMetaTokens() on every scheduled run and each token is renewed
 * weekly, hands off. The renewed token lives in the settings table
 * (social_token:<site>); the env var Chris pasted stays as the seed. A
 * stored token is only used while it descends from the CURRENT env token
 * (fingerprint check), so a freshly pasted env token always wins.
 */
export const TOKEN_PREFIX = "social_token:";
export const TOKEN_REFRESHED_PREFIX = "social_token_refreshed:";
export const REFRESH_EVERY_MS = 7 * 86_400_000;

type RefreshSite = "instagram" | "threads";
const REFRESH: Record<RefreshSite, { env: string; grant: string; base: () => string }> = {
  instagram: { env: "INSTAGRAM_TOKEN", grant: "ig_refresh_token", base: () => IG_LOGIN },
  threads: { env: "THREADS_TOKEN", grant: "th_refresh_token", base: () => THREADS },
};

function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/** The token to post with: the latest refreshed one for this env seed, else the env token. */
export async function liveToken(site: RefreshSite): Promise<string | null> {
  const seed = process.env[REFRESH[site].env]?.trim();
  if (!seed) return null;
  try {
    const raw = await getSetting(`${TOKEN_PREFIX}${site}`);
    const stored = raw ? (JSON.parse(raw) as { token?: string; from?: string }) : null;
    if (stored?.token && stored.from === fingerprint(seed)) return stored.token;
  } catch {
    /* unreadable row = fall back to the env token */
  }
  return seed;
}

export interface TokenRefreshReport {
  site: RefreshSite;
  status: "off" | "skipped" | "refreshed" | "failed";
  reason?: string;
  /** Days the new token is good for (Meta answers in seconds). */
  expiresDays?: number;
}

/** Renew every 60-day token that is a week past its last renewal (or its first sighting). */
export async function refreshMetaTokens(now = Date.now()): Promise<TokenRefreshReport[]> {
  const out: TokenRefreshReport[] = [];
  for (const site of Object.keys(REFRESH) as RefreshSite[]) {
    const cfg = REFRESH[site];
    const seed = process.env[cfg.env]?.trim();
    if (!seed) {
      out.push({ site, status: "off" });
      continue;
    }
    const from = fingerprint(seed);
    const clockKey = `${TOKEN_REFRESHED_PREFIX}${site}`;
    let clock: { at?: number; from?: string } | null = null;
    try {
      const raw = await getSetting(clockKey);
      clock = raw ? (JSON.parse(raw) as { at?: number; from?: string }) : null;
    } catch {
      clock = null;
    }
    if (!clock?.at || clock.from !== from) {
      // New env token (or first run): start its clock; Meta refuses refreshes under a day old anyway.
      await setSetting(clockKey, JSON.stringify({ at: now, from }));
      out.push({ site, status: "skipped", reason: "clock started for a new token" });
      continue;
    }
    if (now - clock.at < REFRESH_EVERY_MS) {
      out.push({ site, status: "skipped", reason: `renewed ${Math.floor((now - clock.at) / 86_400_000)}d ago` });
      continue;
    }
    try {
      const current = (await liveToken(site)) ?? seed;
      const j = await graph<{ access_token?: string; expires_in?: number }>(
        `${cfg.base()}/refresh_access_token?grant_type=${cfg.grant}&access_token=${encodeURIComponent(current)}`,
        {},
        `${site} refresh`,
      );
      if (!j.access_token) throw new Error(`${site} refresh: no access_token in response`);
      await setSetting(`${TOKEN_PREFIX}${site}`, JSON.stringify({ token: j.access_token, from }));
      await setSetting(clockKey, JSON.stringify({ at: now, from }));
      out.push({ site, status: "refreshed", expiresDays: j.expires_in ? Math.round(j.expires_in / 86_400) : undefined });
    } catch (err) {
      // Token stays as it was; the next run tries again (the old token has weeks left).
      out.push({ site, status: "failed", reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/* ---------- Facebook Page ---------- */

/**
 * META_PAGE_TOKEN may be a Page token OR a user token (the Graph API
 * Explorer hands out either): a user token is swapped for the Page token
 * through /me/accounts (long-lived in, long-lived out). META_PAGE_ID is
 * optional and only picks a Page when the user manages several.
 */
function fbCreds() {
  const token = process.env.META_PAGE_TOKEN?.trim();
  return token ? { pageId: process.env.META_PAGE_ID?.trim() || "", token } : null;
}

let pageCache: { pageId: string; token: string } | null = null;

async function resolvePage(c: { pageId: string; token: string }): Promise<{ pageId: string; token: string }> {
  if (pageCache) return pageCache;
  const accounts = await graph<{ data?: Array<{ id: string; name?: string; access_token?: string }> }>(
    `${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(c.token)}`,
    {},
    "facebook accounts",
  ).catch(() => ({ data: [] as Array<{ id: string; access_token?: string }> }));
  const pages = accounts.data ?? [];
  const page = (c.pageId ? pages.find((p) => p.id === c.pageId) : pages[0]) ?? null;
  if (page?.access_token) {
    pageCache = { pageId: page.id, token: page.access_token };
    return pageCache;
  }
  // No manageable pages listed: the token is (hopefully) a Page token already.
  const me = await graph<{ id?: string }>(`${GRAPH}/me?fields=id&access_token=${encodeURIComponent(c.token)}`, {}, "facebook me");
  pageCache = { pageId: c.pageId || me.id || "me", token: c.token };
  return pageCache;
}

export const facebook: SocialSite = {
  id: "facebook",
  label: "Facebook",
  maxChars: FACEBOOK_MAX_CHARS,
  maxImageBytes: META_MAX_IMAGE_BYTES,
  connected: () => fbCreds() !== null,
  async post(p: SitePost): Promise<{ uri: string }> {
    const creds = fbCreds();
    if (!creds) throw new Error("facebook: not connected");
    const c = await resolvePage(creds);
    const fd = new FormData();
    fd.append("access_token", c.token);
    fd.append("message", p.text);
    fd.append("alt_text_custom", p.alt.slice(0, 1000));
    fd.append("source", new Blob([new Uint8Array(await asJpeg(p))], { type: "image/jpeg" }), "card.jpg");
    const j = await graph<{ id?: string; post_id?: string }>(`${GRAPH}/${c.pageId}/photos`, { method: "POST", body: fd }, "facebook photos");
    const id = j.post_id ?? j.id;
    if (!id) throw new Error("facebook photos: no id in response");
    return { uri: metaPostUrl("facebook", id) };
  },
};

/* ---------- Instagram ---------- */

/**
 * Two ways in: INSTAGRAM_TOKEN from "Instagram API with Instagram Login"
 * (no Facebook Page needed, graph.instagram.com, /me) — or the older
 * Page-linked route (META_IG_USER_ID + META_PAGE_TOKEN, graph.facebook.com).
 */
const IG_LOGIN = process.env.INSTAGRAM_GRAPH_BASE ?? "https://graph.instagram.com/v21.0";

function igCreds(): { base: string; userId: string; token: string } | null {
  const loginToken = process.env.INSTAGRAM_TOKEN?.trim();
  if (loginToken) return { base: IG_LOGIN, userId: "me", token: loginToken };
  const userId = process.env.META_IG_USER_ID?.trim();
  const token = process.env.META_PAGE_TOKEN?.trim();
  return userId && token ? { base: GRAPH, userId, token } : null;
}

export const instagram: SocialSite = {
  id: "instagram",
  label: "Instagram",
  maxChars: INSTAGRAM_MAX_CHARS,
  maxImageBytes: META_MAX_IMAGE_BYTES,
  connected: () => igCreds() !== null,
  async post(p: SitePost): Promise<{ uri: string }> {
    const c = igCreds();
    if (!c) throw new Error("instagram: not connected");
    if (c.base === IG_LOGIN) c.token = (await liveToken("instagram")) ?? c.token;
    const parked = await parkImage("instagram", await asJpeg(p));
    try {
      const container = await graph<{ id?: string }>(
        `${c.base}/${c.userId}/media`,
        { method: "POST", headers: FORM, body: form({ image_url: parked.url, caption: p.text, alt_text: p.alt.slice(0, 1000), access_token: c.token }) },
        "instagram media",
      );
      if (!container.id) throw new Error("instagram media: no container id");
      await waitForContainer(`${c.base}/${container.id}?fields=status_code&access_token=${encodeURIComponent(c.token)}`, "instagram media");
      const published = await graph<{ id?: string }>(
        `${c.base}/${c.userId}/media_publish`,
        { method: "POST", headers: FORM, body: form({ creation_id: container.id, access_token: c.token }) },
        "instagram media_publish",
      );
      if (!published.id) throw new Error("instagram media_publish: no id");
      const info = await graph<{ permalink?: string; shortcode?: string }>(
        `${c.base}/${published.id}?fields=permalink,shortcode&access_token=${encodeURIComponent(c.token)}`,
        {},
        "instagram permalink",
      ).catch(() => ({}) as { permalink?: string; shortcode?: string });
      return { uri: info.permalink ?? metaPostUrl("instagram", info.shortcode ?? published.id) };
    } finally {
      await parked.done();
    }
  },
};

/* ---------- Threads ---------- */

/** THREADS_USER_ID is optional: the token knows whose it is (GET /me). */
function threadsCreds() {
  const token = process.env.THREADS_TOKEN?.trim();
  return token ? { userId: process.env.THREADS_USER_ID?.trim() || "me", token } : null;
}

export const threads: SocialSite = {
  id: "threads",
  label: "Threads",
  maxChars: THREADS_MAX_CHARS,
  maxImageBytes: META_MAX_IMAGE_BYTES,
  connected: () => threadsCreds() !== null,
  async post(p: SitePost): Promise<{ uri: string }> {
    const c = threadsCreds();
    if (!c) throw new Error("threads: not connected");
    c.token = (await liveToken("threads")) ?? c.token;
    const parked = await parkImage("threads", await asJpeg(p));
    try {
      const container = await graph<{ id?: string }>(
        `${THREADS}/${c.userId}/threads`,
        { method: "POST", headers: FORM, body: form({ media_type: "IMAGE", image_url: parked.url, text: p.text, alt_text: p.alt.slice(0, 1000), access_token: c.token }) },
        "threads container",
      );
      if (!container.id) throw new Error("threads: no container id");
      await waitForContainer(`${THREADS}/${container.id}?fields=status&access_token=${encodeURIComponent(c.token)}`, "threads container");
      const published = await graph<{ id?: string }>(
        `${THREADS}/${c.userId}/threads_publish`,
        { method: "POST", headers: FORM, body: form({ creation_id: container.id, access_token: c.token }) },
        "threads publish",
      );
      if (!published.id) throw new Error("threads publish: no id");
      const info = await graph<{ permalink?: string }>(
        `${THREADS}/${published.id}?fields=permalink&access_token=${encodeURIComponent(c.token)}`,
        {},
        "threads permalink",
      ).catch(() => ({}) as { permalink?: string });
      return { uri: info.permalink ?? metaPostUrl("threads", published.id) };
    } finally {
      await parked.done();
    }
  },
};
