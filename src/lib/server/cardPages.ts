import "server-only";
import { db } from "@/lib/db";
import { cachedList, cachedListSwr, cachedStaleOk, dropCachedLists } from "@/lib/server/listCache";
import { gamePublic, type GatedGame } from "@/lib/server/settings";
import { MTG_REFEREE_SQL, PRICE_TRUST, REF_ALT_SOURCE, lastPriced } from "@/lib/server/priceTrust";
import { judgeFull, judgeSeries, loadTrustData, readEbayAsks, readListingLows, type TrustData, type TrustSeries } from "@/lib/server/priceTrustSite";
import { largeImage } from "@/lib/server/mtgCards";
import { activeChecks, checkKey, CHECKED_MAX_DAYS } from "@/lib/server/checkedPrices";
import { addDays, dayIndex, decodePrices, toPoints, todayUtc } from "@/lib/priceSeries";
import { capBreakDay, cleanSeriesPoints, fromCapBreak } from "@/lib/priceOutliers";
import {
  CHART_MIN_POINTS,
  FRESH_DAYS,
  INDEX_FLOOR_USD,
  indexFloorUsd,
  changeOver,
  changeWords,
  displayNumber,
  gameFromSlug,
  headlinePrice,
  indexDecision,
  isUnverified,
  isSetSlug,
  keptPokemonId,
  parseCardKey,
  printingTags,
  setSlugs,
  slugify,
  tidySetName,
  variantLabel,
  variantPrices,
  type CardFacts,
  type CardView,
  type SeriesInput,
  type SetEntry,
} from "@/lib/cardPages";
import { historyRange, type HistoryRange, type SetStanding } from "@/lib/cardStory";
import type { Series } from "@/lib/client/priceHistoryData";
import type { GameId } from "@/lib/types";
import { toPics } from "@/lib/pics";

/**
 * The public card pages' reads (/cards, SEO sweep 09-30). Everything here is
 * built for the two bills: nothing runs at build, every page that uses it is
 * cached for days (on-demand ISR), and each loader is one read or one batch.
 *
 *  - a card page: one catalog row + ONE price_series read, used for the chart,
 *    the variant table, the 30/90-day words AND the price guard verdicts;
 *  - a set page: one catalog query + the guard's batched read (2 queries per
 *    400 cards), the same loader the set browser uses;
 *  - the set index of a game (name, slug, counts): one grouped query, kept in
 *    card_cache for a day and in memory for ten minutes;
 *  - "top cards" of a game or set: built once a day into card_cache.
 * Keys are checked by pattern (lib/cardPages.ts) before any of this runs.
 *
 * The price guard is not optional (docs/DESIGN.md data honesty): a printing the
 * rule flags never has its number printed. A guard that throws prints no price
 * at all (the page renders "no current price" and stays out of the index).
 */

const DAY_MS = 86_400_000;
const MEMO_MS = 10 * 60 * 1000;
const SETS_TTL_MS = DAY_MS;
const TOP_TTL_MS = DAY_MS;
/** Sets list sizes: a hub shows at most this many cards, most valuable first. */
export const SET_PAGE_CARDS = 300;
/** Tiles on a game hub and strip on a card page. */
export const TOP_TILES = 12;
export const STRIP_TILES = 6;

// ---------------------------------------------------------------------------
// Games

/** The game for a URL slug, only when the public can use it (admin-only games 404 and stay out of the sitemap). */
export async function publicCardGame(slug: string): Promise<GameId | null> {
  const game = gameFromSlug(slug);
  if (!game) return null;
  if (game === "pokemon") return game;
  return (await gamePublic(game as GatedGame)) ? game : null;
}

export async function publicCardGames(): Promise<GameId[]> {
  const all: GameId[] = ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"];
  const ok = await Promise.all(all.map(async (g) => (g === "pokemon" ? true : gamePublic(g as GatedGame))));
  return all.filter((_, i) => ok[i]);
}

/** The oldest last-priced day that still counts as current. */
export const freshCutoff = (today = todayUtc()) => addDays(today, -FRESH_DAYS);

// ---------------------------------------------------------------------------
// The set index of a game

interface SetRow {
  skey: string;
  name: string;
  code: string;
  rel: string | null;
  n: number;
  q: number;
  p: number;
}

const MTG_SKIPPED_SET_TYPES = "('token', 'memorabilia', 'minigame', 'alchemy')";

