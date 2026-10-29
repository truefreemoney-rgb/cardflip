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
  // SAMEORIGIN (10-18): the admin heat map shows our own pages in a frame; other sites still can't.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera=(self) keeps the in-app card scanner working.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  basePath,
  // Surfaced on the Account page so a phone can tell which deploy it runs,
  // and on /admin/system alongside the build time (nothing on Vercel records
  // when a deploy was built, so it has to be stamped here).
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  poweredByHeader: false,
  // Dev only (10-11): Next's floating "N" button sat on the Inventory tab on the phone (tunnel tests) and ate the tap.
  devIndicators: false,
  // Dev only: 127.0.0.1 is a second cookie jar beside localhost, for seeing a
  // signed-out page (the /scan landing) while the pane stays signed in.
  // *.trycloudflare.com (10-11): Chris's phone reaches the dev server through a Cloudflare quick tunnel
  // (cloudflared tunnel --url http://localhost:3000) so changes get tested BEFORE a push, not with one.
  allowedDevOrigins: ["127.0.0.1", "*.trycloudflare.com"],
  // The admin console reads docs/BOARD.md at request time (lib/server/board.ts);
  // make sure the file ships with the serverless function.
  // The social pictures read their fonts the same way (lib/server/ogFonts.ts).
  outputFileTracingIncludes: { "/admin": ["./docs/BOARD.md"], "/api/social/image": ["./src/assets/fonts/*"], "/api/share/card": ["./src/assets/fonts/*"], "/api/share/collection": ["./src/assets/fonts/*"] },
  async headers() {
    const rules = [{ source: "/:path*", headers: securityHeaders }];
    // Dev only (10-28, docs/APP-PLAN.md): the iPhone app's web preview (expo start --web, port 8081) calls this dev
    // server's API from another origin so the app screens can be checked in the browser pane without a phone. Never
    // in a production build: the live API answers browsers on cardflip.io only.
    if (process.env.NODE_ENV !== "production") {
      rules.push({
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "http://localhost:8081" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "content-type, authorization, x-cardflip-app" },
        ],
      });
    }
    return rules;
  },
  // Search Console 10-22 lists /home as a 404 (an old link somewhere): the front page is /.
  async redirects() {
    return [{ source: "/home", destination: "/", permanent: true }];
  },
  // Card pictures (10-12, lib/pics.ts): cardflip.io/pics/* is our Blob store's cards/ folder, so the Firewall can
  // refuse other sites' hotlinks and rate-limit bulk copying (rules on the project's Firewall tab).
  async rewrites() {
    return { beforeFiles: [{ source: "/pics/:path*", destination: "https://mlwovvakovcpakbr.public.blob.vercel-storage.com/cards/:path*" }] };
  },
};

export default nextConfig;
