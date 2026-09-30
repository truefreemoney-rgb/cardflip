import { SITE_URL } from "@/lib/siteUrl";
import { CARD_GAME_SLUGS, SITEMAP_CHUNK } from "@/lib/cardPages";
import type { GameId } from "@/lib/types";

/**
 * The sitemap files (SEO sweep 09-30). /sitemap.xml is an INDEX; the URLs live in
 * child files under /sitemaps/: pages.xml (the marketing pages, help articles
 * and the card hubs) and cards-{game}-{n}.xml (one file per 10,000 cards of a
 * game, so 39k cards is five small files, never one big one). Next's own
 * sitemap convention cannot emit an index, so these are route handlers
 * (app/sitemap.xml/route.ts, app/sitemaps/[name]/route.ts). Pure string work
 * here; the queries are in lib/server/cardSitemap.ts.
 */

export interface SitemapEntry {
  /** Site-relative path ("/pricing"); made absolute here. */
  path: string;
  /** "YYYY-MM-DD" (a UTC day key, or a page's last real change). */
  lastmod?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** Paths are percent-encoded already (cardPath); everything is made absolute and XML-escaped. */
export function urlsetXml(entries: SitemapEntry[]): string {
  const rows = entries.map((e) => `<url><loc>${esc(`${SITE_URL}${e.path}`)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`);
  return `${XML}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

export interface SitemapChild {
  /** The file name under /sitemaps/ ("cards-magic-2.xml"). */
  name: string;
  lastmod?: string;
}

export function indexXml(children: SitemapChild[]): string {
  const rows = children.map((c) => `<sitemap><loc>${esc(`${SITE_URL}/sitemaps/${c.name}`)}</loc>${c.lastmod ? `<lastmod>${c.lastmod}</lastmod>` : ""}</sitemap>`);
  return `${XML}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</sitemapindex>\n`;
}

/** How many files `total` URLs need (0 URLs = 0 files). */
export const chunkCount = (total: number, size = SITEMAP_CHUNK): number => (total > 0 ? Math.ceil(total / size) : 0);

export const PAGES_SITEMAP = "pages.xml";
export const cardSitemapName = (game: GameId, n: number) => `cards-${CARD_GAME_SLUGS[game]}-${n}.xml`;

/** Every child file the index lists, given how many cards each game has. Games with no cards have no files. */
export function sitemapChildren(counts: Partial<Record<GameId, number>>, lastmod?: string): SitemapChild[] {
  const out: SitemapChild[] = [{ name: PAGES_SITEMAP, lastmod }];
  for (const game of Object.keys(CARD_GAME_SLUGS) as GameId[]) {
    const files = chunkCount(counts[game] ?? 0);
    for (let n = 1; n <= files; n++) out.push({ name: cardSitemapName(game, n), lastmod });
  }
  return out;
}

/** "cards-one-piece-2.xml" -> { game: "onepiece", chunk: 2 }; "pages.xml" -> "pages"; anything else null. */
export function parseSitemapName(name: string): "pages" | { game: GameId; chunk: number } | null {
  if (name === PAGES_SITEMAP) return "pages";
  const m = /^cards-([a-z-]{3,12})-(\d{1,3})\.xml$/.exec(name);
  if (!m) return null;
  const game = (Object.keys(CARD_GAME_SLUGS) as GameId[]).find((g) => CARD_GAME_SLUGS[g] === m[1]);
  const chunk = Number(m[2]);
  return game && chunk >= 1 ? { game, chunk } : null;
}
