import "server-only";
import { db } from "@/lib/db";
import { decodePrices, todayUtc } from "@/lib/priceSeries";
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
/** Below this the % swing is noise (a 40¢ common doubling). */
export const MOVER_MIN_PRICE = 3;
/** Card of the day comes from the cards worth talking about. */
export const COTD_MIN_PRICE = 15;
/** How many series rows one call may read (Turso rows-read, 09-06). */
const ROW_CAP = 6000;
const VARIANT_ORDER = ["normal", "holofoil", "reverseHolofoil"];

export type PostKind = "movers" | "card";
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

/** Last non-null price at or before index `at` (−1 = the last point). */
function priceAt(prices: (number | null)[], at: number): number | null {
  for (let i = Math.min(at < 0 ? prices.length - 1 : at, prices.length - 1); i >= 0; i--) {
    if (prices[i] != null) return prices[i];
  }
  return null;
}

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
  const out = new Map<string, { variant: string; from: number | null; to: number }>();
  for (const r of rows) {
    const prices = decodePrices(r.prices);
    const todayIdx = dayDiff(r.start_day, day);
    const to = priceAt(prices, todayIdx);
    if (to == null) continue;
    const from = todayIdx - days >= 0 ? priceAt(prices, todayIdx - days) : null;
    const have = out.get(r.card_id);
    if (!have || rank(r.variant) < rank(have.variant)) out.set(r.card_id, { variant: r.variant, from, to });
  }
  return out;
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
  { days = MOVER_DAYS, limit = MOVER_LIMIT, minPrice = MOVER_MIN_PRICE } = {},
): Promise<Mover[]> {
  const series = await freshSeries(game, day, days);
  const moves: { cardId: string; variant: string; from: number; to: number; pct: number }[] = [];
  for (const [cardId, s] of series) {
    if (s.from == null || s.from <= 0) continue;
    if (Math.max(s.from, s.to) < minPrice) continue;
    const pct = ((s.to - s.from) / s.from) * 100;
    if (Math.abs(pct) < 1) continue;
    moves.push({ cardId, variant: s.variant, from: s.from, to: s.to, pct });
  }
  moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || a.cardId.localeCompare(b.cardId));
  const top = moves.slice(0, limit * 3);
  const cat = await catalogRows(game, top.map((m) => m.cardId));
  const out: Mover[] = [];
  for (const m of top) {
    const c = cat.get(m.cardId);
    if (!c) continue;
    out.push({ ...m, name: c.name, setName: c.set_name, number: c.number, imageUrl: postArtUrl(game, c.image_url) });
    if (out.length >= limit) break;
  }
  return out;
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
    name: c.name,
    setName: c.set_name,
    number: c.number,
    imageUrl: postArtUrl(game, c.image_url),
    variant: s.variant,
    from,
    to: s.to,
    pct: from > 0 ? ((s.to - from) / from) * 100 : 0,
  };
}

export function money(n: number): string {
  return n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

export function pctLabel(pct: number): string {
  const r = Math.round(pct);
  return `${r > 0 ? "+" : ""}${r}%`;
}

const GAME_LABEL: Record<GameId, string> = { pokemon: "Pokémon", mtg: "Magic" };
const GAME_TAGS: Record<GameId, string[]> = {
  pokemon: ["PokemonTCG", "PokemonCards", "TCG"],
  mtg: ["MTG", "MagicTheGathering", "MTGFinance"],
};

/** Caption for the movers post. Plain, no exclamation marks (docs/SOCIAL.md). */
export function moversCaption(game: GameId, movers: Mover[]): string {
  const lines = movers.map((m) => `${m.name} (${m.setName} ${m.number}) ${money(m.from)} → ${money(m.to)}, ${pctLabel(m.pct)}`);
  return [
    `${GAME_LABEL[game]} price moves this week, from CardFlip's own price history.`,
    "",
    ...lines,
    "",
    "Scan a card, see what it's worth. cardflip.io",
  ].join("\n");
}

/** The movers post in under 300 characters: name and % only. */
export function moversShortCaption(game: GameId, movers: Mover[]): string {
  return [
    `${GAME_LABEL[game]} price moves this week`,
    ...movers.map((m) => `${m.name} ${pctLabel(m.pct)}`),
    "",
    "Scan a card, see what it's worth. cardflip.io",
  ].join("\n");
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

/** Today's drafts for a game, in posting order. Empty when the data is thin. */
export async function socialDrafts(game: GameId, day = todayUtc()): Promise<SocialPost[]> {
  const [movers, card] = await Promise.all([topMovers(game, day), cardOfTheDay(game, day)]);
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
    });
  }
  if (card) {
    posts.push({
      id: `${game}-card-${day}`,
      kind: "card",
      game,
      day,
      title: `Card of the day: ${card.name}`,
      caption: cardCaption(game, card),
      shortCaption: cardCaption(game, card),
      hashtags: GAME_TAGS[game],
      imagePath: `/api/social/image?kind=card&game=${game}&day=${day}`,
    });
  }
  return posts;
}
