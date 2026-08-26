import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { db } from "@/lib/db";
import { setEbayConnected } from "@/lib/server/users";

/**
 * eBay user OAuth ("Connect with eBay").
 *
 * The comps lookups in ./ebay.ts run on an *application* token — they never
 * need a seller's consent. This module is the other half: the authorization-
 * code flow that lets a seller grant CardFlip access to *their* eBay account,
 * so listings can be created under it. Tokens are stored per user in SQLite,
 * encrypted at rest, and refreshed on demand.
 *
 * eBay specifics that shaped this:
 *  - `redirect_uri` in the authorize URL is NOT a URL. It's the "RuName", an
 *    opaque id eBay assigns when the real callback URL is registered in the
 *    developer portal (User Tokens → "Get a Token from eBay via Your
 *    Application"). Env: EBAY_RU_NAME.
 *  - User access tokens last ~2h; refresh tokens ~18 months. The refresh
 *    grant must repeat the scope list.
 *  - Scopes are full URLs, space-separated.
 */

export const EBAY_AUTH_URL = "https://auth.ebay.com/oauth2/authorize";
const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_IDENTITY_URL = "https://apiz.ebay.com/commerce/identity/v1/user/";

/**
 * Exactly what the consent screen will show, and nothing more. Mirrored in
 * plain English by the PERMISSIONS copy on /connect-ebay and signup — keep
 * the two lists in step.
 */
export const USER_SCOPES = [
  // Create a listing draft that shows in the seller's My eBay › Drafts and
  // opens pre-filled in eBay's listing tool (Listing API createItemDraft).
  "https://api.ebay.com/oauth/api_scope/sell.item.draft",
  // Create/update inventory items and offers (publish-from-CardFlip path).
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  // Read the seller's business policies (offers need fulfillment/payment/
  // return policy ids) and opt them into Business Policies when needed —
  // the opt-in call is write, so this is the full scope, not .readonly
  // (readonly got 403 on the first real push, 08-16).
  "https://api.ebay.com/oauth/api_scope/sell.account",
  // The seller's eBay username, so the UI can say which account is linked.
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
  // Read the seller's orders so a card that sells on eBay flips itself to
  // "sold" in the ledger instead of waiting on a manual button.
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
];

export class EbayOAuthNotConfiguredError extends Error {
  constructor() {
    super("eBay sign-in isn't configured on this server");
    this.name = "EbayOAuthNotConfiguredError";
  }
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  ruName: string;
}

function config(): OAuthConfig {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RU_NAME;
  if (!clientId || !clientSecret || !ruName) throw new EbayOAuthNotConfiguredError();
  return { clientId, clientSecret, ruName };
}

/** True once the keyset AND the RuName are set — the button only renders then. */
export function isEbayOAuthConfigured(): boolean {
  return Boolean(
    process.env.EBAY_CLIENT_ID &&
      process.env.EBAY_CLIENT_SECRET &&
      process.env.EBAY_RU_NAME,
  );
}

// ---------------------------------------------------------------------------
// Storage

// Schema (ebay_tokens) lives in lib/db.ts behind the adapter's schema gate.

interface TokenRow {
  user_id: string;
  access_token: string;
  access_expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
  ebay_user_id: string | null;
  ebay_username: string | null;
  scopes: string;
  connected_at: number;
  updated_at: number;
}

/**
 * Tokens are encrypted at rest with AES-256-GCM. The key is EBAY_TOKEN_KEY if
 * set, otherwise derived from the client secret — which is always present when
 * OAuth is configured, so no extra secret is needed to turn this on. A stolen
 * DB file alone then can't be used to act as any seller.
 */
function encryptionKey(): Buffer {
  const material = process.env.EBAY_TOKEN_KEY ?? config().clientSecret;
  return createHash("sha256").update(`cardflip-ebay-token:${material}`).digest();
}

function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${body.toString("base64url")}`;
}

function open(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) {
    throw new Error("Unrecognized token envelope");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export interface EbayLink {
  ebayUserId: string | null;
  ebayUsername: string | null;
  connectedAt: number;
  /** When the refresh token dies — the seller must reconnect after this. */
  refreshExpiresAt: number;
  scopes: string[];
}

export async function getEbayLink(userId: string): Promise<EbayLink | null> {
  const row = (await db
    .prepare("SELECT * FROM ebay_tokens WHERE user_id = ?")
    .get(userId)) as TokenRow | undefined;
  if (!row) return null;
  return {
    ebayUserId: row.ebay_user_id,
    ebayUsername: row.ebay_username,
    connectedAt: row.connected_at,
    refreshExpiresAt: row.refresh_expires_at,
    scopes: row.scopes.split(" ").filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// State parameter — ties the callback to the session that started it

/**
 * `state` is a nonce plus an HMAC binding it to the user who clicked Connect.
 * The nonce also goes in a short-lived httpOnly cookie; the callback requires
 * both to agree, so a code can't be replayed into someone else's session.
 */
export function createOAuthState(userId: string): string {
  const nonce = randomBytes(16).toString("hex");
  return `${nonce}.${signState(nonce, userId)}`;
}

function signState(nonce: string, userId: string): string {
  return createHmac("sha256", config().clientSecret)
    .update(`${nonce}:${userId}`)
    .digest("hex");
}

export function verifyOAuthState(state: string, userId: string): boolean {
  const [nonce, sig] = state.split(".");
  if (!nonce || !sig) return false;
  const expected = signState(nonce, userId);
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

// ---------------------------------------------------------------------------
// The flow

export function buildAuthorizeUrl(state: string): string {
  const { clientId, ruName } = config();
  const url = new URL(EBAY_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", USER_SCOPES.join(" "));
  url.searchParams.set("state", state);
  // Always show the consent screen — a seller reconnecting after a disconnect
  // should see what they're granting again, not be silently re-linked.
  url.searchParams.set("prompt", "login");
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const { clientId, clientSecret } = config();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    // eBay's error body says *why* (invalid_grant, invalid_scope…) — surface it
    // in the log; the caller shows the seller a plain-language message.
    const detail = await res.text().catch(() => "");
    throw new Error(`eBay token request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Finish the connect: swap the callback code for tokens, look up who just
 * linked, and store it. Overwrites any previous link for this user.
 */
