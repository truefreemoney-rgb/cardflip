/**
 * Canonical public origin — cardflip.io as of 08-25 (Chris registered it;
 * DNS points at the Fly app, fly.dev keeps serving as an alias). Canonical/
 * OG/sitemap URLs use this. The eBay OAuth RuName callback and the deletion
 * endpoint registered in the eBay dev portal still point at the fly.dev
 * host until they're migrated there — don't remove that host.
 * Override with NEXT_PUBLIC_SITE_URL if this ever changes.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
