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
// 10-19: meta-webindexer (Meta AI's indexer, not the facebookexternalhit link preview) rendered 61K card pages in 12 h
// (104K ISR writes, $1.67 that day vs ~$0.40); turned away here and by a Vercel Firewall deny rule. Same day: AionBot
// (Oracle cloud, 31K requests) and Amzn-SearchBot (18K) were the next two; the three were 114K of 125K requests.
// 10-22: ExaSearchBot (Exa AI search index, ~1.1K card pages a day, no visitors) joins them, firewall rule v37.
// 10-26: Reflectionbot (~3.9K card pages a day from Google Cloud), ElevenlabsCrawler, KeenableBot, Lightpanda; firewall v53.
const TRAINING_BOTS = [
  "GPTBot", "CCBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "Applebot-Extended",
  "Bytespider", "meta-externalagent", "meta-webindexer", "AionBot", "Amzn-SearchBot", "ExaSearchBot", "FacebookBot", "Amazonbot", "cohere-ai", "Diffbot",
  "Omgilibot", "ImagesiftBot", "Timpibot", "PetalBot", "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot",
  "Reflectionbot", "ElevenlabsCrawler", "KeenableBot", "Lightpanda",
];
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // "/app$" + "/app/", not "/app": a bare prefix also blocked /apple-icon.png (10-16 audit).
      // _rsc: Next.js link-prefetch data, not pages. Search Console 10-16: 67% of Googlebot's 130K crawls were these
      // (?_rsc=...) while 56.5K card pages sat "Discovered, not indexed" waiting for crawl time.
      { userAgent: "*", allow: "/", disallow: ["/app$", "/app/", "/api/", "/admin", "/*?_rsc=", "/*&_rsc="] },
      { userAgent: TRAINING_BOTS, disallow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