/** One grouped read per game: every set with its name, code, release date, picture count and how many cards are at the index floor. */
async function buildSets(game: GameId): Promise<SetEntry[]> {
  let rows: SetRow[];
  if (game === "pokemon") {
    const base = (await db
      .prepare(
        `SELECT set_id AS skey, MAX(set_name) AS name, MAX(set_code) AS code, MIN(set_release_date) AS rel,
                SUM(CASE WHEN image_url <> '' THEN 1 ELSE 0 END) AS n
           FROM en_cards WHERE set_id <> '' GROUP BY set_id`,
      )
      .all()) as unknown as Omit<SetRow, "q" | "p">[];
    const pricedFrom = async (floor: number) =>
      new Map(
        ((await db
          .prepare(
            `SELECT c.set_id AS skey, COUNT(*) AS q FROM en_cards c
              WHERE c.image_url <> '' AND c.id IN (
                SELECT card_id FROM price_series
                 WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD' AND updated_day >= ?
                   AND json_extract(prices, '$[#-1]') ${floor > 0 ? ">=" : ">"} ?)
              GROUP BY c.set_id`,
          )
          .all(freshCutoff(), floor)) as unknown as { skey: string; q: number }[]).map((r) => [r.skey, Number(r.q)]),
      );
    const [q, p] = await Promise.all([pricedFrom(INDEX_FLOOR_USD), pricedFrom(0)]);
    rows = base.map((r) => ({ ...r, q: q.get(r.skey) ?? 0, p: p.get(r.skey) ?? 0 }));
  } else if (game === "mtg") {
    rows = (await db
      .prepare(
        `SELECT c.set_code AS skey, MAX(s.name) AS name, c.set_code AS code, MAX(s.released_at) AS rel, COUNT(*) AS n,
                SUM(CASE WHEN c.price_usd >= ? OR c.price_usd_foil >= ? OR c.price_usd_etched >= ? THEN 1 ELSE 0 END) AS q,
                SUM(CASE WHEN c.price_usd > 0 OR c.price_usd_foil > 0 OR c.price_usd_etched > 0 THEN 1 ELSE 0 END) AS p
           FROM mtg_cards c JOIN mtg_sets s ON s.code = c.set_code
          WHERE s.set_type NOT IN ${MTG_SKIPPED_SET_TYPES} AND c.image_url <> '' AND c.lang = 'en'
          GROUP BY c.set_code`,
      )
      .all(INDEX_FLOOR_USD, INDEX_FLOOR_USD, INDEX_FLOOR_USD)) as unknown as SetRow[];
  } else {
    rows = (await db
      .prepare(
        `SELECT set_code || '|' || set_name AS skey, set_name AS name, set_code AS code, MIN(set_release_date) AS rel, COUNT(*) AS n,
                SUM(CASE WHEN price_usd >= ? OR price_usd_foil >= ? THEN 1 ELSE 0 END) AS q,
                SUM(CASE WHEN price_usd > 0 OR price_usd_foil > 0 THEN 1 ELSE 0 END) AS p
           FROM tcg_cards WHERE game = ? AND image_url <> '' AND id NOT LIKE '%#%'
          GROUP BY set_code, set_name`,
      )
      .all(indexFloorUsd(game), indexFloorUsd(game), game)) as unknown as SetRow[];
  }
  return rows
    .filter((r) => Number(r.n) > 0 && (r.name || r.code))
    .map((r) => ({ key: r.skey, name: tidySetName(r.name || r.code), code: r.code ?? "", release: r.rel ?? "", count: Number(r.n), qualifying: Number(r.q), priced: Number(r.p) }))
    .sort((a, b) => (b.release || "").localeCompare(a.release || "") || a.name.localeCompare(b.name));
}

/** A set's value (10-17, task #63): the sum of its cards' current prices, and how many cards that is. */
export interface SetValue {
  key: string;
  total: number;
  n: number;
}

/**
 * Every set's value for one game, most valuable first, one grouped read a day. A sum over hundreds of sets cannot go
 * through the full guard per card, so the cheap filters the catalog already trusts stand in: Pokemon takes each card's
 * dearest fresh printing but skips a price 3x or more its level a week before (a fresh spike, the Charizard $1,400 ->
 * $6,999 kind); Magic keeps only prices the Cardmarket referee lets through (MTG_REFEREE_SQL); the young games read
 * the catalog price. Empty on any failure: the section just does not show.
 */
export async function setValues(game: GameId): Promise<SetValue[]> {
  try {
    // ~21 s on Turso for Pokemon (a json walk of every series): stale-while-revalidate, never on a visitor's clock.
    const { value } = await cachedListSwr(`seo:setvalues:v1:${game}`, TOP_TTL_MS, async () => {
      let rows: { skey: string; total: number; n: number }[];
      if (game === "pokemon") {
        rows = (await db
          .prepare(
            `SELECT c.set_id AS skey, SUM(v.p) AS total, COUNT(*) AS n FROM en_cards c JOIN (
               SELECT card_id, MAX(json_extract(prices, '$[#-1]')) AS p FROM price_series
                WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD' AND updated_day >= ?
                  AND json_extract(prices, '$[#-1]') > 0
                  AND NOT (json_extract(prices, '$[#-8]') > 0 AND json_extract(prices, '$[#-1]') >= 3 * json_extract(prices, '$[#-8]'))
                GROUP BY card_id) v ON v.card_id = c.id
              WHERE c.image_url <> '' GROUP BY c.set_id`,
          )
          .all(freshCutoff())) as unknown as typeof rows;
      } else if (game === "mtg") {
        rows = (await db
          .prepare(
            `SELECT set_code AS skey, SUM(price_usd) AS total, COUNT(*) AS n FROM mtg_cards
              WHERE price_usd > 0 AND image_url <> '' AND lang = 'en' AND ${MTG_REFEREE_SQL} GROUP BY set_code`,
          )
          .all()) as unknown as typeof rows;
      } else {
        rows = (await db
          .prepare(
            `SELECT set_code || '|' || set_name AS skey, SUM(COALESCE(NULLIF(price_usd, 0), price_usd_foil)) AS total, COUNT(*) AS n
               FROM tcg_cards WHERE game = ? AND image_url <> '' AND id NOT LIKE '%#%' AND (price_usd > 0 OR price_usd_foil > 0)
              GROUP BY set_code, set_name`,
          )
          .all(game)) as unknown as typeof rows;
      }
      return rows
        .map((r) => ({ key: r.skey, total: Math.round(Number(r.total) * 100) / 100, n: Number(r.n) }))
        .filter((r) => r.total > 0)
        .sort((a, b) => b.total - a.total);
    }, [] as SetValue[]);
    return value;
  } catch (err) {
    console.warn(`card pages: could not total the ${game} sets`, err);
    return [];
  }
}

export interface SetIndex {
  /** Newest first. */
  sets: SetEntry[];
  slugOf: Map<string, string>;
  bySlug: Map<string, SetEntry>;
}

const setMemo = new Map<GameId, { at: number; index: SetIndex }>();

