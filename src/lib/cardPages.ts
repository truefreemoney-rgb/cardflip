import type { Metadata } from "next";
import { GAMES, printedCardNumber, SET_IN_NUMBER_GAMES } from "@/lib/games";
import { formatMoney, formatVariantLabel } from "@/lib/listing";
import { addDays, dayIndex, toPoints, type HistoryPoint } from "@/lib/priceSeries";
import type { PriceFlag, PriceStale } from "@/lib/priceFlag";
import { etDate } from "@/lib/time";
import { clipDescription, pageMetadata } from "@/lib/seo";
import type { GameId } from "@/lib/types";

/**
 * The public card price pages (/cards, SEO sweep 09-30): everything about them
 * that needs no database, so a test can pin it. URLs, keys, slugs, what is
 * excluded, what is indexed, what a page may print, and its metadata. The
 * loaders that read the catalog and the price series are lib/server/cardPages.ts.
 *
 * Shape: /cards/{game}/{set-slug}/{name-slug}--{key}
 *   - game: pokemon, magic, lorcana, one-piece, yugioh
 *   - key: the catalog id (Pokémon ids are case-sensitive, Lorcana crd_…,
 *     One Piece OP01-077 with its _p1 parallels, Yu-Gi-Oh ygo-…), except Magic,
 *     where the Scryfall UUID gives way to {set code}-{collector number}
 *     (lea-232): the two things printed on the card.
 *   - set and name slugs are decoration for people and search: a request whose
 *     slugs differ from the canonical ones is sent there with a 308, and only
 *     the key is ever looked up. "--" never occurs inside a slug, so the first
 *     "--" splits the two.
 */

export const CARD_GAME_SLUGS: Record<GameId, string> = {
  pokemon: "pokemon",
  mtg: "magic",
  lorcana: "lorcana",
  onepiece: "one-piece",
  yugioh: "yugioh",
};

export function gameFromSlug(slug: string): GameId | null {
  for (const [game, s] of Object.entries(CARD_GAME_SLUGS)) if (s === slug) return game as GameId;
  return null;
}

/** The pages' own name for a game ("Pokémon", "Magic: The Gathering"). */
export const gameTitle = (game: GameId): string => (game === "pokemon" ? "Pokémon" : GAMES[game].fullName.replace(/ (TCG|Card Game)$/, ""));

/** A card is indexed (and listed in the sitemap) from this price up; cheaper pages still resolve, noindex and followed. */
export const INDEX_FLOOR_USD = 5;
/**
 * The long-tail games (SEO, Chris 10-02): One Piece, Lorcana and Yu-Gi-Oh! card-name searches have thin competition (no
 * Scryfall), so every card priced $1 and up has an indexed page there; Pokémon and Magic keep the $5 floor for now.
 */
export const LONG_TAIL_FLOOR_USD = 1;
export const LONG_TAIL_GAMES: readonly GameId[] = ["onepiece", "lorcana", "yugioh"];
/** The index floor of a game: $1 for the long-tail games, $5 otherwise. */
export const indexFloorUsd = (game: GameId): number => (LONG_TAIL_GAMES.includes(game) ? LONG_TAIL_FLOOR_USD : INDEX_FLOOR_USD);
/** A price whose last recorded day is older than this many days is not "current": not printed, not counted. */
export const FRESH_DAYS = 7;
/**
 * A price this high needs history behind it before it is indexed or featured: Lorcana, One Piece and Yu-Gi-Oh! series began
 * 09-30, and with one day of history nothing can tell a real $5,000 card from a junk listing (a $213,589 Yu-Gi-Oh! common
 * passed the guard, which has nothing to compare a day-old series to). The page still resolves and prints the price, noindex.
 */
export const VERIFY_ABOVE_USD = 1000;
/** Priced days that count as history (the guard's own minPricedDays, lib/server/priceTrust.ts). */
export const MATURE_PRICED_DAYS = 14;
/** Sitemap files hold at most this many URLs. */
export const SITEMAP_CHUNK = 10_000;
/** Below this many priced days the page shows "Tracking since" instead of a chart. */
export const CHART_MIN_POINTS = 7;

