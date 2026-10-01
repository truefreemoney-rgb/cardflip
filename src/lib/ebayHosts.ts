/**
 * Which eBay environment the Sell/OAuth calls go to. EBAY_ENV=sandbox points
 * them at eBay's sandbox (api.sandbox.ebay.com / auth.sandbox.ebay.com) for
 * end-to-end tests with sandbox keys and sandbox test users; anything else,
 * including unset, is production and the hosts below are the same literals the
 * code used before this switch existed (scripts/test-ebay-golden.mjs pins it).
 *
 * Pure: reads one env var, touches nothing else. OAuth scope strings do NOT
 * change in the sandbox (they are still https://api.ebay.com/oauth/api_scope/...).
 */

export interface EbayHosts {
  /** Sell APIs (Inventory, Account, Fulfillment, Negotiation) and the OAuth token endpoint. */
  api: string;
  /** Finances and Commerce Identity. */
  apiz: string;
  /** The user-consent (authorize) site. */
  auth: string;
  sandbox: boolean;
}

export const PRODUCTION_HOSTS: EbayHosts = {
  api: "https://api.ebay.com",
  apiz: "https://apiz.ebay.com",
  auth: "https://auth.ebay.com",
  sandbox: false,
};

export const SANDBOX_HOSTS: EbayHosts = {
  api: "https://api.sandbox.ebay.com",
  apiz: "https://apiz.sandbox.ebay.com",
  auth: "https://auth.sandbox.ebay.com",
  sandbox: true,
};

/** Whether EBAY_ENV asks for the sandbox (trimmed, case-insensitive; "sandbox" is the only non-production value). Never throws. */
export function isSandboxMode(env: string | undefined = process.env.EBAY_ENV): boolean {
  return (env ?? "").trim().toLowerCase() === "sandbox";
}

/** Thrown instead of ever using sandbox hosts next to production data. */
export class SandboxRefusedError extends Error {
  constructor(reason: string) {
    super(`EBAY_ENV=sandbox refused: ${reason}`);
    this.name = "SandboxRefusedError";
  }
}

/**
 * Why sandbox mode must not run here, or null when it may. A sandbox host
 * answers a production refresh token with 400/401, which the token code reads
 * as "revoked" and would delete real sellers' links; sandbox tokens would also
 * land in the production tokens table. So sandbox mode only runs against a
 * local file database, never on Vercel production and never with a remote
 * (Turso/libsql) database configured.
 */
export function sandboxRefusal(env: Record<string, string | undefined> = process.env): string | null {
  if ((env.VERCEL_ENV ?? "").trim().toLowerCase() === "production") return "this is a Vercel production deployment (VERCEL_ENV=production)";
  if ((env.TURSO_DATABASE_URL ?? "").trim()) return "a remote database is configured (TURSO_DATABASE_URL), which holds real sellers' eBay links";
  return null;
}

/**
 * The hosts for the current process. Production unless EBAY_ENV=sandbox;
 * asking for the sandbox where sandboxRefusal() applies throws
 * SandboxRefusedError (no call is ever made) rather than falling back to
 * production, so a mis-set variable is loud, never silently live.
 */
export function ebayHosts(env: string | undefined = process.env.EBAY_ENV): EbayHosts {
  if (!isSandboxMode(env)) return PRODUCTION_HOSTS;
  const why = sandboxRefusal();
  if (why) throw new SandboxRefusedError(why);
  return SANDBOX_HOSTS;
}