/** The game's sets with their slugs. Empty when the mirror is not synced (a fresh dev database): every page then 404s or shows an empty state. */
export async function setIndex(game: GameId): Promise<SetIndex> {
  const hit = setMemo.get(game);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.index;
  let sets: SetEntry[] = [];
  try {
    // Stale-ok (10-17): the Pokemon build is two json walks of every price series; a visitor never waits on a rebuild.
    sets = await cachedStaleOk(`seo:sets:v4:${game}`, SETS_TTL_MS, () => buildSets(game), Date.now(), { skipEmpty: true });
  } catch (err) {
    console.warn(`card pages: could not read the ${game} set list`, err);
  }
  const slugOf = setSlugs(sets);
  const bySlug = new Map<string, SetEntry>();
  for (const s of sets) bySlug.set(slugOf.get(s.key) ?? "", s);
  const index = { sets, slugOf, bySlug };
  if (sets.length > 0) setMemo.set(game, { at: Date.now(), index });
  return index;
}

/** The set a hub URL names, or null. The slug is pattern-checked first. */
export async function setBySlug(game: GameId, slug: string): Promise<{ set: SetEntry; slug: string } | null> {
  if (!isSetSlug(slug)) return null;
  const index = await setIndex(game);
  const set = index.bySlug.get(slug);
  if (set) return { set, slug };
  // A name-twin's slug ("{name}-{code}") outlives its twin: after the duplicate Trainer Galleries left (10-14) the kept
  // set took the plain slug, so its old "-brs" address answers with the set and its current slug (the page redirects).
  for (const s of index.sets) {
    const now = index.slugOf.get(s.key) ?? "";
    if (now && slug === `${now}-${slugify(s.code || s.key, 20)}`) return { set: s, slug: now };
  }
  return null;
}

// ---------------------------------------------------------------------------
// One card

interface CatalogRow {
  id: string;
  name: string;
  subtitle?: string;
  set_key: string;
  set_name: string;
  set_code: string;
  number: string;
  set_total: number | null;
  release: string | null;
  rarity: string | null;
  variant: string | null;
  image_url: string;
  /** Our stored copies (tcg_cards and en_cards, 10-12): preferred over image_url when set. */
  own_image_url?: string;
  own_tile_url?: string;
  price_eur?: number | null;
  price_eur_foil?: number | null;
}

/** What the guard needs beyond the series: the set's release date and (Magic) Scryfall's Cardmarket prices. */
export interface CardRecord {
  facts: CardFacts;
  released: string;
  eur: { nonfoil: number | null; foil: number | null } | null;
}

function factsOf(game: GameId, row: CatalogRow, setSlug: string): CardFacts {
  const name = row.subtitle ? `${row.name} - ${row.subtitle}` : row.name;
  const setCode = game === "mtg" ? row.set_code.toUpperCase() : row.set_code;
  const key = game === "mtg" ? `${row.set_code.toLowerCase()}-${row.number}` : row.id;
  const rarity = game === "mtg" && row.rarity ? row.rarity[0].toUpperCase() + row.rarity.slice(1) : (row.rarity ?? "");
  return {
    game,
    id: row.id,
    key,
    name,
    number: displayNumber(game, { number: row.number, setTotal: row.set_total, setCode }),
    setKey: row.set_key,
    setSlug,
    setName: tidySetName(row.set_name),
    setCode,
    release: row.release ?? "",
    rarity,
    tags: printingTags(game, { id: row.id, rarity: game === "yugioh" ? row.rarity : null, variant: row.variant }),
    image: toPics(game === "mtg" ? row.own_image_url || largeImage(row.image_url) : game === "pokemon" ? row.own_image_url || row.image_url.replace("/low.webp", "/high.webp") : row.own_image_url || row.image_url),
    tile: toPics(row.own_tile_url || row.own_image_url || ""),
  };
}

/**
 * The catalog row a key names, as page facts. null = no such card, or one that gets no page: not in the catalog (an
 * orphan series, a Japanese id), no picture, a Magic token / art-card set. One indexed row read.
 */
export async function loadCardRecord(game: GameId, rawKey: string): Promise<CardRecord | null> {
  const key = parseCardKey(game, rawKey);
  if (!key) return null;
  let row: CatalogRow | undefined;
  if (game === "pokemon") {
    row = (await db
      .prepare(
        `SELECT id, name, set_id AS set_key, set_name, set_code, local_id AS number, set_card_count_official AS set_total,
                set_release_date AS release, image_url, own_image_url, own_tile_url, NULL AS rarity, NULL AS variant
           FROM en_cards WHERE id = ?`,
      )
      .get(keptPokemonId(key))) as CatalogRow | undefined;
  } else if (game === "mtg") {
    const cut = key.indexOf("-");
    const r = (await db
      .prepare(
        `SELECT c.id, c.name, c.set_code AS set_key, c.set_name, c.set_code, c.collector_number AS number, NULL AS set_total,
                c.set_release_date AS release, c.image_url, c.own_image_url, c.own_tile_url, c.rarity, NULL AS variant, c.price_eur, c.price_eur_foil,
                c.lang, s.set_type
           FROM mtg_cards c LEFT JOIN mtg_sets s ON s.code = c.set_code
          WHERE c.set_code = ? AND c.collector_number = ?`,
      )
      .get(key.slice(0, cut), key.slice(cut + 1))) as (CatalogRow & { lang: string; set_type: string | null }) | undefined;
    if (r && r.lang === "en" && !new Set(["token", "memorabilia", "minigame", "alchemy"]).has(r.set_type ?? "")) row = r;
  } else {
    row = (await db
      .prepare(
        `SELECT id, name, subtitle, set_code || '|' || set_name AS set_key, set_name, set_code, collector_number AS number, set_total,
                set_release_date AS release, rarity, variant, image_url, own_image_url, own_tile_url
           FROM tcg_cards WHERE id = ? AND game = ?`,
      )
      .get(key, game)) as CatalogRow | undefined;
  }
  if (!row || !row.image_url) return null;
  const index = await setIndex(game);
  const facts = factsOf(game, row, index.slugOf.get(row.set_key) ?? slugify(row.set_name, 80));
  return {
    facts,
    released: row.release ?? "",
    eur: game === "mtg" ? { nonfoil: row.price_eur ?? null, foil: row.price_eur_foil ?? null } : null,
  };
}

