import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

// The app and API are seller-private; the marketing, legal and card price pages
// are the public face. Saying so explicitly is one of the "is this a real site?"
// checks both crawlers and platform reviewers run. /reset-password is not
// disallowed on purpose (09-30): it is noindex, and a crawler that may not fetch
// a page never sees its noindex. The sitemap is an index (app/sitemap.xml/route.ts).
// AI-training and SEO-tool crawlers are turned away (10-05: bots rendering the
// 74k card pages drove the Vercel ISR/storage bill). Search bots keep access:
// Googlebot, Bingbot, OAI-SearchBot / ChatGPT-User, PerplexityBot, Claude-SearchBot.
const TRAINING_BOTS = [
  "GPTBot", "CCBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "Applebot-Extended",
  "Bytespider", "meta-externalagent", "FacebookBot", "Amazonbot", "cohere-ai", "Diffbot",
  "Omgilibot", "ImagesiftBot", "Timpibot", "PetalBot", "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot",
];
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/app", "/api/", "/admin"] },
      { userAgent: TRAINING_BOTS, disallow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