// ---------------------------------------------------------------------------
// Slugs

/** "Sheoldred's Edict" -> "sheoldreds-edict", "Flabébé" -> "flabebe". Never contains "--", never empty. */
export function slugify(text: string, max = 60): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "card";
}

/** One set as the set index holds it. `key` is what the catalog is queried by (Pokémon set_id, Magic set code, "code|name" for the rest). */
export interface SetEntry {
  key: string;
  name: string;
  code: string;
  /** "YYYY-MM-DD" or "". */
  release: string;
  /** Cards in the catalog with a picture. */
  count: number;
  /** Cards priced at the index floor or more. */
  qualifying: number;
}

/**
 * key -> slug for every set of a game. A name gets its plain slug; when two sets
 * would share one (Pokémon's two "Trainer Gallery" pairs, Yu-Gi-Oh! reprint sets)
 * the OLDER keeps it and the newer gets its code appended, so a set added later
 * never renames an existing page. Stable for a given list.
 */
export function setSlugs(sets: Pick<SetEntry, "key" | "name" | "code" | "release">[]): Map<string, string> {
  const ordered = sets.slice().sort((a, b) => (a.release || "9999").localeCompare(b.release || "9999") || a.key.localeCompare(b.key));
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const s of ordered) {
    const base = slugify(s.name || s.code, 80);
    let slug = base;
    if (taken.has(slug)) slug = `${base}-${slugify(s.code || s.key, 20)}`;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    out.set(s.key, slug);
  }
  return out;
}

const SET_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A set slug worth a lookup: checked before anything touches the database. */
export const isSetSlug = (s: string): boolean => s.length <= 100 && SET_SLUG.test(s);

// ---------------------------------------------------------------------------
// Keys

const KEY_PATTERN: Record<GameId, RegExp> = {
  pokemon: /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/,
  // {set code}-{collector number}: the number may carry a star (foil-stamped printings) or a second part (The List: plst-M11-153).
  mtg: /^[a-z0-9]{2,8}-[A-Za-z0-9★]{1,10}(?:-[A-Za-z0-9]{1,10})?$/,
  lorcana: /^crd_[a-f0-9]{8,40}$/,
  // Not "#": One Piece rows with a "#" in the id are positional and can renumber, they get no page.
  onepiece: /^[A-Za-z0-9]{1,8}-\d{1,4}(?:_[pPrR]\d{1,3})?$/,
  yugioh: /^ygo-\d{1,9}(?:-1st)?$/,
};

/** Keys that never name a card: sealed product and graded series share the series table with cards. */
const NOT_A_CARD = /^(?:sealed-|tcgp-sealed-|graded-)/;

function safeDecode(s: string): string {
  if (!s.includes("%")) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The key a request names, or null when it cannot be one. Pure string work, run
 * before any database read. Magic's set code folds to lowercase (a request for
 * LEA-232 is answered with a redirect to lea-232); every other key is case-sensitive.
 */
export function parseCardKey(game: GameId, raw: string): string | null {
  if (raw.length > 80) return null;
  let key = safeDecode(raw);
  if (game === "mtg") {
    const cut = key.indexOf("-");
    if (cut > 0) key = key.slice(0, cut).toLowerCase() + key.slice(cut);
  }
  if (NOT_A_CARD.test(key) || !KEY_PATTERN[game].test(key)) return null;
  return key;
}

/** The last path segment "{name-slug}--{key}" split in two; the key is decoded, not yet validated. */
export function parseCardSegment(segment: string): { nameSlug: string; key: string } | null {
  if (segment.length > 160) return null;
  const decoded = safeDecode(segment);
  const at = decoded.indexOf("--");
  if (at < 0) return null;
  return { nameSlug: decoded.slice(0, at), key: decoded.slice(at + 2) };
}

/** What a card is called in the URL: the catalog id, or set code + collector number for Magic. */
export function cardKey(game: GameId, row: { id: string; setCode?: string | null; number?: string | null }): string {
  return game === "mtg" ? `${(row.setCode ?? "").toLowerCase()}-${row.number ?? ""}` : row.id;
}

export type Exclusion = "bad-key" | "orphan" | "no-image";

