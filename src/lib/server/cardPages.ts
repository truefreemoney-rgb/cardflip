import "server-only";
import { db } from "@/lib/db";
import { cachedList } from "@/lib/server/listCache";
import { gamePublic, type GatedGame } from "@/lib/server/settings";
import { PRICE_TRUST, lastPriced } from "@/lib/server/priceTrust";
import { judgeFull, judgeSeries, loadTrustData, type TrustData, type TrustSeries } from "@/lib/server/priceTrustSite";
import { largeImage } from "@/lib/server/mtgCards";
import { addDays, dayIndex, decodePrices, todayUtc, toPoints } from "@/lib/priceSeries";
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
  parseCardKey,
  printingTags,
  setSlugs,
  slugify,
  variantPrices,
  type CardFacts,
  type CardView,
  type SeriesInput,
  type SetEntry,
} from "@/lib/cardPages";
import { historyRange, type HistoryRange, type SetStanding } from "@/lib/cardStory";
import type { Series } from "@/components/PriceHistoryChart";
import type { GameId } from "@/lib/types";

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
      .all()) as unknown as Omit<SetRow, "q">[];
    const priced = (await db
      .prepare(
        `SELECT c.set_id AS skey, COUNT(*) AS q FROM en_cards c
          WHERE c.image_url <> '' AND c.id IN (
            SELECT card_id FROM price_series
             WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD' AND updated_day >= ?
               AND json_extract(prices, '$[#-1]') >= ?)
          GROUP BY c.set_id`,
      )
      .all(freshCutoff(), INDEX_FLOOR_USD)) as unknown as { skey: string; q: number }[];
    const q = new Map(priced.map((r) => [r.skey, Number(r.q)]));
    rows = base.map((r) => ({ ...r, q: q.get(r.skey) ?? 0 }));
  } else if (game === "mtg") {
    rows = (await db
      .prepare(
        `SELECT c.set_code AS skey, MAX(s.name) AS name, c.set_code AS code, MAX(s.released_at) AS rel, COUNT(*) AS n,
                SUM(CASE WHEN c.price_usd >= ? OR c.price_usd_foil >= ? OR c.price_usd_etched >= ? THEN 1 ELSE 0 END) AS q
           FROM mtg_cards c JOIN mtg_sets s ON s.code = c.set_code
          WHERE s.set_type NOT IN ${MTG_SKIPPED_SET_TYPES} AND c.image_url <> '' AND c.lang = 'en'
          GROUP BY c.set_code`,
      )
      .all(INDEX_FLOOR_USD, INDEX_FLOOR_USD, INDEX_FLOOR_USD)) as unknown as SetRow[];
  } else {
    rows = (await db
      .prepare(
        `SELECT set_code || '|' || set_name AS skey, set_name AS name, set_code AS code, MIN(set_release_date) AS rel, COUNT(*) AS n,
                SUM(CASE WHEN price_usd >= ? OR price_usd_foil >= ? THEN 1 ELSE 0 END) AS q
           FROM tcg_cards WHERE game = ? AND image_url <> '' AND id NOT LIKE '%#%'
          GROUP BY set_code, set_name`,
      )
      .all(indexFloorUsd(game), indexFloorUsd(game), game)) as unknown as SetRow[];
  }
  return rows
    .filter((r) => Number(r.n) > 0 && (r.name || r.code))
    .map((r) => ({ key: r.skey, name: r.name || r.code, code: r.code ?? "", release: r.rel ?? "", count: Number(r.n), qualifying: Number(r.q) }))
    .sort((a, b) => (b.release || "").localeCompare(a.release || "") || a.name.localeCompare(b.name));
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
    sets = await cachedList(`seo:sets:v1:${game}`, SETS_TTL_MS, () => buildSets(game));
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
  return set ? { set, slug } : null;
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
    setName: row.set_name,
    setCode,
    release: row.release ?? "",
    rarity,
    tags: printingTags(game, { id: row.id, rarity: game === "yugioh" ? row.rarity : null, variant: row.variant }),
    image: game === "mtg" ? largeImage(row.image_url) : game === "pokemon" ? row.image_url.replace("/low.webp", "/high.webp") : row.image_url,
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
                set_release_date AS release, image_url, NULL AS rarity, NULL AS variant
           FROM en_cards WHERE id = ?`,
      )
      .get(key)) as CatalogRow | undefined;
  } else if (game === "mtg") {
    const cut = key.indexOf("-");
    const r = (await db
      .prepare(
        `SELECT c.id, c.name, c.set_code AS set_key, c.set_name, c.set_code, c.collector_number AS number, NULL AS set_total,
                c.set_release_date AS release, c.image_url, c.rarity, NULL AS variant, c.price_eur, c.price_eur_foil,
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
                set_release_date AS release, rarity, variant, image_url
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
}

