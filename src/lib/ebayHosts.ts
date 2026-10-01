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

/** The hosts for the current process (EBAY_ENV, trimmed and case-insensitive; "sandbox" is the only non-production value). */
export function ebayHosts(env: string | undefined = process.env.EBAY_ENV): EbayHosts {
  return (env ?? "").trim().toLowerCase() === "sandbox" ? SANDBOX_HOSTS : PRODUCTION_HOSTS;
}
