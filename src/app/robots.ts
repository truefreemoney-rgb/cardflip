import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

// The app and API are seller-private; the marketing and legal pages are the
// public face. Saying so explicitly is one of the "is this a real site?"
// checks both crawlers and platform reviewers run.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/api/", "/admin", "/reset-password"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