export async function completeEbayConnect(userId: string, code: string): Promise<EbayLink> {
  const { ruName } = config();
  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ruName,
    }),
  );
  if (!tokens.refresh_token) {
    throw new Error("eBay returned no refresh token — cannot keep the account linked");
  }

  const identity = await fetchIdentity(tokens.access_token).catch((err) => {
    // Not fatal: the link works without a display name. Logged so a missing
    // identity scope shows up somewhere.
    console.error("eBay identity lookup failed:", err);
    return null;
  });

  const now = Date.now();
  await db.prepare(
    `INSERT INTO ebay_tokens
       (user_id, access_token, access_expires_at, refresh_token, refresh_expires_at,
        ebay_user_id, ebay_username, scopes, connected_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = excluded.access_token,
       access_expires_at = excluded.access_expires_at,
       refresh_token = excluded.refresh_token,
       refresh_expires_at = excluded.refresh_expires_at,
       ebay_user_id = excluded.ebay_user_id,
       ebay_username = excluded.ebay_username,
       scopes = excluded.scopes,
       connected_at = excluded.connected_at,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    seal(tokens.access_token),
    now + tokens.expires_in * 1000,
    seal(tokens.refresh_token),
    now + (tokens.refresh_token_expires_in ?? 47304000) * 1000,
    identity?.userId ?? null,
    identity?.username ?? null,
    USER_SCOPES.join(" "),
    now,
    now,
  );
  await setEbayConnected(userId, true);

  return (await getEbayLink(userId))!;
}

async function fetchIdentity(
  accessToken: string,
): Promise<{ userId: string | null; username: string | null }> {
  const res = await fetch(EBAY_IDENTITY_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`eBay identity request failed (${res.status})`);
  const json = (await res.json()) as { userId?: string; username?: string };
  return { userId: json.userId ?? null, username: json.username ?? null };
}

/**
 * A live access token for this user, refreshed if it's about to expire.
 * Returns null when the user has no link (or the refresh token itself has
 * expired, in which case the link is removed so the UI asks to reconnect).
 */
export async function getUserAccessToken(userId: string): Promise<string | null> {
  const row = (await db
    .prepare("SELECT * FROM ebay_tokens WHERE user_id = ?")
    .get(userId)) as TokenRow | undefined;
  if (!row) return null;

  const now = Date.now();
  // A minute of slack so we never hand out a token that dies mid-request.
  if (row.access_expires_at - 60_000 > now) return open(row.access_token);

  if (row.refresh_expires_at <= now) {
    await disconnectEbay(userId);
    return null;
  }

  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: open(row.refresh_token),
      scope: row.scopes,
    }),
  );
  await db.prepare(
    "UPDATE ebay_tokens SET access_token = ?, access_expires_at = ?, updated_at = ? WHERE user_id = ?",
  ).run(seal(tokens.access_token), now + tokens.expires_in * 1000, now, userId);
  return tokens.access_token;
}

/** Forget the link. eBay has no revoke endpoint for user tokens; deleting ours is the whole story. */
export async function disconnectEbay(userId: string): Promise<void> {
  await db.prepare("DELETE FROM ebay_tokens WHERE user_id = ?").run(userId);
  await setEbayConnected(userId, false);
}

/**
 * eBay marketplace account deletion: the notice carries eBay's user id and
 * username, not ours. Drop every link to that eBay account. Returns how many
 * CardFlip users were unlinked, for the log.
 */
export async function purgeEbayAccount(ebayUserId: string | null, username: string | null): Promise<number> {
  const rows = (await db
    .prepare(
      `SELECT user_id FROM ebay_tokens
       WHERE (? IS NOT NULL AND ebay_user_id = ?)
          OR (? IS NOT NULL AND ebay_username = ?)`,
    )
    .all(ebayUserId, ebayUserId, username, username)) as unknown as { user_id: string }[];
  for (const row of rows) await disconnectEbay(row.user_id);
  return rows.length;
}
