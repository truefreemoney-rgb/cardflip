import "server-only";
import type { SocialSite, SitePost } from "@/lib/server/socialPublish";

/**
 * Bluesky adapter (docs/SOCIAL-AUTOPILOT.md §2). Free API, no app review:
 * an app password from Chris (Settings → Privacy and security → App
 * passwords) is the whole connection. Env: BLUESKY_HANDLE (cardflipio.
 * bsky.social) + BLUESKY_APP_PASSWORD. Posts = one picture with alt text,
 * the caption, a link facet on cardflip.io and tag facets on the hashtags.
 */
const PDS = process.env.BLUESKY_PDS ?? "https://bsky.social";
/** Bluesky counts graphemes; ASCII + a few accents keeps chars ≈ graphemes. */
export const BLUESKY_MAX_CHARS = 300;
/** uploadBlob refuses images above 1,000,000 bytes. */
export const BLUESKY_MAX_IMAGE_BYTES = 950_000;

interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; uri?: string; tag?: string }>;
}

/** Link + tag facets by UTF-8 byte offset (the AT Protocol counts bytes). */
export function blueskyFacets(text: string): Facet[] {
  const enc = new TextEncoder();
  const facets: Facet[] = [];
  const at = (idx: number) => enc.encode(text.slice(0, idx)).length;
  for (const m of text.matchAll(/(?<![\w.@])cardflip\.io(?![\w])/g)) {
    facets.push({
      index: { byteStart: at(m.index), byteEnd: at(m.index + m[0].length) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://cardflip.io" }],
    });
  }
  for (const m of text.matchAll(/(?<![\w#])#([A-Za-z][A-Za-z0-9]*)/g)) {
    facets.push({
      index: { byteStart: at(m.index), byteEnd: at(m.index + m[0].length) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[1] }],
    });
  }
  return facets;
}

async function xrpc<T>(method: string, body: unknown, jwt?: string, contentType = "application/json"): Promise<T> {
  const res = await fetch(`${PDS}/xrpc/${method}`, {
    method: "POST",
    headers: { "content-type": contentType, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: contentType === "application/json" ? JSON.stringify(body) : new Uint8Array(body as Buffer),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`bluesky ${method} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export const bluesky: SocialSite = {
  id: "bluesky",
  label: "Bluesky",
  maxChars: BLUESKY_MAX_CHARS,
  maxImageBytes: BLUESKY_MAX_IMAGE_BYTES,
  connected: () => Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD),
  async post(p: SitePost): Promise<{ uri: string }> {
    const session = await xrpc<{ accessJwt: string; did: string }>("com.atproto.server.createSession", {
      identifier: process.env.BLUESKY_HANDLE,
      password: process.env.BLUESKY_APP_PASSWORD,
    });
    const upload = await xrpc<{ blob: unknown }>("com.atproto.repo.uploadBlob", p.image, session.accessJwt, p.mime);
    const record = await xrpc<{ uri: string }>(
      "com.atproto.repo.createRecord",
      {
        repo: session.did,
        collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post",
          text: p.text,
          facets: blueskyFacets(p.text),
          createdAt: new Date().toISOString(),
          embed: {
            $type: "app.bsky.embed.images",
            images: [{ alt: p.alt, image: upload.blob, aspectRatio: { width: p.width, height: p.height } }],
          },
        },
      },
      session.accessJwt,
    );
    const rkey = record.uri.split("/").pop();
    return { uri: `https://bsky.app/profile/${process.env.BLUESKY_HANDLE}/post/${rkey}` };
  },
};
