import "server-only";
import { randomUUID } from "node:crypto";
import type { SocialSite, SitePost } from "@/lib/server/socialPublish";

/**
 * Meta adapters (docs/SOCIAL-AUTOPILOT.md §3): Facebook Page, Instagram and
 * Threads, one file, three sites, because each surface has its own id,
 * token and post URL and the publisher tracks slots per site. One Meta
 * developer app covers all three; Chris does the clicks once and pastes:
 *
 *   META_PAGE_TOKEN (+ optional META_PAGE_ID) Facebook Page (long-lived page token)
 *   META_IG_USER_ID (+ META_PAGE_TOKEN)   Instagram business account linked to the page
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

/* ---------- Facebook Page ---------- */

/** META_PAGE_ID is optional: a Page token resolves /me to its own Page. */
function fbCreds() {
  const token = process.env.META_PAGE_TOKEN?.trim();
  return token ? { pageId: process.env.META_PAGE_ID?.trim() || "me", token } : null;
}

export const facebook: SocialSite = {
  id: "facebook",
  label: "Facebook",
  maxChars: FACEBOOK_MAX_CHARS,
  maxImageBytes: META_MAX_IMAGE_BYTES,
  connected: () => fbCreds() !== null,
  async post(p: SitePost): Promise<{ uri: string }> {
    const c = fbCreds();
    if (!c) throw new Error("facebook: not connected");
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

function igCreds() {
  const userId = process.env.META_IG_USER_ID?.trim();
  const token = process.env.META_PAGE_TOKEN?.trim();
  return userId && token ? { userId, token } : null;
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
    const parked = await parkImage("instagram", await asJpeg(p));
    try {
      const container = await graph<{ id?: string }>(
        `${GRAPH}/${c.userId}/media`,
        { method: "POST", headers: FORM, body: form({ image_url: parked.url, caption: p.text, alt_text: p.alt.slice(0, 1000), access_token: c.token }) },
        "instagram media",
      );
      if (!container.id) throw new Error("instagram media: no container id");
      await waitForContainer(`${GRAPH}/${container.id}?fields=status_code&access_token=${encodeURIComponent(c.token)}`, "instagram media");
      const published = await graph<{ id?: string }>(
        `${GRAPH}/${c.userId}/media_publish`,
        { method: "POST", headers: FORM, body: form({ creation_id: container.id, access_token: c.token }) },
        "instagram media_publish",
      );
      if (!published.id) throw new Error("instagram media_publish: no id");
      const info = await graph<{ permalink?: string; shortcode?: string }>(
        `${GRAPH}/${published.id}?fields=permalink,shortcode&access_token=${encodeURIComponent(c.token)}`,
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
