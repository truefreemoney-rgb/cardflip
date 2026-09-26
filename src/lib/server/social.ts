import "server-only";
import { db } from "@/lib/db";
import { decodePrices, todayUtc } from "@/lib/priceSeries";
import { getSetting, setSetting } from "@/lib/server/settings";
import type { GameId } from "@/lib/types";

/**
 * Social autopilot — the content engine (docs/SOCIAL-AUTOPILOT.md).
 *
 * Every post is made from OUR data, no writing by hand: the biggest price
 * moves of the week and a card of the day, both from price_series (the same
 * history the app shows). The publisher (a cloud routine, later) asks this
 * module for today's drafts, renders each one through /api/social/image,
 * and pushes it to each site by API. /admin/social shows the same drafts so
 * Chris can see what is going out without opening any social site.
 *
 * Voice (docs/SOCIAL.md): plain and dry, sentence case, no exclamation
 * marks, no hype words. The scanner is the product; every caption ends on
 * cardflip.io.
 */

export const MOVER_DAYS = 7;
export const MOVER_LIMIT = 5;
/** Below this the % swing is noise (a $1.83 common "up 69%" is not news; Chris 09-25, was $3). */
export const MOVER_MIN_PRICE = 10;
/** A move counts once the new price has held this many of the last MOVER_DAYS days (one odd sale is not a move; Grass Energy +650%, 09-25). */
export const HELD_DAYS = 3;
/** Card of the day comes from the cards worth talking about. */
export const COTD_MIN_PRICE = 15;
/** How many series rows one call may read (Turso rows-read, 09-06). */
const ROW_CAP = 6000;
const VARIANT_ORDER = ["normal", "holofoil", "reverseHolofoil"];

/**
 * No-repeat rule (Chris 09-25, three posts a day but never the same five
 * names day after day): a card featured in a gains/drops post is left out
 * of that kind for the next FEATURED_DAYS days. settings key
 * social_featured:<game>:<kind> = { cardId: day }, written by the publisher
 * after the post lands; drafts and pictures both read it, so they agree.
 */
export const FEATURED_PREFIX = "social_featured:";
export const FEATURED_DAYS = 7;

/** Set spotlight (7am): the priciest cards of one set; a set needs this many cards worth at least SET_MIN_PRICE to be picked. */
export const SET_MIN_CARDS = 5;
export const SET_MIN_PRICE = 10;

export type PostKind = "movers" | "card" | "dips" | "set";
export type PostSize = "square" | "story" | "landscape";
export const POST_SIZES: Record<PostSize, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1200, height: 628 },
};

export interface Mover {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  imageUrl: string;
  variant: string;
  from: number;
  to: number;
  pct: number;
  /** Today's point has not held HELD_DAYS days: `to` is the week's median and the % is not worth showing. */
  unsettled?: boolean;
}

export interface SocialPost {
  id: string;
  kind: PostKind;
  game: GameId;
  day: string;
  title: string;
  caption: string;
  hashtags: string[];
  /** Same post, fewer words, for sites with a short limit (Bluesky 300). */
  shortCaption: string;
  /** Relative path; add ?size=square|story|landscape. */
  imagePath: string;
  /** Cards in the post, for the no-repeat rule. */
  cardIds: string[];
}

interface SeriesRow {
  card_id: string;
  variant: string;
  start_day: string;
  prices: string;
}

interface CatalogRow {
  id: string;
  name: string;
  set_name: string;
  number: string;
  image_url: string;
}

function rank(variant: string): number {
  return VARIANT_ORDER.indexOf(variant) + 1 || 99;
}

/** Last non-null price at or before index `at` (−1 = the last point), looking back at most `maxBack` days. */
function priceAt(prices: (number | null)[], at: number, maxBack = Infinity): number | null {
  const start = Math.min(at < 0 ? prices.length - 1 : at, prices.length - 1);
  for (let i = start; i >= 0 && start - i <= maxBack; i--) {
    if (prices[i] != null) return prices[i];
  }
  return null;
}

/** A price may stand in for up to this many later days with no point; beyond that it is not "last week's price". */
const CARRY_DAYS = 3;

function dayDiff(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(toDay + "T00:00:00Z") - Date.parse(fromDay + "T00:00:00Z")) / 86_400_000);
}