/**
 * Why a card gets no page at all (404 there, absent from the sitemap): an id that
 * is not a card key (sealed, graded, '#' ids, anything the pattern refuses), a card
 * the catalog does not hold (an orphan series, a Japanese id) or one with no picture.
 */
export function cardExclusion(game: GameId, key: string, inCatalog: boolean, image: string): Exclusion | null {
  if (parseCardKey(game, key) !== key) return "bad-key";
  if (!inCatalog) return "orphan";
  if (!image) return "no-image";
  return null;
}

// ---------------------------------------------------------------------------
// URLs

export const gamePath = (game: GameId) => `/cards/${CARD_GAME_SLUGS[game]}`;
export const setPath = (game: GameId, setSlug: string) => `${gamePath(game)}/${setSlug}`;
export const cardPath = (game: GameId, setSlug: string, name: string, key: string) => `${setPath(game, setSlug)}/${slugify(name)}--${encodeURIComponent(key)}`;

/** The canonical path for what was asked, or null when the request already is it. Only the key decides which card; the slugs only decide the address. */
export function canonicalRedirect(asked: { game: string; set: string; nameSlug: string; key: string }, canon: { game: GameId; setSlug: string; name: string; key: string }): string | null {
  const same = asked.game === CARD_GAME_SLUGS[canon.game] && asked.set === canon.setSlug && asked.nameSlug === slugify(canon.name) && asked.key === canon.key;
  return same ? null : cardPath(canon.game, canon.setSlug, canon.name, canon.key);
}

// ---------------------------------------------------------------------------
// Prices

/** Latest priced day and price of a series (oldest first, null = no reading), or null when it never had one. */
export function lastPoint(startDay: string, prices: readonly (number | null)[]): { day: string; price: number } | null {
  for (let i = prices.length - 1; i >= 0; i--) {
    const p = prices[i];
    if (p != null && p > 0) return { day: addDays(startDay, i), price: p };
  }
  return null;
}

/** Is a recorded day recent enough to call the price current? */
export const isFresh = (day: string, today: string): boolean => dayIndex(day, today) <= FRESH_DAYS;

/** One printing's price as a page may use it. `flag` set = the price guard does not believe it: the number is never printed. */
export interface VariantPrice {
  variant: string;
  label: string;
  price: number;
  day: string;
  /** Priced days behind this printing's series. */
  days: number;
  flag: PriceFlag | null;
  /** The value has stood 45+ days (10-02): printed, with a note. */
  stale?: PriceStale | null;
}

/** A price too high to stand on a day or two of history (VERIFY_ABOVE_USD): never featured or indexed until it has some. */
export const isUnverified = (p: Pick<VariantPrice, "price" | "days">): boolean => p.price >= VERIFY_ABOVE_USD && p.days < MATURE_PRICED_DAYS;

export interface SeriesInput {
  variant: string;
  startDay: string;
  prices: (number | null)[];
  flag: PriceFlag | null;
  stale?: PriceStale | null;
}

/** Display order of printings: the one people usually mean first (same as variantRank in lib/server/priceHistory.ts). */
const VARIANT_ORDER = ["normal", "nonfoil", "holofoil", "reverseHolofoil", "foil", "etched"];
export const variantRank = (variant: string) => VARIANT_ORDER.indexOf(variant) + 1 || 99;

/** The word a printing goes by: Yu-Gi-Oh! and One Piece have one price line, which is just "Market". */
export function variantLabel(game: GameId, variant: string): string {
  if (variant === "normal" && (game === "onepiece" || game === "yugioh")) return "Market price";
  return formatVariantLabel(variant);
}

