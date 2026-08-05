import type { NextConfig } from "next";

// Unset locally so `npm run dev` still serves from "/". Set to "/cards" (no
// trailing slash) at build/deploy time to mount the app under a subpath of
// an existing site, e.g. superiormarketing.com/cards.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  basePath,
};

export default nextConfig;