/**
 * Every fresh USD series for the game, one per card (preferred variant),
 * with the latest price and the price `days` ago. Fresh = updated in the
 * last three days, so a card nobody has priced in a month never posts.
 */
async function freshSeries(game: GameId, day: string, days: number) {
  const since = new Date(Date.parse(day + "T00:00:00Z") - 3 * 86_400_000).toISOString().slice(0, 10);
  const rows = (await db
    .prepare(
      `SELECT card_id, variant, start_day, prices FROM price_series
        WHERE game = ? AND currency = 'USD' AND updated_day >= ?
        LIMIT ${ROW_CAP}`,
    )
    .all(game, since)) as unknown as SeriesRow[];
  const out = new Map<string, { variant: string; from: number | null; to: number; held: number; median: number }>();
  for (const r of rows) {
    const prices = decodePrices(r.prices);
    const todayIdx = dayDiff(r.start_day, day);
    const to = priceAt(prices, todayIdx);
    if (to == null) continue;
    const from = todayIdx - days >= 0 ? priceAt(prices, todayIdx - days, CARRY_DAYS) : null;
    // Days in the window whose price sits within 15% of today's: a real move holds, a stray sale does not.
    let held = 0;
    const window: number[] = [];
    // Carry the last known price across a few days with no point, so a card priced twice a week still "holds".
    for (let i = Math.max(0, todayIdx - days + 1); i <= todayIdx; i++) {
      const v = priceAt(prices, i, CARRY_DAYS);
      if (v == null) continue;
      window.push(v);
      if (Math.abs(v - to) / to <= 0.15) held++;
    }
    // Median of the window: the price to show when today's point has not held (Pikachu Star $3,217 → $900 in a day, 09-25).
    window.sort((a, b) => a - b);
    const median = window.length ? window[Math.floor((window.length - 1) / 2)] : to;
    const have = out.get(r.card_id);
    if (!have || rank(r.variant) < rank(have.variant)) out.set(r.card_id, { variant: r.variant, from, to, held, median });
  }
  return out;
}

/**
 * Card names as the post shows them. Satori has no glyph for ☆/★ (the
 * Gold Star cards), so they draw as a box; write the word instead, the
 * way collectors say it ("Gyarados Star δ").
 */
export function displayName(name: string): string {
  return name.replace(/\s*[☆★]\s*/g, " Star ").replace(/\s+/g, " ").trim();
}

/** Variant as a collector says it; "" for the plain print. */
export function variantLabel(variant: string): string {
  if (variant === "holofoil") return "Holo";
  if (variant === "reverseHolofoil") return "Reverse Holo";
  if (variant === "1stEditionHolofoil") return "1st Ed. Holo";
  if (variant === "1stEdition") return "1st Ed.";
  return "";
}

async function catalogRows(game: GameId, ids: string[]): Promise<Map<string, CatalogRow>> {
  const out = new Map<string, CatalogRow>();
  if (ids.length === 0) return out;
  const marks = ids.map(() => "?").join(",");
  const sql =
    game === "mtg"
      ? `SELECT id, name, set_name, collector_number AS number, image_url FROM mtg_cards WHERE id IN (${marks})`
      : `SELECT id, name, set_name, local_id AS number, image_url FROM en_cards WHERE id IN (${marks})`;
  const rows = (await db.prepare(sql).all(...ids)) as unknown as CatalogRow[];
  for (const r of rows) out.set(r.id, r);
  return out;
}

/** Large art for the post image (Pokémon mirrors store the low.webp path). */
export function postArtUrl(game: GameId, imageUrl: string): string {
  if (!imageUrl) return "";
  return game === "mtg" ? imageUrl : imageUrl.replace("/low.webp", "/high.webp");
}

/**
 * The biggest moves over the last MOVER_DAYS days, up and down, for cards
 * worth at least MOVER_MIN_PRICE on either end. Sorted by |%| desc.
 */