const NO_PRICE: Pick<CardPage, "prices" | "headline" | "chart" | "trackingSince" | "changes" | "range"> = { prices: [], headline: null, chart: null, trackingSince: null, changes: [], range: null };

/** The price side of a card page: fresh printings with the guard's verdicts, the change words, the chart. Fails closed: a guard error prints no price. */
export async function loadCardPage(rec: CardRecord, today = todayUtc()): Promise<CardPage> {
  const { facts } = rec;
  let rows: SeriesRow[];
  try {
    rows = (await db
      .prepare("SELECT variant, source, currency, start_day, prices, updated_day FROM price_series WHERE card_id = ?")
      .all(facts.id)) as unknown as SeriesRow[];
  } catch (err) {
    console.warn(`card pages: could not read the price series of ${facts.id}`, err);
    return { facts, decision: indexDecision([]), ...NO_PRICE };
  }
  const cmSince = addDays(today, -PRICE_TRUST.refMaxAgeDays);
  const series: TrustSeries[] = [];
  let cmEur: number | null = null;
  for (const r of rows) {
    const prices = decodePrices(r.prices);
    if (r.source === "cardmarket" && r.variant === "average") {
      if (r.updated_day >= cmSince) cmEur = lastPriced(prices);
    } else if (r.source === "tcgplayer" && r.currency === "USD" && prices.some((p) => p != null)) {
      series.push({ variant: r.variant, startDay: r.start_day, prices });
    }
  }
  const data: TrustData = { game: facts.game, series, cmEur, eur: rec.eur, released: rec.released };

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
  const decision = indexDecision(prices, indexFloorUsd(facts.game));
  if (!headline) return { facts, prices, headline, decision, chart: null, trackingSince: null, changes: [], range: null };

  const line = series.find((s) => s.variant === headline.variant);
  const points = line ? toPoints(line) : [];
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
  return { facts, prices, headline, decision, chart, trackingSince: points[0]?.day ?? null, changes, range };
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
  price: number | null;
  flagged: boolean;
  /** A price too high for the history behind it (lib/cardPages.ts isUnverified): never listed or featured. */
  unverified: boolean;
}