interface SeriesRow {
  variant: string;
  source: string;
  currency: string;
  start_day: string;
  prices: string;
  updated_day: string;
}

/** Everything a card page prints about price, from ONE price_series read. */
export interface CardPage extends CardView {
  /** The headline printing's series for the server-rendered chart; null = under CHART_MIN_POINTS priced days (or no headline). */
  chart: Series[] | null;
  /** The day the headline series began, for "Tracking since …" when there is no chart. */
  trackingSince: string | null;
  /** "Up 12.3% over the last 30 days" lines, the guard-checked ones only. */
  changes: string[];
  /** The headline series' high and low for the range sentence; null under two points or when the guard doubts either end. */
  range: HistoryRange | null;
  /** The headline is a hand eBay sold check's price (checkedPrices.ts: TCGplayer's own number was off): "Checked against eBay sold". */
  checked?: { n: number; day: string } | null;
  /** Recorded days of the headline series, before-the-cap-break ones included (the confidence badge; chart and words start at the break). */
  dataDays?: number;
}

const NO_PRICE: Pick<CardPage, "prices" | "headline" | "chart" | "trackingSince" | "changes" | "range"> = { prices: [], headline: null, chart: null, trackingSince: null, changes: [], range: null };

/** The price side of a card page: fresh printings with the guard's verdicts, the change words, the chart. Fails closed: a guard error prints no price. */
export async function loadCardPage(rec: CardRecord, today = todayUtc()): Promise<CardPage> {
  const { facts } = rec;
  let rows: SeriesRow[];
  let lows: Record<string, number> | undefined;
  let asks: TrustData["asks"];
  try {
    const [seriesRows, lowsById, asksById] = await Promise.all([
      db.prepare("SELECT variant, source, currency, start_day, prices, updated_day FROM price_series WHERE card_id = ?").all(facts.id) as unknown as Promise<SeriesRow[]>,
      readListingLows(facts.game, [facts.id], today),
      readEbayAsks(facts.game, [facts.id], today),
    ]);
    rows = seriesRows;
    lows = lowsById.get(facts.id);
    asks = asksById.get(facts.id);
  } catch (err) {
    console.warn(`card pages: could not read the price series of ${facts.id}`, err);
    return { facts, decision: indexDecision([]), ...NO_PRICE };
  }
  const cmSince = addDays(today, -PRICE_TRUST.refMaxAgeDays);
  const series: TrustSeries[] = [];
  let cmEur: number | null = null;
  let cmEurAlt: number | null = null;
  let convertedUsd: number | null = null;
  let convertedLabel = "Cardmarket (converted from €)";
  for (const r of rows) {
    const prices = decodePrices(r.prices);
    if (r.source === "cardmarket-converted" || r.source === "cardtrader") {
      // CardTrader (Yu-Gi-Oh listings, 10-06) outranks a converted Cardmarket figure when both are fresh.
      if (r.updated_day >= cmSince && (convertedUsd == null || r.source === "cardtrader")) {
        convertedUsd = lastPriced(prices);
        if (r.source === "cardtrader") convertedLabel = "CardTrader (listings)";
      }
    } else if (r.source === "cardmarket" && r.variant === "average") {
      if (r.updated_day >= cmSince) cmEur = lastPriced(prices);
    } else if (r.source === REF_ALT_SOURCE && r.variant === "average") {
      if (r.updated_day >= cmSince) cmEurAlt = lastPriced(prices);
    } else if (r.source === "tcgplayer" && r.currency === "USD" && prices.some((p) => p != null)) {
      series.push({ variant: r.variant, startDay: r.start_day, prices });
    }
  }
  const data: TrustData = { game: facts.game, series, cmEur, cmEurAlt, eur: rec.eur, released: rec.released, lows, asks };

  let inputs: SeriesInput[];
  try {
    // The stale note (10-02) rides along: a price that has stood 45+ days is printed with "Market hasn't updated this in N months".
    inputs = series.map((s) => ({ ...s, ...judgeFull(data, { variant: s.variant, exact: true, day: today }) }));
  } catch (err) {
    console.warn(`card pages: the price guard failed on ${facts.id}, printing no price`, err);
    return { facts, decision: indexDecision([]), ...NO_PRICE };
  }

  const prices = variantPrices(facts.game, inputs, today);
  const headline = headlinePrice(prices);
  // No fresh dollar price at all (10-03: Black Lotus, every print; TCGplayer publishes nothing for it, its last series point
  // is from August): the page prints Cardmarket's figure in dollars at the cached ECB rate (lib/listing.ts withEurMarket is
  // the same rule for scans and search). No history behind it: no chart, no change words, not indexed on it (unverified).
  if (prices.length === 0 && rec.eur) {
    const variant = rec.eur.nonfoil ? "nonfoil" : rec.eur.foil ? "foil" : null;
    const eur = variant === "nonfoil" ? rec.eur.nonfoil : rec.eur.foil;
    const rate = variant && eur ? await (await import("@/lib/server/fx")).usdPerEur().catch(() => null) : null;
    if (variant && eur && rate) {
      const converted = [{ variant, label: variantLabel(facts.game, variant), price: Math.round(eur * rate * 100) / 100, day: today, days: 0, flag: null }];
      return { facts, prices: converted, headline: converted[0], decision: indexDecision(converted, indexFloorUsd(facts.game)), chart: null, trackingSince: null, changes: [], range: null };
    }
  }
  // Pokémon's version of the same (10-05): the nightly job stored Cardmarket's figure in dollars for a card TCGplayer can't price.
  if (prices.length === 0 && convertedUsd != null && convertedUsd > 0) {
    const converted = [{ variant: "average", label: convertedLabel, price: convertedUsd, day: today, days: 0, flag: null }];
    return { facts, prices: converted, headline: converted[0], decision: indexDecision(converted, indexFloorUsd(facts.game)), chart: null, trackingSince: null, changes: [], range: null };
  }
  const decision = indexDecision(prices, indexFloorUsd(facts.game));
  if (!headline) return { facts, prices, headline, decision, chart: null, trackingSince: null, changes: [], range: null };

  const line = series.find((s) => s.variant === headline.variant);
  // Junk blips out and history from the listing-cap break on (lib/priceOutliers.ts): chart, high/low and change words all
  // read these. The confidence badge still counts every recorded day (dataDays): the price did not get younger.
  const allPoints = line ? cleanSeriesPoints(line) : [];
  const points = fromCapBreak(allPoints, facts.game);
  const dataDays = points.length < allPoints.length ? allPoints.length : undefined; // only a cut series reads differently
  const changes: string[] = [];
  for (const days of [30, 90]) {
    const c = changeOver(points, days);
    if (!c) continue;
    // The OLD side of the move is judged strictest (a stale old price is not a market price): a flagged one drops the line.
    const back = dayIndex(c.from.day, headline.day);
    if (judgeSeries(data, { variant: headline.variant, exact: true, day: headline.day, old: { back, value: c.from.price } })) continue;
    changes.push(changeWords(c.pct, days));
  }
  const chart: Series[] | null = points.length >= CHART_MIN_POINTS ? [{ variant: headline.variant, source: "tcgplayer", currency: "USD", points }] : null;
  // The range sentence (10-02): its high and low go through the same old-side check as the change words, so a junk spike
  // the guard would not print as a price is never printed as "the high" either; one doubted end drops the sentence.
  let range = historyRange(points);
  for (const end of range ? [range.high, range.low] : []) {
    const back = dayIndex(end.day, headline.day);
    if (back > 0 && judgeSeries(data, { variant: headline.variant, exact: true, day: headline.day, old: { back, value: end.price } })) {
      range = null;
      break;
    }
  }
  // Read fresh: a page is cached for 48 h, so it must not be built from a memo older than the check (10-18).
  const check = (await activeChecks({ fresh: true })).get(checkKey(facts.game, facts.id, headline.variant));
  const checked = check && Math.abs(headline.price - check.usd) < 0.005 ? { n: check.n, day: check.day } : null;
  // A checked price has no change words or range, and its chart starts where the fix does: the history before is
  // TCGplayer's number, the one found wrong (10-18, Rare Candy: "Down 33.6% over 90 days" and a chart drop from
  // TCGplayer's frozen $191.88 to the checked $122).
  if (checked) {
    const since = addDays(checked.day, -CHECKED_MAX_DAYS);
    const kept = points.filter((p) => p.day >= since);
    const fixedChart: Series[] | null = kept.length >= CHART_MIN_POINTS ? [{ variant: headline.variant, source: "tcgplayer", currency: "USD", points: kept }] : null;
    return { facts, prices, headline, decision, chart: fixedChart, trackingSince: kept[0]?.day ?? null, changes: [], range: null, checked, dataDays };
  }
  return { facts, prices, headline, decision, chart, trackingSince: points[0]?.day ?? null, changes, range, checked, dataDays };
}

