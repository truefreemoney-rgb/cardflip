import "server-only";
import { db } from "@/lib/db";
import { helpArticles } from "@/lib/helpArticles";
import { todayUtc } from "@/lib/priceSeries";
import { INDEX_FLOOR_USD, SITEMAP_CHUNK, cardPath, gamePath, indexDecision, parseCardKey, setPath, slugify, variantPrices } from "@/lib/cardPages";
import { judgeSeries, loadTrustData } from "@/lib/server/priceTrustSite";
import { staticEntries } from "@/lib/sitemapPages";
import { sitemapChildren, type SitemapChild, type SitemapEntry } from "@/lib/sitemapXml";
import { cachedList } from "@/lib/server/listCache";
import { freshCutoff, publicCardGames, setIndex } from "@/lib/server/cardPages";
import type { GameId } from "@/lib/types";

/**
 * The sitemap's reads (lib/sitemapXml.ts has the files). Each child file is one
 * paged query of the cards worth indexing: fresh TCGplayer price, a picture, a
 * key a page can have, priced at the $5 floor. Pokémon keeps its prices only in
 * price_series (the JSON array's last element, read in SQL, never decoded in
 * JS); the other games read the catalog's price columns. lastmod is the
 * series' updated_day. Queries run when a crawler asks and the response is
 * cached a day (the routes set revalidate = 86400), so the cost is a few
 * thousand rows a day, not per request.
 *
 * Each file is then run through the price guard in batches (2 queries per 400
 * cards, once a day per file) and keeps only the cards whose page would be
 * indexed (indexDecision: a price the guard believes, at the floor or more, and
 * not an unverified four-figure price on a day-old series), so the sitemap never
 * lists a URL that answers noindex. A guard that fails lists the file unfiltered
 * (the page itself answers noindex for those). Orphan series (sealed, graded,
 * ids the catalog lacks) cannot appear: every query starts from the catalog.
 */

const MTG_SKIPPED = "('token', 'memorabilia', 'minigame', 'alchemy')";

/** The grouped select (one row per card) a game's files page through, with `head` as its column list. */
function cardsSql(game: GameId, head: string): string {
  const series = "p.source = 'tcgplayer' AND p.currency = 'USD' AND p.updated_day >= ?";
  if (game === "pokemon") {
    return `SELECT ${head} FROM en_cards c JOIN price_series p ON p.card_id = c.id
             WHERE p.game = 'pokemon' AND ${series} AND c.image_url <> '' AND c.id NOT GLOB '*[^A-Za-z0-9._-]*'
             GROUP BY c.id HAVING MAX(json_extract(p.prices, '$[#-1]')) >= ${INDEX_FLOOR_USD}`;
  }
  if (game === "mtg") {
    return `SELECT ${head} FROM mtg_cards c JOIN mtg_sets s ON s.code = c.set_code JOIN price_series p ON p.card_id = c.id AND ${series}
             WHERE (c.price_usd >= ${INDEX_FLOOR_USD} OR c.price_usd_foil >= ${INDEX_FLOOR_USD} OR c.price_usd_etched >= ${INDEX_FLOOR_USD})
               AND c.image_url <> '' AND c.lang = 'en' AND s.set_type NOT IN ${MTG_SKIPPED}
             GROUP BY c.id`;
  }
  return `SELECT ${head} FROM tcg_cards c JOIN price_series p ON p.card_id = c.id AND ${series}
           WHERE c.game = '${game}' AND (c.price_usd >= ${INDEX_FLOOR_USD} OR c.price_usd_foil >= ${INDEX_FLOOR_USD})
             AND c.image_url <> '' AND c.id NOT LIKE '%#%'
           GROUP BY c.id`;
}