/** The columns every list read selects, per catalog table, shaped as a CatalogRow. */
const LIST_SELECT = {
  pokemon: `SELECT id, name, set_id AS set_key, set_name, set_code, local_id AS number, set_card_count_official AS set_total,
                   set_release_date AS release, image_url, NULL AS rarity, NULL AS variant FROM en_cards`,
  mtg: `SELECT id, name, set_code AS set_key, set_name, set_code, collector_number AS number, NULL AS set_total,
               set_release_date AS release, image_url, rarity, NULL AS variant FROM mtg_cards`,
  tcg: `SELECT id, name, subtitle, set_code || '|' || set_name AS set_key, set_name, set_code, collector_number AS number, set_total,
               set_release_date AS release, rarity, variant, image_url FROM tcg_cards`,
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
    const prices = variantPrices(game, data.series.map((s) => ({ ...s, flag: judgeSeries(data, { variant: s.variant, exact: true, day: today }) })), today);
    if (prices.length === 0) continue;
    const head = headlinePrice(prices);
    const f = factsOf(game, r, "");
    out.push({ key: r.key, name: f.name, number: f.number, tags: f.tags, image: f.image, price: head ? head.price : null, flagged: !head, unverified: head ? isUnverified(head) : false });
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
  return cachedTiles(`seo:settop:v1:${game}:${set.key}`, async () => {
    const cards = (await loadSetCards(game, set)).filter((c) => c.price != null && c.price >= indexFloorUsd(game) && !c.unverified).slice(0, STRIP_TILES + 1);
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
    return await cachedList(`seo:setrank:v1:${game}:${set.key}`, TOP_TTL_MS, async () => {
      const cards = (await loadSetCards(game, set)).filter((c) => c.price != null && c.price >= indexFloorUsd(game) && !c.unverified);
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

/** Catalog rows that share this card's name in other sets (Pokémon reprints, Magic reprints, Yu-Gi-Oh! alternate sets). At most 40 rows before the guard. */
function sameNameRows(game: GameId, name: string, notKey: string) {
  // The page name of a tcg_cards row is "name - subtitle"; the lookup is by the bare name column, so sister printings with another subtitle (One Piece parallels) are found too.
  const bare = game === "pokemon" || game === "mtg" ? name : name.split(" - ")[0];
  if (game === "pokemon") return catalogRows(game, "name = ? AND id <> ? LIMIT 40", [bare, notKey]);
  if (game === "mtg") return catalogRows(game, "name = ? AND (set_code || '-' || collector_number) <> ? LIMIT 40", [bare, notKey]);
  return catalogRows(game, "name = ? AND id <> ? LIMIT 40", [bare, notKey]);
}

/**
 * Other printings of the same card, most valuable first, each with the price the guard believes: the tiles for
 * "Other <name> cards". Built once a day per name; flagged and unverified ones are left out (a list never prints a
 * doubted number). Empty when the card is the only printing.
 */
export async function otherPrintings(game: GameId, f: Pick<CardFacts, "name" | "key">, limit = TOP_TILES): Promise<Tile[]> {
  return cachedTiles(`seo:printings:v1:${game}:${f.name}`, async () => {
    const rows = await sameNameRows(game, f.name, f.key);
    if (rows.length === 0) return [];
    const index = await setIndex(game);
    const trust = await loadTrustData(rows.map((r) => ({ cardId: r.id, game })), todayUtc());
    const out: Tile[] = [];
    for (const r of rows) {
      const data = trust.get(r.id);
      if (!data) continue;
      const today = todayUtc();
      const prices = variantPrices(game, data.series.map((s) => ({ ...s, flag: judgeSeries(data, { variant: s.variant, exact: true, day: today }) })), today);
      const head = headlinePrice(prices);
      if (!head || head.price < indexFloorUsd(game) || isUnverified(head)) continue;
      const setSlug = index.slugOf.get(r.set_key);
      if (!setSlug) continue;
      const fx = factsOf(game, r, setSlug);
      out.push({ key: r.key, name: fx.name, number: fx.number, tags: fx.tags, image: fx.image, price: head.price, flagged: false, unverified: false, setSlug, setName: fx.setName });
    }
    return out.sort((a, b) => (b.price ?? 0) - (a.price ?? 0)).slice(0, limit);
  });
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
  return cachedTiles(`seo:top:v1:${game}`, async () => {
    const candidates = await topCandidates(game, TOP_TILES * 10);
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
      const head = headlinePrice(variantPrices(game, data.series.map((s) => ({ ...s, flag: judgeSeries(data, { variant: s.variant, exact: true, day: today }) })), today));
      if (!head || isUnverified(head)) continue;
      const f = factsOf(game, r, "");
      out.push({ key: r.key, name: f.name, number: f.number, tags: f.tags, image: f.image, price: head.price, flagged: false, unverified: false, setSlug: index.slugOf.get(r.set_key) ?? slugify(r.set_name, 80), setName: r.set_name });
    }
    return out.sort((a, b) => (b.price ?? 0) - (a.price ?? 0)).slice(0, TOP_TILES);
  });
}