/** Every fresh TCGplayer printing of a card, the usual printing first. Stale lines and lines with no price are left out. */
export function variantPrices(game: GameId, series: SeriesInput[], today: string): VariantPrice[] {
  const out: VariantPrice[] = [];
  for (const s of series) {
    const last = lastPoint(s.startDay, s.prices);
    if (!last || !isFresh(last.day, today)) continue;
    const days = s.prices.filter((p) => p != null && p > 0).length;
    // A four-figure price on a few days of history is never printed either (a $213k Yu-Gi-Oh! common got past the guard on day one).
    const young = !s.flag && isUnverified({ price: last.price, days });
    const flag = young ? { hard: false, reason: `unverified ${days}d` } : s.flag;
    out.push({ variant: s.variant, label: variantLabel(game, s.variant), price: last.price, day: last.day, days, flag, ...(s.stale && !flag ? { stale: s.stale } : {}) });
  }
  return out.sort((a, b) => variantRank(a.variant) - variantRank(b.variant) || a.variant.localeCompare(b.variant));
}

/** The price a page may print as THE price: the first printing (in display order) the guard believes. null = nothing printable. */
export function headlinePrice(prices: VariantPrice[]): VariantPrice | null {
  return prices.find((p) => !p.flag) ?? null;
}

export interface IndexDecision {
  index: boolean;
  reason: "ok" | "below-floor" | "flagged" | "no-price" | "unverified";
}

/**
 * Index the page only when it shows a real price at or over the floor (indexFloorUsd:
 * $5, $1 for the long-tail games): some fresh printing the guard believes is worth that much. A page whose prices are all
 * flagged, all stale or all under the floor still resolves (noindex, follow).
 */
export function indexDecision(prices: VariantPrice[], floor = INDEX_FLOOR_USD): IndexDecision {
  if (prices.length === 0) return { index: false, reason: "no-price" };
  const printable = prices.filter((p) => !p.flag);
  if (printable.length === 0) return { index: false, reason: "flagged" };
  const floored = printable.filter((p) => p.price >= floor);
  if (floored.length === 0) return { index: false, reason: "below-floor" };
  return floored.some((p) => !isUnverified(p)) ? { index: true, reason: "ok" } : { index: false, reason: "unverified" };
}

/**
 * Percent change over the last `days` days from a series' points, or null when the series does not reach back that far
 * (a point within 3 days before the target day is used; a young series says nothing rather than guessing).
 */
export function changeOver(points: HistoryPoint[], days: number): { pct: number; from: HistoryPoint } | null {
  const last = points[points.length - 1];
  if (!last) return null;
  const target = addDays(last.day, -days);
  let from: HistoryPoint | null = null;
  for (const p of points) {
    if (p.day > target) break;
    if (dayIndex(p.day, target) <= 3) from = p;
  }
  if (!from || !(from.price > 0)) return null;
  return { pct: ((last.price - from.price) / from.price) * 100, from };
}

/** "Up 12.3% over the last 30 days", or "Little changed over the last 30 days" under half a percent. */
export function changeWords(pct: number, days: number): string {
  if (Math.abs(pct) < 0.5) return `Little changed over the last ${days} days`;
  return `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct).toFixed(1)}% over the last ${days} days`;
}

/** "Sep 30, 2026" for a price's recorded day. The day key is UTC; read at noon UTC it is the same calendar day in Eastern. */
export const priceDayLabel = (day: string): string => etDate(`${day}T12:00:00Z`);

/** Chart points of a series row (oldest first). */
export const seriesPoints = (s: { startDay: string; prices: (number | null)[] }): HistoryPoint[] => toPoints(s);

// ---------------------------------------------------------------------------
// What a card page says about a card

/** The catalog facts of one card, shaped the same for every game. */
export interface CardFacts {
  game: GameId;
  /** Catalog id = the price series key. */
  id: string;
  /** The URL key (cardKey). */
  key: string;
  name: string;
  /** As the card prints it: "4/102", "LEA 232", "OP01-077". */
  number: string;
  setKey: string;
  /** The set's slug in URLs (setSlugs). */
  setSlug: string;
  setName: string;
  setCode: string;
  /** "YYYY-MM-DD" or "". */
  release: string;
  rarity: string;
  /** What tells this printing from its twins, in words: "1st Edition", "Parallel", "Starlight Rare". */
  tags: string[];
  /** The large picture. */
  image: string;
}