export async function topMovers(
  game: GameId,
  day = todayUtc(),
  { days = MOVER_DAYS, limit = MOVER_LIMIT, minPrice = MOVER_MIN_PRICE, direction = "both" as "both" | "up" | "down", exclude = new Set<string>() } = {},
): Promise<Mover[]> {
  const series = await freshSeries(game, day, days);
  const moves: { cardId: string; variant: string; from: number; to: number; pct: number }[] = [];
  for (const [cardId, s] of series) {
    if (exclude.has(cardId)) continue;
    if (s.from == null || s.from <= 0) continue;
    if (Math.max(s.from, s.to) < minPrice) continue;
    const pct = ((s.to - s.from) / s.from) * 100;
    if (Math.abs(pct) < 1) continue;
    if (s.held < HELD_DAYS) continue;
    if (direction === "down" && pct >= 0) continue;
    if (direction === "up" && pct <= 0) continue;
    moves.push({ cardId, variant: s.variant, from: s.from, to: s.to, pct });
  }
  moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || a.cardId.localeCompare(b.cardId));
  const top = moves.slice(0, limit * 3);
  const cat = await catalogRows(game, top.map((m) => m.cardId));
  const out: Mover[] = [];
  for (const m of top) {
    const c = cat.get(m.cardId);
    if (!c) continue;
    out.push({ ...m, name: displayName(c.name), setName: c.set_name, number: c.number, imageUrl: postArtUrl(game, c.image_url) });
    if (out.length >= limit) break;
  }
  return out;
}

type FeaturedKind = "movers" | "dips";

