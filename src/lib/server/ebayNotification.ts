// No "server-only" marker on purpose: the verify half is pure node:crypto so
// scripts/test-ebay-deletion.mjs can import it straight into node.

import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

/**
 * eBay Marketplace Account Deletion notifications — signature check.
 *
 * Every POST carries `x-ebay-signature`: base64 of JSON
 * `{ alg: "ecdsa", kid, signature, digest: "SHA1" }`. The `kid` names an
 * eBay-held public key (ECDSA P-256), fetched from
 * GET /commerce/notification/v1/public_key/{kid} with an application
 * (client-credentials) token; the response is
 * `{ key: "-----BEGIN PUBLIC KEY-----MFkw…-----END PUBLIC KEY-----",
 *    algorithm: "ECDSA", digest: "SHA1" }` with the PEM armour but no line
 * breaks. `signature` is a base64 DER ECDSA signature over the raw request
 * body, made with the named digest (SHA1 — eBay's choice, not ours).
 *
 * Without this check anyone who knows a seller's eBay username (public on
 * every listing) could POST a fake notice and unlink their account.
 * Mirrors eBay's event-notification-nodejs-sdk.
 */

export interface EbaySignatureHeader {
  alg: string;
  kid: string;
  signature: string;
  digest?: string;
}

export interface EbayPublicKey {
  key: string;
  algorithm?: string;
  digest?: string;
}

const PUBLIC_KEY_URL = "https://api.ebay.com/commerce/notification/v1/public_key/";
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const KID_RE = /^[A-Za-z0-9._~-]{1,128}$/;

/** Decode the header; null on anything malformed. */
export function parseSignatureHeader(header: string | null | undefined): EbaySignatureHeader | null {
  if (!header) return null;
  try {
    const v = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Partial<EbaySignatureHeader>;
    if (typeof v?.kid !== "string" || !KID_RE.test(v.kid)) return null;
    if (typeof v.signature !== "string" || !v.signature) return null;
    if (typeof v.alg !== "string") return null;
    return { alg: v.alg, kid: v.kid, signature: v.signature, digest: typeof v.digest === "string" ? v.digest : undefined };
  } catch {
    return null;
  }
}

/** eBay strips the newlines from the PEM; node's parser wants them back. */
export function formatPublicKey(raw: string): string {
  const body = raw
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return `-----BEGIN PUBLIC KEY-----\n${body.replace(/(.{64})/g, "$1\n").trim()}\n-----END PUBLIC KEY-----\n`;
}

function digestFor(name: string | undefined): string {
  const d = (name ?? "SHA1").toLowerCase().replace(/[^a-z0-9]/g, "");
  return d === "sha256" ? "sha256" : "sha1";
}

/**
 * Pure check: does `signature` (from the header) sign `rawBody` under
 * `publicKey`? Never throws — a bad key, bad base64 or wrong algorithm is
 * simply "no".
 */
export function verifyEbaySignature(
  rawBody: string | Buffer,
  header: EbaySignatureHeader | string | null | undefined,
  publicKey: EbayPublicKey | null | undefined,
): boolean {
  const sig = typeof header === "string" || header == null ? parseSignatureHeader(header) : header;
  if (!sig || !publicKey?.key) return false;
  if (sig.alg.toLowerCase() !== "ecdsa") return false;
  if (publicKey.algorithm && publicKey.algorithm.toLowerCase() !== "ecdsa") return false;
  let key: KeyObject;
  try {
    key = createPublicKey(formatPublicKey(publicKey.key));
  } catch {
    return false;
  }
  if (key.asymmetricKeyType !== "ec") return false;
  const digest = digestFor(publicKey.digest ?? sig.digest);
  const signature = Buffer.from(sig.signature, "base64");
  if (!signature.length) return false;
  try {
    return cryptoVerify(digest, Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8"), key, signature);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Key fetch (network). Keys are long-lived; cache per kid for the process.

const keyCache = new Map<string, EbayPublicKey>();
let appToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (appToken && Date.now() < appToken.expiresAt) return appToken.value;
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`eBay app token request failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  appToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return json.access_token;
}

/** The public key for `kid`, from cache or eBay. Throws on any failure. */
export async function fetchEbayPublicKey(kid: string): Promise<EbayPublicKey> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  if (!KID_RE.test(kid)) throw new Error("bad kid");
  const token = await getAppToken();
  const res = await fetch(PUBLIC_KEY_URL + encodeURIComponent(kid), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`eBay public key fetch failed (${res.status})`);
  const json = (await res.json()) as Partial<EbayPublicKey>;
  if (typeof json.key !== "string" || !json.key) throw new Error("eBay public key response had no key");
  const key: EbayPublicKey = { key: json.key, algorithm: json.algorithm, digest: json.digest };
  keyCache.set(kid, key);
  return key;
}

/** Tests only. */
export function _resetEbayKeyCache(): void {
  keyCache.clear();
  appToken = null;
}
