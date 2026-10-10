import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { googleOrigin } from "@/lib/server/googleAuth";
import { parseTouch } from "@/lib/attribution";
import { safeNext } from "@/lib/googleAuth";
import { X_PENDING_MAX_AGE_S, X_PROFILE_URL, X_TOKEN_URL, type XPending } from "@/lib/xAuth";

/** The button only shows (and the routes only work) once both keys are on the server. */
export function xConfigured(): boolean {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
}

/** Same origin rules as Google: localhost and Vercel previews use the request's own, the rest the canonical site. */
export function xOrigin(req: Request): string {
  return googleOrigin(req);
}

export function xRedirectUri(req: Request): string {
  return `${xOrigin(req)}/api/auth/x/callback`;
}

/** Trade the one-time code (and PKCE verifier) for an access token; null on any refusal. */
export async function exchangeXCode(code: string, redirectUri: string, verifier: string): Promise<string | null> {
  const id = process.env.X_CLIENT_ID ?? "";
  const secret = process.env.X_CLIENT_SECRET ?? "";
  const res = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: id,
    }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  return typeof data?.access_token === "string" && data.access_token ? data.access_token : null;
}

/** The raw users/me body (parse it with parseXProfile); null when X refused. */
export async function fetchXProfile(accessToken: string): Promise<unknown> {
  const res = await fetch(X_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** body.signature, both base64url. Signed with the X client secret so only this server can mint one. */
export function signXPending(p: XPending, secret = process.env.X_CLIENT_SECRET ?? ""): string {
  const body = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/** The pending identity, or null when missing, tampered, malformed or older than 15 minutes. */
export function verifyXPending(raw: string | null | undefined, secret = process.env.X_CLIENT_SECRET ?? "", now = Date.now()): XPending | null {
  if (!raw || !secret) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const want = Buffer.from(mac(parts[0], secret));
  const got = Buffer.from(parts[1]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const v = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof v.sub !== "string" || !/^\d{1,30}$/.test(v.sub)) return null;
    if (typeof v.iat !== "number" || now - v.iat > X_PENDING_MAX_AGE_S * 1000 || v.iat - now > 60_000) return null;
    if (v.mode !== "signup" && v.mode !== "login") return null;
    const ref = typeof v.ref === "string" && /^[A-Za-z0-9]{4,16}$/.test(v.ref) ? v.ref.toUpperCase() : null;
    return {
      sub: v.sub,
      name: typeof v.name === "string" ? v.name.slice(0, 80) : "",
      username: typeof v.username === "string" ? v.username.slice(0, 40) : "",
      mode: v.mode,
      next: safeNext(typeof v.next === "string" ? v.next : null),
      ref,
      touch: parseTouch(v.touch),
      fromScan: v.fromScan === true,
      iat: v.iat,
    };
  } catch {
    return null;
  }
}
