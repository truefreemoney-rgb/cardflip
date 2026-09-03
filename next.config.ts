import type { NextConfig } from "next";

// Unset locally so `npm run dev` still serves from "/". Set to "/cards" (no
// trailing slash) at build/deploy time to mount the app under a subpath of
// an existing site, e.g. superiormarketing.com/cards.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

// No CSP on purpose: Next's inline runtime scripts would need nonce plumbing,
// and a broken page is worse for eBay's site review than a missing header.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera=(self) keeps the in-app card scanner working.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  basePath,
  // Surfaced on the Account page so a phone can tell which deploy it runs.
  env: { NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "" },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