// ---------------------------------------------------------------------------
// Cards of a set

/** One line of a set page or a strip: what a list may say about a card. `price` null = the guard flagged it (the number is never printed). */
export interface SetCard {
  key: string;
  name: string;
  number: string;
  tags: string[];
  image: string;
  /** Our small list copy when we have one ('' = use image). */
  tile?: string;
  price: number | null;
  flagged: boolean;
  /** A price too high for the history behind it (lib/cardPages.ts isUnverified): never listed or featured. */
  unverified: boolean;
  /** Price unmoved 45+ days (the guard's stale note): shown on its own page, never ranked or featured. */
  stale?: boolean;
  /** The same printing's value 7 / 30 days back (the set summary strip, 10-17 #62); null = no point that far back. */
  was7?: number | null;
  was30?: number | null;
}

/** A series' value `back` days before `today` (the last point on or before that day), or null; null before its listing-cap break too. */
function valueBack(s: TrustSeries | undefined, today: string, back: number, game: GameId): number | null {
  if (!s) return null;
  const brk = capBreakDay(toPoints(s), game);
  if (brk && addDays(today, -back) < brk) return null;
  const i = Math.min(dayIndex(s.startDay, addDays(today, -back)), s.prices.length - 1);
  for (let j = i; j >= 0; j--) if (s.prices[j] != null) return s.prices[j];
  return null;
}

/** The columns every list read selects, per catalog table, shaped as a CatalogRow. */
const LIST_SELECT = {
  pokemon: `SELECT id, name, set_id AS set_key, set_name, set_code, local_id AS number, set_card_count_official AS set_total,
                   set_release_date AS release, image_url, own_image_url, own_tile_url, NULL AS rarity, NULL AS variant FROM en_cards`,
  mtg: `SELECT id, name, set_code AS set_key, set_name, set_code, collector_number AS number, NULL AS set_total,
               set_release_date AS release, image_url, own_image_url, own_tile_url, rarity, NULL AS variant FROM mtg_cards`,
  tcg: `SELECT id, name, subtitle, set_code || '|' || set_name AS set_key, set_name, set_code, collector_number AS number, set_total,
               set_release_date AS release, rarity, variant, image_url, own_image_url, own_tile_url FROM tcg_cards`,
} as const;

