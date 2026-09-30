import type { SitemapEntry } from "@/lib/sitemapXml";

/**
 * The hand-written part of the sitemap. lastmod is the last real copy change
 * on that page — bump it when the page changes, not on every deploy (crawlers
 * stop trusting a date that always says "today"). /login is deliberately absent
 * (noindex, 09-30); private pages never appear.
 */
export const STATIC_PAGES: SitemapEntry[] = [
  { path: "/", lastmod: "2026-09-30" },
  { path: "/pricing", lastmod: "2026-09-04" },
  { path: "/help", lastmod: "2026-09-30" },
  { path: "/cards", lastmod: "2026-09-30" },
  { path: "/signup", lastmod: "2026-09-04" },
  { path: "/terms", lastmod: "2026-08-14" },
  { path: "/privacy", lastmod: "2026-08-14" },
];

/** The help articles' shared lastmod: when /help/<id> pages shipped; bump with a real edit to lib/helpArticles.ts. */
export const HELP_LASTMOD = "2026-09-30";

export function staticEntries(helpIds: string[]): SitemapEntry[] {
  return [...STATIC_PAGES, ...helpIds.map((id) => ({ path: `/help/${id}`, lastmod: HELP_LASTMOD }))];
}
