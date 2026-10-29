import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { SITE_URL } from "@/lib/siteUrl";
import { GOOGLE_APP_TICKET_MAX_AGE_S, GOOGLE_TOKENINFO_URL, GOOGLE_TOKEN_URL } from "@/lib/googleAuth";
import { pkceChallenge } from "@/lib/xAuth";

/**
 * The iPhone app's ticket (lib/googleAuth.ts GoogleAppState): the new session's token and end
 * date, sealed with AES-256-GCM under a key derived from the Google client secret, so the return
 * URL the browser sheet hands the app carries nothing readable. Opening it needs the PKCE
 * verifier the app kept: the hash inside has to match, and the ticket dies after two minutes.
 */
interface AppTicket {
  /** The session token (sessions.ts). */
  t: string;
  /** The session's end, ms. */
  e: number;
  /** PKCE challenge the start request carried. */
  c: string;
  /** Minted at, ms. */
  iat: number;
}

function ticketKey(secret: string): Buffer {
  return createHash("sha256").update(`cardflip-app-google-ticket:${secret}`).digest();
}

export function sealAppTicket(session: { token: string; expiresAt: number }, pkce: string, secret = process.env.GOOGLE_CLIENT_SECRET ?? "", now = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ticketKey(secret), iv);
  const body: AppTicket = { t: session.token, e: session.expiresAt, c: pkce, iat: now };
  const enc = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

/** The session inside a ticket, or null when it is forged, stale, or the verifier is not the one hashed into it. */
export function openAppTicket(raw: string, verifier: string, secret = process.env.GOOGLE_CLIENT_SECRET ?? "", now = Date.now()): { token: string; expiresAt: number } | null {
  if (!secret || !raw || raw.length > 2000 || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) return null;
  try {
    const buf = Buffer.from(raw, "base64url");
    if (buf.length < 12 + 16 + 2) return null;
    const decipher = createDecipheriv("aes-256-gcm", ticketKey(secret), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const json = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
    const v = JSON.parse(json) as Partial<AppTicket>;
    if (typeof v.t !== "string" || !/^[0-9a-f]{64}$/.test(v.t) || typeof v.e !== "number" || typeof v.c !== "string" || typeof v.iat !== "number") return null;
    if (now - v.iat > GOOGLE_APP_TICKET_MAX_AGE_S * 1000 || v.iat - now > 60_000) return null;
    if (pkceChallenge(verifier) !== v.c) return null;
    return { token: v.t, expiresAt: v.e };
  } catch {
    return null;
  }
}

/** The button only shows (and the routes only work) once the client id is on the server. */
export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * The origin Google sends the browser back to, and where our redirects land. localhost and Vercel
 * previews use the request's own origin (so the cookie and the return trip share a host); everything
 * else is the canonical site, so www or an odd alias never produces an unregistered redirect URI.
 */
export function googleOrigin(req: Request): string {
  const origin = new URL(req.url).origin;
  const host = new URL(origin).hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) return origin;
  return SITE_URL.replace(/\/$/, "");
}

export function googleRedirectUri(req: Request): string {
  return `${googleOrigin(req)}/api/auth/google/callback`;
}

/** Trade the one-time code for tokens; returns the id_token or null. Straight from Google over TLS. */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<string | null> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  return typeof data?.id_token === "string" ? data.id_token : null;
}

/**
 * One Tap gives the browser an id_token straight from Google; unlike the code flow nothing came
 * over our own TLS session with Google, so the signature has to be checked. Google's tokeninfo
 * endpoint does that (and refuses expired tokens): 200 = genuine. Returns the `sub` it reports,
 * or null when the token is forged, expired or Google could not be reached.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<string | null> {
  const res = await fetch(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { sub?: unknown } | null;
  return typeof data?.sub === "string" && data.sub ? data.sub : null;
}