/** Catalog rows with a picture and a key a page can have. */
async function catalogRows(game: GameId, where: string, args: (string | number)[]): Promise<(CatalogRow & { key: string })[]> {
  const table = game === "pokemon" ? "pokemon" : game === "mtg" ? "mtg" : "tcg";
  const extra = game === "mtg" ? " AND lang = 'en'" : game === "pokemon" ? "" : " AND id NOT LIKE '%#%'";
  const guard = game === "pokemon" || game === "mtg" ? "" : " AND game = ?";
  const rows = (await db
    .prepare(`${LIST_SELECT[table]} WHERE image_url <> ''${extra}${guard} AND ${where}`)
    .all(...(guard ? [game, ...args] : args))) as unknown as CatalogRow[];
  const out: (CatalogRow & { key: string })[] = [];
  for (const r of rows) {
    const key = game === "mtg" ? `${r.set_code.toLowerCase()}-${r.number}` : r.id;
    if (parseCardKey(game, key) === key) out.push({ ...r, key });
  }
  return out;
}

/** Every catalog row of a set, printed order not guaranteed (the page sorts by value). */
/** Every printing with the guard's full verdict: the flag AND the stale note (judgeSeries alone drops `stale`, which left every list's `head.stale` filter dead until 10-07). */
const judgedSeries = (data: TrustData, day: string) => data.series.map((s) => ({ ...s, ...judgeFull(data, { variant: s.variant, exact: true, day }) }));

function setCatalog(game: GameId, set: SetEntry) {
  if (game === "pokemon") return catalogRows(game, "set_id = ?", [set.key]);
  if (game === "mtg") return catalogRows(game, "set_code = ?", [set.key]);
  const cut = set.key.indexOf("|");
  return catalogRows(game, "set_code = ? AND set_name = ?", [set.key.slice(0, cut), set.key.slice(cut + 1)]);
}

/** The rows of these catalog ids (at most a few dozen: the top-card candidates). */
function catalogByIds(game: GameId, ids: string[]) {
  return catalogRows(game, `id IN (${ids.map(() => "?").join(",")})`, ids);
}

/**
 * The cards of a set that have a fresh price, most valuable first (flagged ones last, with no number), each with
 * the price the guard believes. One catalog query and the guard's batched read. A guard that fails empties the list.
 */
export async function loadSetCards(game: GameId, set: SetEntry, today = todayUtc()): Promise<SetCard[]> {
  const rows = await setCatalog(game, set);
  if (rows.length === 0) return [];
  let trust: Map<string, TrustData>;
  try {
    trust = await loadTrustData(rows.map((r) => ({ cardId: r.id, game })), today);
  } catch (err) {
    console.warn(`card pages: the price guard failed on ${game} set ${set.key}`, err);
    return [];
  }
  const out: SetCard[] = [];
  for (const r of rows) {
    const data = trust.get(r.id);
    if (!data) continue;
    const prices = variantPrices(game, judgedSeries(data, today), today);
    if (prices.length === 0) continue;
    const head = headlinePrice(prices);
    const f = factsOf(game, r, "");
    const own = head ? data.series.find((s) => s.variant === head.variant) : undefined;
    out.push({ key: r.key, name: f.name, number: f.number, tags: f.tags, image: f.image, tile: f.tile, price: head ? head.price : null, flagged: !head, unverified: head ? isUnverified(head) : false, ...(head?.stale ? { stale: true } : {}), was7: valueBack(own, today, 7, game), was30: valueBack(own, today, 30, game) });
  }
  return out.sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || a.name.localeCompare(b.name) || a.number.localeCompare(b.number, "en", { numeric: true }));
}

// ---------------------------------------------------------------------------
// Top cards (game hub, "more from this set")

/** A tile: enough to draw a card and link to it. */
export interface Tile extends SetCard {
  setSlug: string;
  setName: string;
}

/**
 * Cached JSON list, never throwing: an outage means an empty strip, not a failed page. Wrapped in an object because
 * cachedList will not memo an empty array, and a set with nothing priced must not be rebuilt on every page.
 */
async function cachedTiles(key: string, build: () => Promise<Tile[]>): Promise<Tile[]> {
  try {
    return (await cachedList(key, TOP_TTL_MS, async () => ({ tiles: await build() }))).tiles;
  } catch (err) {
    console.warn(`card pages: could not build ${key}`, err);
    return [];
  }
}

/** The most valuable cards of one set the guard believes, for the strip on a card page. Built once a day per set. */
export async function setTopTiles(game: GameId, set: SetEntry, setSlug: string): Promise<Tile[]> {
  return cachedTiles(`seo:settop:v3:${game}:${set.key}`, async () => {
    const cards = (await loadSetCards(game, set)).filter((c) => c.price != null && c.price >= indexFloorUsd(game) && !c.unverified && !c.stale).slice(0, STRIP_TILES + 1);
    return cards.map((c) => ({ ...c, setSlug, setName: set.name }));
  });
}

// ---------------------------------------------------------------------------
// Rank in the set + other printings (SEO content 10-02, Chris: "maximize our SEO")

/** The set's priced cards in value order with the median: one list per set a day, from which every card page reads its own rank. */
interface SetStandings {
  /** Card keys, most valuable first (believed, verified prices at the index floor or more). */
  order: string[];
  median: number;
}

async function setStandings(game: GameId, set: SetEntry): Promise<SetStandings> {
  try {
    return await cachedList(`seo:setrank:v5:${game}:${set.key}`, TOP_TTL_MS, async () => {
      const cards = (await loadSetCards(game, set)).filter((c) => c.price != null && c.price >= indexFloorUsd(game) && !c.unverified && !c.stale);
      const prices = cards.map((c) => c.price as number).sort((a, b) => a - b);
      const mid = prices.length >> 1;
      const median = prices.length === 0 ? 0 : prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
      return { order: cards.map((c) => c.key), median };
    });
  } catch (err) {
    console.warn(`card pages: could not rank ${game} set ${set.key}`, err);
    return { order: [], median: 0 };
  }
}

