import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { SocialSite, SitePost } from "@/lib/server/socialPublish";

/**
 * X adapter (docs/SOCIAL-AUTOPILOT.md §4). Free tier: 1,500 posts/month,
 * image upload allowed, no app review. Chris makes the developer app once
 * (developer.x.com → project → app → Keys and tokens, app permissions
 * Read and write, then regenerate the access token) and pastes four values
 * on his board row. Env: X_API_KEY + X_API_SECRET (the app) and
 * X_ACCESS_TOKEN + X_ACCESS_SECRET (the @cardflipio user). Optional
 * X_HANDLE only prettifies the returned post URL.
 *
 * Flow per post: OAuth 1.0a user-context signing (HMAC-SHA1, done here with
 * node:crypto, no SDK), upload the picture (v2 media upload, v1.1 fallback),
 * attach alt text, then POST /2/tweets with the media id.
 */
const API = process.env.X_API_BASE ?? "https://api.x.com";
const UPLOAD_V1 = process.env.X_UPLOAD_BASE ?? "https://upload.twitter.com";
/** 280 minus a t.co link (23) so a caption ending in cardflip.io still fits. */
export const X_MAX_CHARS = 257;
/** X takes images up to 5 MB. */
export const X_MAX_IMAGE_BYTES = 4_900_000;

export interface XCreds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

function creds(): XCreds | null {
  const apiKey = process.env.X_API_KEY?.trim();
  const apiSecret = process.env.X_API_SECRET?.trim();
  const accessToken = process.env.X_ACCESS_TOKEN?.trim();
  const accessSecret = process.env.X_ACCESS_SECRET?.trim();
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

/** RFC 3986 percent-encoding, which OAuth 1.0a demands (encodeURIComponent misses !'()*). */
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Build the OAuth 1.0a Authorization header for one request. `params` are the
 * query/form parameters that count toward the signature (multipart bodies do
 * not). Exported so the test can check a known signature.
 */
export function xAuthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  c: XCreds,
  nonce = randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000).toString(),
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: c.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const normalized = Object.keys(all)
    .map((k) => [rfc3986(k), rfc3986(all[k])] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), rfc3986(url), rfc3986(normalized)].join("&");
  const key = `${rfc3986(c.apiSecret)}&${rfc3986(c.accessSecret)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${rfc3986(k)}="${rfc3986(oauth[k])}"`)
      .join(", ")
  );
}

async function signedFetch(
  c: XCreds,
  method: string,
  url: string,
  opts: { query?: Record<string, string>; form?: Record<string, string>; json?: unknown; multipart?: FormData },
): Promise<Response> {
  const signedParams = { ...(opts.query ?? {}), ...(opts.form ?? {}) };
  const headers: Record<string, string> = { authorization: xAuthHeader(method, url, signedParams, c) };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.multipart) {
    body = opts.multipart;
  }
  const qs = opts.query ? "?" + new URLSearchParams(opts.query).toString() : "";
  return fetch(url + qs, { method, headers, body, signal: AbortSignal.timeout(30_000) });
}

async function fail(step: string, res: Response): Promise<never> {
  throw new Error(`x ${step} ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Upload one picture; returns the media id string. v2 first, v1.1 if v2 is not there. */
async function uploadMedia(c: XCreds, p: SitePost): Promise<string> {
  const fd = new FormData();
  fd.append("media", new Blob([new Uint8Array(p.image)], { type: p.mime }), "card.png");
  fd.append("media_category", "tweet_image");
  fd.append("media_type", p.mime);
  const v2 = await signedFetch(c, "POST", `${API}/2/media/upload`, { multipart: fd });
  if (v2.ok) {
    const j = (await v2.json()) as { data?: { id?: string; media_id_string?: string } };
    const id = j.data?.id ?? j.data?.media_id_string;
    if (id) return id;
  } else if (v2.status !== 404 && v2.status !== 410) {
    await fail("media/upload v2", v2);
  }
  const v1 = await signedFetch(c, "POST", `${UPLOAD_V1}/1.1/media/upload.json`, {
    form: { media_data: p.image.toString("base64"), media_category: "tweet_image" },
  });
  if (!v1.ok) await fail("media/upload v1.1", v1);
  const j = (await v1.json()) as { media_id_string?: string };
  if (!j.media_id_string) throw new Error("x media/upload: no media id in response");
  return j.media_id_string;
}

/** Alt text is best-effort: a failure here must not lose the post. */
async function setAltText(c: XCreds, mediaId: string, alt: string): Promise<void> {
  const text = alt.slice(0, 1000);
  try {
    const v2 = await signedFetch(c, "POST", `${API}/2/media/metadata`, {
      json: { id: mediaId, metadata: { alt_text: { text } } },
    });
    if (v2.ok) return;
    await signedFetch(c, "POST", `${UPLOAD_V1}/1.1/media/metadata/create.json`, {
      json: { media_id: mediaId, alt_text: { text } },
    });
  } catch {
    /* alt text only */
  }
}

export const x: SocialSite = {
  id: "x",
  label: "X",
  maxChars: X_MAX_CHARS,
  maxImageBytes: X_MAX_IMAGE_BYTES,
  connected: () => creds() !== null,
  async post(p: SitePost): Promise<{ uri: string }> {
    const c = creds();
    if (!c) throw new Error("x: not connected");
    const mediaId = await uploadMedia(c, p);
    await setAltText(c, mediaId, p.alt);
    const res = await signedFetch(c, "POST", `${API}/2/tweets`, {
      json: { text: p.text, media: { media_ids: [mediaId] } },
    });
    if (!res.ok) await fail("tweets", res);
    const j = (await res.json()) as { data?: { id?: string } };
    if (!j.data?.id) throw new Error("x tweets: no id in response");
    const handle = process.env.X_HANDLE?.trim().replace(/^@/, "") || "i";
    return { uri: `https://x.com/${handle}/status/${j.data.id}` };
  },
};
