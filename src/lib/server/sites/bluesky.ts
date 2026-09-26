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

/**
 * Video goes through Bluesky's video service, not the PDS: a service-auth
 * token scoped to uploadBlob on the user's own PDS, POST the MP4 to
 * video.bsky.app, then poll the job until it hands back the blob ref.
 * Limits: 100 MB, 3 minutes; ours is ~4 MB, 15 s.
 */
const VIDEO_SERVICE = process.env.BLUESKY_VIDEO_BASE ?? "https://video.bsky.app";

interface Session {
  accessJwt: string;
  did: string;
  didDoc?: { service?: Array<{ id?: string; type?: string; serviceEndpoint?: string }> };
}

/** The PDS that holds this account (from the session's DID document), for the service-auth audience. */
export function pdsHost(session: Session, fallback = PDS): string {
  const svc = session.didDoc?.service?.find((s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer");
  try {
    return new URL(svc?.serviceEndpoint ?? fallback).hostname;
  } catch {
    return new URL(fallback).hostname;
  }
}

async function uploadVideo(session: Session, p: NonNullable<SitePost["video"]>): Promise<unknown> {
  const aud = `did:web:${pdsHost(session)}`;
  const exp = Math.floor(Date.now() / 1000) + 30 * 60;
  const authRes = await fetch(`${PDS}/xrpc/com.atproto.server.getServiceAuth?aud=${encodeURIComponent(aud)}&lxm=com.atproto.repo.uploadBlob&exp=${exp}`, {
    headers: { authorization: `Bearer ${session.accessJwt}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!authRes.ok) throw new Error(`bluesky getServiceAuth ${authRes.status}: ${(await authRes.text()).slice(0, 200)}`);
  const { token } = (await authRes.json()) as { token: string };
  type Job = { jobId?: string; state?: string; blob?: unknown; error?: string; message?: string };
  const up = await fetch(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(session.did)}&name=cardflip.mp4`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "content-length": String(p.bytes.length), authorization: `Bearer ${token}` },
    body: new Uint8Array(p.bytes),
    signal: AbortSignal.timeout(120_000),
  });
  const upText = await up.text();
  let job: Job & { jobStatus?: Job } = {};
  try {
    job = JSON.parse(upText) as typeof job;
  } catch {
    /* non-JSON error body */
  }
  // 409 = this exact file was uploaded before; the blob comes back ready.
  if (!up.ok && !(up.status === 409 && (job.blob || job.jobStatus?.blob))) throw new Error(`bluesky uploadVideo ${up.status}: ${upText.slice(0, 200)}`);
  let status: Job = job.jobStatus ?? job;
  for (let i = 0; i < 60 && !status.blob; i++) {
    if (status.state === "JOB_STATE_FAILED") throw new Error(`bluesky video job failed: ${status.error ?? status.message ?? "unknown"}`);
    if (!status.jobId) throw new Error("bluesky uploadVideo: no jobId in response");
    await new Promise((r) => setTimeout(r, 3_000));
    const poll = await fetch(`${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(status.jobId)}`, { signal: AbortSignal.timeout(20_000) });
    if (!poll.ok) throw new Error(`bluesky getJobStatus ${poll.status}: ${(await poll.text()).slice(0, 200)}`);
    status = ((await poll.json()) as { jobStatus: Job }).jobStatus;
  }
  if (!status.blob) throw new Error("bluesky video job never finished");
  return status.blob;
}

export const bluesky: SocialSite = {
  id: "bluesky",
  label: "Bluesky",
  maxChars: BLUESKY_MAX_CHARS,
  maxImageBytes: BLUESKY_MAX_IMAGE_BYTES,
  postsVideo: true,
  connected: () => Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD),
  async post(p: SitePost): Promise<{ uri: string }> {
    const session = await xrpc<Session>("com.atproto.server.createSession", {
      identifier: process.env.BLUESKY_HANDLE?.trim(),
      password: process.env.BLUESKY_APP_PASSWORD?.trim(),
    });
    const embed = p.video
      ? { $type: "app.bsky.embed.video", video: await uploadVideo(session, p.video), alt: p.alt, aspectRatio: { width: p.video.width, height: p.video.height } }
      : {
          $type: "app.bsky.embed.images",
          images: [{ alt: p.alt, image: (await xrpc<{ blob: unknown }>("com.atproto.repo.uploadBlob", p.image, session.accessJwt, p.mime)).blob, aspectRatio: { width: p.width, height: p.height } }],
        };
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
          embed,
        },
      },
      session.accessJwt,
    );
    const rkey = record.uri.split("/").pop();
    return { uri: `https://bsky.app/profile/${process.env.BLUESKY_HANDLE}/post/${rkey}` };
  },
};