/** Where a card sits among its set's priced cards; null when the set is unranked or the card is not in the ranked list. */
export async function setStanding(game: GameId, set: SetEntry, key: string): Promise<SetStanding | null> {
  const s = await setStandings(game, set);
  const at = s.order.indexOf(key);
  if (at < 0) return null;
  return { rank: at + 1, priced: s.order.length, median: s.median };
}

/** A card next to this one in its set, for the "← #3 Venusaur" link: just enough to build the URL and the label. */
export interface Neighbor {
  key: string;
  name: string;
  /** The catalog collector number as stored ("3", "TG01", "LOB-001"). */
  number: string;
}

/**
 * The cards before and after this one in the set's collector-number order (numbers compared as numbers, so 9 comes before
 * 10). One list per set a day (the same one read as the other card-page lists); cards that have no page are not in it.
 * Empty on any failure: the links just do not show.
 */
export async function setNeighbors(game: GameId, set: SetEntry, key: string): Promise<{ prev: Neighbor | null; next: Neighbor | null }> {
  const none = { prev: null, next: null };
  try {
    const order = await cachedList(`seo:setorder:v1:${game}:${set.key}`, TOP_TTL_MS, async () => {
      const rows = await setCatalog(game, set);
      return rows
        .map((r) => ({ key: r.key, name: factsOf(game, r, "").name, number: r.number }))
        .sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    });
    const at = order.findIndex((c) => c.key === key);
    if (at < 0) return none;
    return { prev: order[at - 1] ?? null, next: order[at + 1] ?? null };
  } catch (err) {
    console.warn(`card pages: could not read the card order of ${game} set ${set.key}`, err);
    return none;
  }
}

/** Catalog rows that share this card's name in other sets (Pokémon reprints, Magic reprints, Yu-Gi-Oh! alternate sets). At most 40 rows before the guard. */
function sameNameRows(game: GameId, name: string) {
  // The page name of a tcg_cards row is "name - subtitle"; the lookup is by the bare name column, so sister printings with another subtitle (One Piece parallels) are found too.
  // The page's own card is NOT excluded here: the list is cached per name and read by every printing's page, so the
  // exclusion happens at read time (until 10-14 the first page to build the memo excluded only itself, and every other
  // Charizard page listed itself).
  const bare = game === "pokemon" || game === "mtg" ? name : name.split(" - ")[0];
  return catalogRows(game, "name = ? LIMIT 41", [bare]);
}

/**
 * Other printings of the same card, most valuable first, each with the price the guard believes: the tiles for
 * "Other <name> cards". Built once a day per name; flagged and unverified ones are left out (a list never prints a
 * doubted number). Empty when the card is the only printing.
 */
export async function otherPrintings(game: GameId, f: Pick<CardFacts, "name" | "key">, limit = TOP_TILES): Promise<Tile[]> {
  const all = await cachedTiles(printingsKey(game, f.name), async () => {
    const rows = await sameNameRows(game, f.name);
    if (rows.length === 0) return [];
    const index = await setIndex(game);
    const trust = await loadTrustData(rows.map((r) => ({ cardId: r.id, game })), todayUtc());
    const out: Tile[] = [];
    for (const r of rows) {
      const data = trust.get(r.id);
      if (!data) continue;
      const today = todayUtc();
      const prices = variantPrices(game, judgedSeries(data, today), today);
      const head = headlinePrice(prices);
      if (!head || head.price < indexFloorUsd(game) || isUnverified(head) || head.stale) continue;
      const setSlug = index.slugOf.get(r.set_key);
      if (!setSlug) continue;
      const fx = factsOf(game, r, setSlug);
      out.push({ key: r.key, name: fx.name, number: fx.number, tags: fx.tags, image: fx.image, tile: fx.tile, price: head.price, flagged: false, unverified: false, setSlug, setName: fx.setName });
    }
    return out.sort((a, b) => (b.price ?? 0) - (a.price ?? 0)).slice(0, limit + 1);
  });
  return all.filter((t) => t.key !== f.key).slice(0, limit);
}

const printingsKey = (game: GameId, name: string) => `seo:printings:v3:${game}:${name}`;

/**
 * The cached lists a hand call on one card can change (its set's strip, its "Other <name> cards" strip, the game's top
 * tiles): dropped right after the call so the next page build shows the verdict, not the day-old number (10-14: the
 * Base Set Charizard was hidden at 2:45pm and its sister pages kept printing $968.91). One indexed row read; never throws.
 */
export async function dropCardLists(game: GameId, cardId: string): Promise<void> {
  try {
    const [row] = await catalogRows(game, "id = ?", [cardId]);
    if (!row) return;
    const f = factsOf(game, row, "");
    await dropCachedLists([printingsKey(game, f.name), `seo:settop:v3:${game}:${row.set_key}`, `seo:top:v3:${game}`]);
  } catch (err) {
    console.warn(`card pages: could not drop the lists of ${game} ${cardId}`, err);
  }
}

/**
 * Every printing whose name has this word in it (Charizard → "Charizard ex", "Dark Charizard", "Charizard & Braixen-GX"),
 * most valuable first, each with the price the guard believes: the grid of the ad landing pages (lib/nameLandings.ts,
 * Chris 10-07). One LIKE walk of the catalog per name a day, then cached; the term comes from a fixed list, never the URL.
 */
