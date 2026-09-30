import { parseSitemapName, urlsetXml } from "@/lib/sitemapXml";
import { cardSitemapEntries, pagesSitemapEntries, sitemapIndexChildren } from "@/lib/server/cardSitemap";

/**
 * One child sitemap: pages.xml (marketing pages, help articles, the card hubs)
 * or cards-{game}-{n}.xml (up to 10,000 cards each). On-demand ISR like the
 * card pages: nothing is built ahead, a file is made when a crawler first asks
 * and then kept for a day (revalidate 86400). The name is checked against the
 * file pattern and then against the files the index lists (which only holds the
 * games the public can use, and as many files as the cached counts need) before
 * any query runs, so an invented name costs no database read. A listed file the
 * guard trimmed to nothing answers an empty urlset, not a 404.
 */
export const dynamic = "force-static";
export const revalidate = 86400;
// A card file runs the price guard over up to 10,000 cards (about 50 batched reads): give a cold build room on Turso.
export const maxDuration = 60;
export const generateStaticParams = async () => [];

const xml = (body: string) => new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

export async function GET(_req: Request, ctx: RouteContext<"/sitemaps/[name]">) {
  const { name } = await ctx.params;
  const file = parseSitemapName(name);
  if (!file) return notFound();
  if (file === "pages") return xml(urlsetXml(await pagesSitemapEntries()));
  if (!(await sitemapIndexChildren()).some((c) => c.name === name)) return notFound();
  return xml(urlsetXml(await cardSitemapEntries(file.game, file.chunk)));
}
