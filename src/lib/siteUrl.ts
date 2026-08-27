/**
 * Canonical public origin — cardflip.io. As of the 08-27 cutover DNS points at
 * Vercel, not Fly. Canonical/OG/sitemap URLs use this, and the eBay deletion
 * endpoint falls back to `${SITE_URL}/api/ebay/account-deletion` when
 * EBAY_DELETION_ENDPOINT_URL is unset — which is the setup to prefer, since a
 * hand-entered value that disagrees with the URL registered in the eBay portal
 * silently breaks the challenge hash while still returning 200.
 * Override with NEXT_PUBLIC_SITE_URL if this ever changes.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