async function featuredMap(game: GameId, kind: FeaturedKind): Promise<Record<string, string>> {
  try {
    const raw = await getSetting(`${FEATURED_PREFIX}${game}:${kind}`);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Cards this kind featured on an EARLIER day within FEATURED_DAYS (same-day entries do not count, so a re-render today stays stable). */
export async function recentlyFeatured(game: GameId, kind: FeaturedKind, day = todayUtc()): Promise<Set<string>> {
  const out = new Set<string>();
  for (const [id, d] of Object.entries(await featuredMap(game, kind))) {
    const back = dayDiff(d, day);
    if (back >= 1 && back <= FEATURED_DAYS) out.add(id);
  }
  return out;
}

/** Record a landed post's cards; entries older than FEATURED_DAYS fall off. */
export async function markFeatured(game: GameId, kind: FeaturedKind, day: string, cardIds: string[]): Promise<void> {
  const map = await featuredMap(game, kind);
  for (const id of cardIds) map[id] = day;
  for (const [id, d] of Object.entries(map)) if (dayDiff(d, day) > FEATURED_DAYS) delete map[id];
  await setSetting(`${FEATURED_PREFIX}${game}:${kind}`, JSON.stringify(map));
}

/** Small stable hash so the same day always picks the same card. */
function hashDay(day: string, game: string): number {
  let h = 2166136261;
  for (const ch of `${game}:${day}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/**
 * Card of the day: one card worth at least COTD_MIN_PRICE, chosen by a hash
 * of the date over the fresh pool, so every viewer and every run agrees on
 * the pick and the pool cycles instead of repeating the top card.
 */
export async function cardOfTheDay(game: GameId, day = todayUtc(), minPrice = COTD_MIN_PRICE): Promise<Mover | null> {
  const series = await freshSeries(game, day, MOVER_DAYS);
  const pool = [...series.entries()].filter(([, s]) => s.to >= minPrice).map(([id]) => id).sort();
  if (pool.length === 0) return null;
  const pick = pool[hashDay(day, game) % pool.length];
  const s = series.get(pick)!;
  const c = (await catalogRows(game, [pick])).get(pick);
  if (!c) return null;
  const from = s.from ?? s.to;
  return {
    cardId: pick,
    name: displayName(c.name),
    setName: c.set_name,
    number: c.number,
    imageUrl: postArtUrl(game, c.image_url),
    variant: s.variant,
    from,
    to: s.to,
    pct: from > 0 ? ((s.to - from) / from) * 100 : 0,
  };
}

export interface SetSpotlight {
  setId: string;
  setName: string;
  cards: Mover[];
}

/**
 * Set spotlight (Chris 09-25: no single-card posts, several cards and
 * something to learn): the SET_MIN_CARDS most valuable cards of one set,
 * with their 7-day move. The set is picked by a hash of the date over
 * every set with enough priced cards, so the sets cycle and every run
 * agrees. PokÃ©mon only: the set is the card id's prefix (sv1-2 â†’ sv1);
 * Magic ids are opaque and Magic is not posted anyway.
 */
export async function setSpotlight(game: GameId, day = todayUtc(), { minCards = SET_MIN_CARDS, minPrice = SET_MIN_PRICE } = {}): Promise<SetSpotlight | null> {
  if (game !== "pokemon") return null;
  const series = await freshSeries(game, day, MOVER_DAYS);
  const bySet = new Map<string, string[]>();
  for (const [id, s] of series) {
    if (s.to < minPrice) continue;
    const dash = id.lastIndexOf("-");
    if (dash <= 0) continue;
    const setId = id.slice(0, dash);
    bySet.set(setId, [...(bySet.get(setId) ?? []), id]);
  }
  const sets = [...bySet.entries()].filter(([, ids]) => ids.length >= minCards).map(([setId]) => setId).sort();
  if (sets.length === 0) return null;
  const setId = sets[hashDay(day, `${game}:set`) % sets.length];
  // Rank on the settled price: today's point when it has held HELD_DAYS days, else the week's median.
  const settled = (id: string) => {
    const s = series.get(id)!;
    return s.held >= HELD_DAYS ? s.to : s.median;
  };
  const top = (bySet.get(setId) ?? []).sort((a, b) => settled(b) - settled(a) || a.localeCompare(b)).slice(0, minCards * 2);
  const cat = await catalogRows(game, top);
  const cards: Mover[] = [];
  for (const id of top) {
    const c = cat.get(id);
    if (!c) continue;
    const s = series.get(id)!;
    const unsettled = s.held < HELD_DAYS;
    const to = unsettled ? s.median : s.to;
    const from = s.from ?? to;
    cards.push({
      cardId: id,
      name: displayName(c.name),
      setName: c.set_name,
      number: c.number,
      imageUrl: postArtUrl(game, c.image_url),
      variant: s.variant,
      from,
      to,
      pct: !unsettled && from > 0 ? ((to - from) / from) * 100 : 0,
      unsettled,
    });
    if (cards.length >= minCards) break;
  }
  if (cards.length < minCards) return null;
  return { setId, setName: cards[0].setName, cards };
}

export function money(n: number): string {
  return n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

export function pctLabel(pct: number): string {
  const r = Math.round(pct);
  return `${r > 0 ? "+" : ""}${r}%`;
}

const GAME_LABEL: Record<GameId, string> = { pokemon: "Pokémon", mtg: "Magic", lorcana: "Lorcana", onepiece: "One Piece" };
const GAME_TAGS: Record<GameId, string[]> = {
  pokemon: ["PokemonTCG", "PokemonCards", "TCG"],
  mtg: ["MTG", "MagicTheGathering", "MTGFinance"],
  lorcana: ["DisneyLorcana", "Lorcana", "TCG"],
  onepiece: ["OnePieceCardGame", "OPTCG", "TCG"],
};

/** Caption for the movers post. Plain, no exclamation marks (docs/SOCIAL.md). */
export function moversCaption(game: GameId, movers: Mover[]): string {
  const lines = movers.map((m) => `${m.name} (${m.setName} ${m.number}) ${money(m.from)} → ${money(m.to)}, ${pctLabel(m.pct)}`);
  return [
    `${GAME_LABEL[game]} price gains this week, from CardFlip's own price history.`,
    "",
    ...lines,
    "",
    "Scan a card, see what it's worth. cardflip.io",
  ].join("\n");
}

/** The movers post in under 300 characters: name and % only. */
export function moversShortCaption(game: GameId, movers: Mover[]): string {
  return [
    `${GAME_LABEL[game]} price gains this week`,
    ...movers.map((m) => `${m.name} ${pctLabel(m.pct)}`),
    "",
    "Scan a card, see what it's worth. cardflip.io",
  ].join("\n");
}

/** Caption for the price-drops post (evening slot): the week's biggest falls. */
export function dipsCaption(game: GameId, dips: Mover[]): string {
  const lines = dips.map((m) => `${m.name} (${m.setName} ${m.number}) ${money(m.from)} → ${money(m.to)}, ${pctLabel(m.pct)}`);
  return [
    `${GAME_LABEL[game]} price drops this week, from CardFlip's own price history.`,
    "",
    ...lines,
    "",
    "Scan a card, see what it's worth. cardflip.io",
  ].join("\n");
}

export function dipsShortCaption(game: GameId, dips: Mover[]): string {
  return [`${GAME_LABEL[game]} price drops this week`, ...dips.map((m) => `${m.name} ${pctLabel(m.pct)}`), "", "Scan a card, see what it's worth. cardflip.io"].join("\n");
}

export function cardCaption(game: GameId, card: Mover): string {
  const move =
    Math.abs(card.pct) >= 1
      ? `${pctLabel(card.pct)} over the last ${MOVER_DAYS} days.`
      : `Flat over the last ${MOVER_DAYS} days.`;
  return [
    `Card of the day: ${card.name}, ${card.setName} ${card.number}.`,
    `Market price ${money(card.to)}. ${move}`,
    "",
    "Scan a card, see what it's worth. cardflip.io",
  ].join("\n");
}

/** Caption for the set spotlight (morning slot): the set's priciest cards and their week. */
export function setCaption(game: GameId, spot: SetSpotlight): string {
  const lines = spot.cards.map((m) => {
    const v = variantLabel(m.variant);
    const week = m.unsettled ? "" : Math.abs(m.pct) >= 1 ? `, ${pctLabel(m.pct)} this week` : ", steady this week";
    return `${m.name} #${m.number}${v ? ` ${v}` : ""}: ${money(m.to)}${week}`;
  });
  return [`The five most valuable ${GAME_LABEL[game]} cards in ${spot.setName} right now, market price from CardFlip's own price history.`, "", ...lines, "", "Scan a card, see what it's worth. cardflip.io"].join("\n");
}

export function setShortCaption(game: GameId, spot: SetSpotlight): string {
  return [`${spot.setName}: the five most valuable cards right now`, ...spot.cards.map((m) => `${m.name} #${m.number} ${money(m.to)}`), "", "Scan a card, see what it's worth. cardflip.io"].join("\n");
}

/** Today's drafts for a game, in posting order. Empty when the data is thin. */
export async function socialDrafts(game: GameId, day = todayUtc()): Promise<SocialPost[]> {
  // Gainers at 1pm, drops at 7pm: no card appears in both posts on the same day.
  const [movers, spot, dips] = await Promise.all([
    recentlyFeatured(game, "movers", day).then((exclude) => topMovers(game, day, { direction: "up", exclude })),
    setSpotlight(game, day),
    recentlyFeatured(game, "dips", day).then((exclude) => topMovers(game, day, { direction: "down", exclude })),
  ]);
  const posts: SocialPost[] = [];
  if (movers.length >= 3) {
    posts.push({
      id: `${game}-movers-${day}`,
      kind: "movers",
      game,
      day,
      title: `${GAME_LABEL[game]} movers of the week`,
      caption: moversCaption(game, movers),
      shortCaption: moversShortCaption(game, movers),
      hashtags: GAME_TAGS[game],
      imagePath: `/api/social/image?kind=movers&game=${game}&day=${day}`,
      cardIds: movers.map((m) => m.cardId),
    });
  }
  if (spot) {
    posts.push({
      id: `${game}-set-${day}`,
      kind: "set",
      game,
      day,
      title: `Set spotlight: ${spot.setName}`,
      caption: setCaption(game, spot),
      shortCaption: setShortCaption(game, spot),
      hashtags: GAME_TAGS[game],
      imagePath: `/api/social/image?kind=set&game=${game}&day=${day}`,
      cardIds: spot.cards.map((m) => m.cardId),
    });
  }
  if (dips.length >= 3) {
    posts.push({
      id: `${game}-dips-${day}`,
      kind: "dips",
      game,
      day,
      title: `${GAME_LABEL[game]} price drops this week`,
      caption: dipsCaption(game, dips),
      shortCaption: dipsShortCaption(game, dips),
      hashtags: GAME_TAGS[game],
      imagePath: `/api/social/image?kind=dips&game=${game}&day=${day}`,
      cardIds: dips.map((m) => m.cardId),
    });
  }
  return posts;
}
