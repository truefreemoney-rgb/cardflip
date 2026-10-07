import "server-only";
import { SITE_URL } from "@/lib/siteUrl";
import { GOOGLE_TOKEN_URL } from "@/lib/googleAuth";

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