/** How many cards a game's files hold (before the key pattern trims a handful). */
export async function cardSitemapCount(game: GameId, today = todayUtc()): Promise<number> {
  const row = (await db.prepare(`SELECT COUNT(*) AS n FROM (${cardsSql(game, "c.id")})`).get(freshCutoff(today))) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

interface CardRow {
  id: string;
  name: string;
  subtitle?: string;
  set_key: string;
  set_name: string;
  set_code: string;
  number: string;
  lastmod: string;
}

/** The ids among these whose page would be indexed, or null when the guard could not be read (list them all). */
async function indexedIds(game: GameId, ids: string[], today: string): Promise<Set<string> | null> {
  try {
    const trust = await loadTrustData(ids.map((cardId) => ({ cardId, game })), today);
    const ok = new Set<string>();
    for (const id of ids) {
      const data = trust.get(id);
      if (!data) continue;
      const inputs = data.series.map((s) => ({ ...s, flag: judgeSeries(data, { variant: s.variant, exact: true, day: today }) }));
      if (indexDecision(variantPrices(game, inputs, today)).index) ok.add(id);
    }
    return ok;
  } catch (err) {
    console.warn(`sitemap: the price guard failed on a ${game} file, listing it unfiltered`, err);
    return null;
  }
}

/** One file of a game's cards (chunk is 1-based): the canonical URL of each card and its lastmod. */
export async function cardSitemapEntries(game: GameId, chunk: number, today = todayUtc()): Promise<SitemapEntry[]> {
  const head =
    game === "pokemon"
      ? "c.id AS id, c.name AS name, c.set_id AS set_key, c.set_name AS set_name, c.set_code AS set_code, c.local_id AS number, MAX(p.updated_day) AS lastmod"
      : game === "mtg"
        ? "c.id AS id, c.name AS name, c.set_code AS set_key, c.set_name AS set_name, c.set_code AS set_code, c.collector_number AS number, MAX(p.updated_day) AS lastmod"
        : "c.id AS id, c.name AS name, c.subtitle AS subtitle, c.set_code || '|' || c.set_name AS set_key, c.set_name AS set_name, c.set_code AS set_code, c.collector_number AS number, MAX(p.updated_day) AS lastmod";
  const rows = (await db
    .prepare(`${cardsSql(game, head)} ORDER BY c.id LIMIT ${SITEMAP_CHUNK} OFFSET ${(chunk - 1) * SITEMAP_CHUNK}`)
    .all(freshCutoff(today))) as unknown as CardRow[];
  const index = await setIndex(game);
  const indexed = await indexedIds(game, rows.map((r) => r.id), today);
  const out: SitemapEntry[] = [];
  for (const r of rows) {
    if (indexed && !indexed.has(r.id)) continue;
    const key = game === "mtg" ? `${r.set_code.toLowerCase()}-${r.number}` : r.id;
    if (parseCardKey(game, key) !== key) continue;
    const name = r.subtitle ? `${r.name} - ${r.subtitle}` : r.name;
    out.push({ path: cardPath(game, index.slugOf.get(r.set_key) ?? slugify(r.set_name, 80), name, key), lastmod: r.lastmod });
  }
  return out;
}

/** Card counts per public game: what the index needs to list every file. A failed count throws (the index answers 500 and is asked again) rather than silently dropping a game for a day. */
export async function cardSitemapCounts(today = todayUtc()): Promise<Partial<Record<GameId, number>>> {
  const counts: Partial<Record<GameId, number>> = {};
  for (const game of await publicCardGames()) counts[game] = await cardSitemapCount(game, today);
  return counts;
}

/**
 * The index's children for the public games, from their counts. The counts are a full scan per game, so they are kept in
 * card_cache for 20 hours (an object, which cachedList will store even when every count is zero): the index route is
 * dynamic on purpose (an ISR route with no params would run these scans inside `next build`) and its response is cached
 * a day by the CDN, so this is one small read when a crawler asks.
 */
export async function sitemapIndexChildren(today = todayUtc()): Promise<SitemapChild[]> {
  const { counts } = await cachedList("seo:sitemap-counts:v1", 20 * 60 * 60 * 1000, async () => ({ counts: await cardSitemapCounts(today) }));
  return sitemapChildren(counts);
}

/** The marketing pages, the help articles, /cards, each public game's hub and every set with a card at the floor. */
export async function pagesSitemapEntries(): Promise<SitemapEntry[]> {
  const entries = staticEntries(helpArticles.map((a) => a.id));
  for (const game of await publicCardGames()) {
    let index;
    try {
      index = await setIndex(game);
    } catch {
      continue;
    }
    if (index.sets.length === 0) continue;
    entries.push({ path: gamePath(game) });
    for (const s of index.sets) {
      const slug = index.slugOf.get(s.key);
      if (slug && s.qualifying > 0) entries.push({ path: setPath(game, slug) });
    }
  }
  return entries;
}
