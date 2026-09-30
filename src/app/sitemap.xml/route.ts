import { indexXml } from "@/lib/sitemapXml";
import { sitemapIndexChildren } from "@/lib/server/cardSitemap";

/**
 * /sitemap.xml: the INDEX (Next's own sitemap.ts cannot emit one). It lists the
 * child files under /sitemaps/ (lib/sitemapXml.ts). Dynamic on purpose: a static
 * route with no params would run its card counts inside `next build`. The CDN
 * keeps the answer a day (s-maxage), and the counts themselves sit in card_cache.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const xml = indexXml(await sitemapIndexChildren());
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