export async function nameTiles(game: GameId, term: string, limit = 60): Promise<{ tiles: Tile[]; priced: number }> {
  const tiles = await cachedTiles(`seo:namelist:v3:${game}:${term.toLowerCase()}`, async () => {
    const word = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const rows = (await catalogRows(game, "name LIKE ?", [`%${term}%`])).filter((r) => word.test(r.name));
    if (rows.length === 0) return [];
    const index = await setIndex(game);
    const today = todayUtc();
    const trust = await loadTrustData(rows.map((r) => ({ cardId: r.id, game })), today);
    const out: Tile[] = [];
    for (const r of rows) {
      const data = trust.get(r.id);
      if (!data) continue;
      const prices = variantPrices(game, judgedSeries(data, today), today);
      const head = headlinePrice(prices);
      if (!head || isUnverified(head) || head.stale) continue;
      const setSlug = index.slugOf.get(r.set_key);
      if (!setSlug) continue;
      const fx = factsOf(game, r, setSlug);
      out.push({ key: r.key, name: fx.name, number: fx.number, tags: fx.tags, image: fx.image, tile: fx.tile, price: head.price, flagged: false, unverified: false, setSlug, setName: fx.setName });
    }
    return out.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  });
  return { tiles: tiles.slice(0, limit), priced: tiles.length };
}

/** Top candidates by catalog price, dearer first; the guard prunes them afterwards. */
async function topCandidates(game: GameId, limit: number): Promise<{ id: string; set_key: string }[]> {
  if (game === "pokemon") {
    return (await db
      .prepare(
        // The catalog join comes BEFORE the limit: sealed, graded and orphan series share the table and hold the dearest "prices".
        `SELECT c.id AS id, c.set_id AS set_key FROM en_cards c
           JOIN (SELECT card_id, MAX(json_extract(prices, '$[#-1]')) AS v FROM price_series
                  WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD' AND updated_day >= ?
                  GROUP BY card_id) t ON t.card_id = c.id
          WHERE c.image_url <> ''
          ORDER BY t.v DESC LIMIT ?`,
      )
      .all(freshCutoff(), limit)) as unknown as { id: string; set_key: string }[];
  }
  if (game === "mtg") {
    return (await db
      .prepare(
        `SELECT c.id AS id, c.set_code AS set_key FROM mtg_cards c JOIN mtg_sets s ON s.code = c.set_code
          WHERE c.image_url <> '' AND c.lang = 'en' AND s.set_type NOT IN ${MTG_SKIPPED_SET_TYPES}
          ORDER BY MAX(COALESCE(c.price_usd, 0), COALESCE(c.price_usd_foil, 0), COALESCE(c.price_usd_etched, 0)) DESC LIMIT ?`,
      )
      .all(limit)) as unknown as { id: string; set_key: string }[];
  }
  return (await db
    .prepare(
      `SELECT id, set_code || '|' || set_name AS set_key FROM tcg_cards
        WHERE game = ? AND image_url <> '' AND id NOT LIKE '%#%'
        ORDER BY MAX(COALESCE(price_usd, 0), COALESCE(price_usd_foil, 0)) DESC LIMIT ?`,
    )
    .all(game, limit)) as unknown as { id: string; set_key: string }[];
}

/**
 * The game hub's "most valuable" tiles: the dearest cards by catalog price, each one run through the guard (the dearest
 * prices are exactly where the junk is) and kept only when it has a fresh, believed price. Built once a day.
 */
export async function gameTopTiles(game: GameId): Promise<Tile[]> {
  return cachedTiles(`seo:top:v3:${game}`, () => buildTopTiles(game, TOP_TILES, TOP_TILES * 10));
}

/** The Top 100 page (10-17, #65): the same guarded build, 100 deep from 400 candidates. Built once a day. */
export const TOP_LIST = 100;
export async function gameTop100(game: GameId): Promise<Tile[]> {
  return cachedTiles(`seo:top100:v1:${game}`, () => buildTopTiles(game, TOP_LIST, TOP_LIST * 4));
}

async function buildTopTiles(game: GameId, n: number, pool: number): Promise<Tile[]> {
  const candidates = await topCandidates(game, pool);
  if (candidates.length === 0) return [];
  const index = await setIndex(game);
  // The candidates' catalog rows and ONE guarded read for all of them.
  const rows = await catalogByIds(game, candidates.map((c) => c.id));
  const trust = await loadTrustData(rows.map((r) => ({ cardId: r.id, game })));
  const today = todayUtc();
  const out: Tile[] = [];
  for (const r of rows) {
    const data = trust.get(r.id);
    if (!data) continue;
    const head = headlinePrice(variantPrices(game, judgedSeries(data, today), today));
    if (!head || isUnverified(head) || head.stale) continue;
    const f = factsOf(game, r, "");
    out.push({ key: r.key, name: f.name, number: f.number, tags: f.tags, image: f.image, tile: f.tile, price: head.price, flagged: false, unverified: false, setSlug: index.slugOf.get(r.set_key) ?? slugify(r.set_name, 80), setName: r.set_name });
  }
  return out.sort((a, b) => (b.price ?? 0) - (a.price ?? 0)).slice(0, n);
}

/** Where a catalog id's public page lives and what a list shows for it (the movers page). Ids with no page are left out. */
export async function pageTilesByIds(game: GameId, ids: string[]): Promise<Map<string, Tile>> {
  const out = new Map<string, Tile>();
  if (ids.length === 0) return out;
  const index = await setIndex(game);
  for (const r of await catalogByIds(game, ids)) {
    const f = factsOf(game, r, "");
    out.set(r.id, { key: r.key, name: f.name, number: f.number, tags: f.tags, image: f.image, tile: f.tile, price: null, flagged: false, unverified: false, setSlug: index.slugOf.get(r.set_key) ?? slugify(r.set_name, 80), setName: r.set_name });
  }
  return out;
}