const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** The printing tags of a catalog row: Yu-Gi-Oh! rarity and the 1st Edition stamp, One Piece and Lorcana treatments. */
export function printingTags(game: GameId, row: { id: string; rarity?: string | null; variant?: string | null }): string[] {
  const tags: string[] = [];
  if (game === "yugioh") {
    // The same code comes in several rarities (and tagged name foils), each its own product and price.
    if (row.rarity) tags.push(row.rarity);
    if (row.variant && slugify(row.rarity ?? "") !== row.variant) tags.push(titleCase(row.variant));
    if (row.id.endsWith("-1st")) tags.push("1st Edition");
  } else if (row.variant) {
    tags.push(titleCase(row.variant));
  }
  return tags;
}

export function displayNumber(game: GameId, row: { number: string; setTotal?: number | null; setCode?: string | null }): string {
  if (game === "mtg" || SET_IN_NUMBER_GAMES.includes(game)) return printedCardNumber({ number: row.number, setCode: row.setCode, game });
  return printedCardNumber({ number: row.number, setTotal: row.setTotal ?? null, game });
}

/** "Charizard 4/102 Base Set price": the H1. */
export function cardHeading(f: CardFacts): string {
  return [f.name, f.number, f.setName, ...f.tags, "price"].filter(Boolean).join(" ");
}

/**
 * The <title>: the heading, shortened to about 60 characters by dropping what search needs least, in this order: the set
 * name, the tags, then the number. The name and the word "price" always stay.
 */
export function cardTitle(f: CardFacts, max = 60): string {
  const tries = [
    [f.name, f.number, f.setName, ...f.tags, "price"],
    [f.name, f.number, ...f.tags, "price"],
    [f.name, f.number, "price"],
    [f.name, "price"],
  ];
  for (const parts of tries) {
    const title = parts.filter(Boolean).join(" ");
    if (title.length <= max) return title;
  }
  return `${f.name.slice(0, max - 6).trim()} price`;
}

/** The catalog facts as one plain paragraph: only what the catalog holds, nothing invented. */
export function factsParagraph(f: CardFacts): string {
  const released = f.release ? `, released ${etDate(`${f.release}T12:00:00Z`)}` : "";
  const bits = [`${f.name} is card ${f.number} in ${f.setName}${released}.`];
  if (f.tags.length) bits.push(`This printing is listed as ${f.tags.join(", ")}.`);
  else if (f.rarity) bits.push(`Its rarity is ${f.rarity}.`);
  return bits.join(" ");
}

export interface CardView {
  facts: CardFacts;
  /** Fresh TCGplayer printings in display order. */
  prices: VariantPrice[];
  headline: VariantPrice | null;
  decision: IndexDecision;
}

/** The share picture of a card: its own art, except Lorcana's AVIF (link previews do not read it), which takes the branded card. */
export function shareImage(f: Pick<CardFacts, "game" | "image">): string | null {
  return f.game === "lorcana" || /\.avif(?:[?#]|$)/i.test(f.image) ? null : f.image;
}

/** The meta description: the price as of its day when one is printable, else the plain card facts. Never a flagged number. */
export function cardDescription(v: CardView): string {
  const f = v.facts;
  const what = `${f.name} ${f.number} from ${f.setName}${f.tags.length ? ` (${f.tags.join(", ")})` : ""}`;
  if (v.headline) {
    const price = `Market price ${formatMoney(v.headline.price)} as of ${priceDayLabel(v.headline.day)}`;
    // The fullest wording that fits; a long card name gets the shorter ones (search cuts a description near 155).
    for (const text of [`${what}: ${price}, with price history. Checked daily by CardFlip.`, `${what}: ${price}, with price history.`, `${f.name} ${f.number}: ${price}.`]) {
      if (text.length <= 155) return text;
    }
    return clipDescription(`${f.name}: ${price}.`);
  }
  return clipDescription(`${what}: catalog details and price history on CardFlip.`);
}

export function cardMetadata(v: CardView): Metadata {
  const f = v.facts;
  return pageMetadata({
    title: cardTitle(f),
    absoluteTitle: true,
    description: cardDescription(v),
    path: cardPath(f.game, f.setSlug, f.name, f.key),
    image: shareImage(f),
    imageAlt: `${f.name}, ${f.setName}`,
    noindex: !v.decision.index,
  });
}
