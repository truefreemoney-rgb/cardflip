/**
 * Canonical public origin. superiormarketing.com 301-redirects here (Chris
 * chose redirect-only — the site is not served on his domain), so canonical/
 * OG/sitemap URLs and the eBay deletion-endpoint URL all use the fly.dev
 * host. Override with NEXT_PUBLIC_SITE_URL if that ever changes.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip-superior.fly.dev";
