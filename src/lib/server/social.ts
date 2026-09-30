import "server-only";
import { db } from "@/lib/db";
import { decodePrices, todayUtc } from "@/lib/priceSeries";
import { GATED_GAMES, gamePublic, getSetting, setSetting, type GatedGame } from "@/lib/server/settings";
import type { VideoCard } from "@/lib/socialVideo";
import type { GameId } from "@/lib/types";
import { MIXED_GAMES, MIXED_PER_GAME, PLAN_TAGS, POST_GAME_NAMES, POST_GAME_ORDER, countWord, dayPlan, listNames, otherGameNames } from "@/lib/socialPlan";

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
/** A safety cap on series rows per call; the price filter keeps the pool well under it (~11k Pokémon rows, 09-30). */
const ROW_CAP = 30000;
/** Series under this (latest or week-ago point) never make a post: half the mover floor, so a $6 → $12 gain still counts. */
const POOL_MIN_USD = MOVER_MIN_PRICE / 2;
/**
 * Magic reads a different pool (09-30): ~140k fresh mtg series, so an
 * unordered ROW_CAP sample was 4k Secret Lair / The List rows and almost
 * no card worth posting — every Magic draft came out empty. Magic reads
 * the NONFOIL series of cards the mirror prices at MTG_POOL_MIN_USD or
 * more instead (~10k rows); old-set foils spike on one sale (a $7.95
 * Invasion foil "up 240%") and are left out on purpose.
 */
const MTG_POOL_MIN_USD = MOVER_MIN_PRICE / 2;
const MTG_POOL_CAP = 20000;
const VARIANT_ORDER = ["normal", "nonfoil", "holofoil", "reverseHolofoil"];

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

/** "games" = every public game in one picture (a day-plan kind, lib/socialPlan.ts). */
export type PostKind = "movers" | "card" | "dips" | "set" | "games";
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
  /** Set on a mixed-game list (mixedMovers); a single-game list leaves it off. */
  game?: GameId;
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
  /** A mixed-game post's cards by game, so each game's no-repeat list gets its own (cardIds is filed under `game` otherwise). */
  featured?: Partial<Record<GameId, string[]>>;
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
  const rows = (
    game === "mtg"
      ? await db
          .prepare(
            `SELECT p.card_id, p.variant, p.start_day, p.prices FROM mtg_cards m
              JOIN price_series p ON p.card_id = m.id AND p.game = 'mtg' AND p.source = 'tcgplayer' AND p.currency = 'USD' AND p.updated_day >= ?
              WHERE p.variant = 'nonfoil' AND m.price_usd >= ?
              LIMIT ${MTG_POOL_CAP}`,
          )
          .all(since, MTG_POOL_MIN_USD)
      : await db
          .prepare(
            // Only cards worth posting (09-30): the unordered ROW_CAP sample was
            // 6k of ~36k fresh Pokémon rows, so "the five most valuable cards in
            // Base Set" left out a $944 Charizard. A card is in when any of its
            // series' latest or week-ago point is at POOL_MIN_USD or more, and
            // then ALL its series come back, so the preferred variant still
            // speaks for it (filtering series alone let a $49.99 reverse holo
            // stand in for a $1.02 Team Aqua's Corphish).
            `SELECT card_id, variant, start_day, prices FROM price_series
              WHERE game = ? AND currency = 'USD' AND updated_day >= ?
                AND card_id IN (
                  SELECT card_id FROM price_series
                   WHERE game = ? AND currency = 'USD' AND updated_day >= ?
                     AND MAX(COALESCE(json_extract(prices, '$[#-1]'), 0), COALESCE(json_extract(prices, '$[#-2]'), 0),
                             COALESCE(json_extract(prices, '$[#-${days + 1}]'), 0)) >= ?)
              LIMIT ${ROW_CAP}`,
          )
          .all(game, since, game, since, POOL_MIN_USD)
  ) as unknown as SeriesRow[];
  if (rows.length >= (game === "mtg" ? MTG_POOL_CAP : ROW_CAP)) console.warn(`social: ${game} series pool hit its cap (${rows.length}); posts may miss cards`);
  const out = new Map<string, { variant: string; from: number | null; to: number; held: number; median: number; fromSettled: boolean }>();
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
    // The same test for the OLD price over the week before it: a drop from a one-day spike
    // (Fighting Energy "$37.49 → $10", 09-30) is the spike ending, not news. Days with no
    // point do not count against it (Magic has no history 09-16 → 09-23; a card priced
    // once a week has nothing to hold), so it asks HELD_DAYS of the days that have a price.
    let fromSettled = true;
    if (from != null) {
      const fromIdx = todayIdx - days;
      let seen = 0;
      let fromHeld = 0;
      for (let i = Math.max(0, fromIdx - days + 1); i <= fromIdx; i++) {
        const v = priceAt(prices, i, CARRY_DAYS);
        if (v == null) continue;
        seen++;
        if (Math.abs(v - from) / from <= 0.15) fromHeld++;
      }
      fromSettled = fromHeld >= Math.min(HELD_DAYS, seen);
    }
    const have = out.get(r.card_id);
    if (!have || rank(r.variant) < rank(have.variant)) out.set(r.card_id, { variant: r.variant, from, to, held, median, fromSettled });
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

/**
 * The Mover rows for cards a video froze (lib/socialVideo.ts VideoCard: the
 * ids and numbers it drew, no art), with today's catalog art, so a picture
 * can be drawn from exactly the list the caption names. null when a card is no
 * longer in the catalog (the caller draws the live list instead).
 */
export async function moversFromCards(game: GameId, cards: VideoCard[]): Promise<Mover[] | null> {
  const byGame = new Map<GameId, string[]>();
  for (const c of cards) byGame.set(c.game ?? game, [...(byGame.get(c.game ?? game) ?? []), c.cardId]);
  const art = new Map<string, string>();
  for (const [g, ids] of byGame) for (const [id, row] of await catalogRows(g, ids)) art.set(`${g}:${id}`, postArtUrl(g, row.image_url));
  const out: Mover[] = [];
  for (const c of cards) {
    const url = art.get(`${c.game ?? game}:${c.cardId}`);
    if (url === undefined) return null;
    out.push({ ...c, imageUrl: url, unsettled: Boolean(c.unsettled) });
  }
  return out;
}

/** Large art for the post image (Pokémon mirrors store the low.webp path, Magic's Scryfall "normal" one). */
export function postArtUrl(game: GameId, imageUrl: string): string {
  if (!imageUrl) return "";
  return game === "mtg" ? imageUrl.replace("/normal/", "/large/") : imageUrl.replace("/low.webp", "/high.webp");
}

/**
 * The biggest moves over the last MOVER_DAYS days, up and down, for cards
 * worth at least MOVER_MIN_PRICE on both ends, where the old and the new
 * price each held HELD_DAYS days. Sorted by |%| desc.
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
    // Both ends at the floor (09-30, was either end): a common "$8.64 → $49.99, +479%"
    // (Team Aqua's Corphish) is one odd listing, not a move a collector believes.
    if (Math.min(s.from, s.to) < minPrice) continue;
    const pct = ((s.to - s.from) / s.from) * 100;
    if (Math.abs(pct) < 1) continue;
    if (s.held < HELD_DAYS) continue;
    // The old price must have held too, or the "move" is a spike unwinding.
    if (!s.fromSettled) continue;
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

/**
 * A mixed-game gainers list (day plan mixedMovers, Chris 09-30: "a video
 * that mixes both magic and pokemon"): each game's top `perGame` gainers
 * under the same quality floors and its own no-repeat list, alternating
 * from each game's No. 1 (P1, M1, P2, M2, …). The video counts the list
 * down from the end, so its finale is a No. 1. Magic's history has no
 * points 09-16 → 09-23, so when a 7-day look back finds too few the window
 * drops a day (a 6-day move is still "this week").
 */
export async function mixedMovers(day = todayUtc(), games: GameId[] = MIXED_GAMES, perGame = MIXED_PER_GAME): Promise<Mover[]> {
  const lists = await Promise.all(
    games.map(async (g) => {
      const exclude = await recentlyFeatured(g, "movers", day);
      let list = await topMovers(g, day, { direction: "up", exclude, limit: perGame });
      if (list.length < perGame) list = await topMovers(g, day, { direction: "up", exclude, limit: perGame, days: MOVER_DAYS - 1 });
      return list.map((m) => ({ ...m, game: g }));
    }),
  );
  const out: Mover[] = [];
  for (let i = 0; i < perGame; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

/**
 * One real, priced card per public game for the all-games post. It runs at
 * 7pm every day (Chris 09-30: "the 7pm post is supposed to feature all 5 …
 * every day for now"), so each game's card rotates by date through that
 * game's scanner-stage picks (popular cards, $15–$300) instead of repeating
 * the homepage strip's lead. One Piece keeps its pinned lead: most One Piece
 * pictures carry Bandai's SAMPLE stamp, and P-055 is the one checked clean.
 */
export interface GameLead {
  game: GameId;
  name: string;
  setName: string;
  number: string;
  price: number;
  imageUrl: string;
}

export async function gameLeads(day = todayUtc()): Promise<GameLead[]> {
  const { getGameStageCards } = await import("@/lib/server/stageCards");
  const out: GameLead[] = [];
  for (const g of POST_GAME_ORDER) {
    if ((GATED_GAMES as readonly string[]).includes(g) && !(await gamePublic(g as GatedGame))) continue;
    const cards = (await getGameStageCards(g)).cards.filter((c) => c.imageUrl && c.price != null && c.price > 0);
    const pool = g === "onepiece" ? cards.filter((c) => c.lead) : cards;
    if (pool.length === 0) continue;
    const pick = pool[hashDay(day, `${g}:games`) % pool.length];
    out.push({ game: g, name: displayName(pick.name), setName: pick.setName, number: pick.number, price: pick.price!, imageUrl: pick.imageUrl });
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
  // A set Chris approved for the day wins (socialPlan.ts DayPlan.set), when it still qualifies.
  const pinned = dayPlan(day).set;
  const setId = pinned && sets.includes(pinned) ? pinned : sets[hashDay(day, `${game}:set`) % sets.length];
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

const GAME_LABEL: Record<GameId, string> = { pokemon: "Pokémon", mtg: "Magic", lorcana: "Lorcana", onepiece: "One Piece", yugioh: "Yu-Gi-Oh!" };
const GAME_TAGS: Record<GameId, string[]> = {
  pokemon: ["PokemonTCG", "PokemonCards", "TCG"],
  mtg: ["MTG", "MagicTheGathering", "MTGFinance"],
  lorcana: ["DisneyLorcana", "Lorcana", "TCG"],
  onepiece: ["OnePieceCardGame", "OPTCG", "TCG"],
  yugioh: ["Yugioh", "YuGiOhTCG", "TCG"],
};

const SIGN_OFF = "Scan a card, see what it's worth. cardflip.io";

/**
 * The sign-off lines. `alsoScans` (a day plan, Chris 09-30: "make some
 * reference to the fact we can scan the other game types too") names the
 * games the post does not cover; the short form folds it into one line so
 * the hashtags still fit X's 257.
 */
function signOff(covered: GameId[] | null): string[] {
  return covered ? [`CardFlip also scans ${listNames(otherGameNames(covered))}.`, SIGN_OFF] : [SIGN_OFF];
}
function shortSignOff(covered: GameId[] | null): string {
  return covered ? `Also scans ${listNames(otherGameNames(covered))}. cardflip.io` : SIGN_OFF;
}

/** Caption for the movers post. Plain, no exclamation marks (docs/SOCIAL.md). */
export function moversCaption(game: GameId, movers: Mover[], alsoScans = false): string {
  const lines = movers.map((m) => `${m.name} (${m.setName} ${m.number}) ${money(m.from)} → ${money(m.to)}, ${pctLabel(m.pct)}`);
  return [
    `${GAME_LABEL[game]} price gains this week, from CardFlip's own price history.`,
    "",
    ...lines,
    "",
    ...signOff(alsoScans ? [game] : null),
  ].join("\n");
}

/** The movers post in under 300 characters: name and % only. */
export function moversShortCaption(game: GameId, movers: Mover[], alsoScans = false): string {
  return [
    `${GAME_LABEL[game]} price gains this week`,
    ...movers.map((m) => `${m.name} ${pctLabel(m.pct)}`),
    "",
    shortSignOff(alsoScans ? [game] : null),
  ].join("\n");
}

function moverGames(movers: Mover[]): GameId[] {
  return POST_GAME_ORDER.filter((g) => movers.some((m) => m.game === g));
}

/** Caption for a mixed-game movers post (mixedMovers): each line says its game. */
export function mixedMoversCaption(movers: Mover[]): string {
  const games = moverGames(movers);
  const lines = movers.map((m) => `${POST_GAME_NAMES[m.game ?? "pokemon"]}: ${m.name} (${m.setName} ${m.number}) ${money(m.from)} → ${money(m.to)}, ${pctLabel(m.pct)}`);
  return [
    `The week's biggest price gains in ${listNames(games.map((g) => POST_GAME_NAMES[g]))}, from CardFlip's own price history.`,
    "",
    ...lines,
    "",
    ...signOff(games),
  ].join("\n");
}

export function mixedMoversShortCaption(movers: Mover[]): string {
  const games = moverGames(movers);
  return [
    `${listNames(games.map((g) => POST_GAME_NAMES[g]))} price gains this week`,
    ...movers.map((m) => `${m.name} ${pctLabel(m.pct)}`),
    "",
    shortSignOff(games),
  ].join("\n");
}

/** Caption for the price-drops post (evening slot): the week's biggest falls. */
export function dipsCaption(game: GameId, dips: Mover[], alsoScans = false): string {
  const lines = dips.map((m) => `${m.name} (${m.setName} ${m.number}) ${money(m.from)} → ${money(m.to)}, ${pctLabel(m.pct)}`);
  return [
    `${GAME_LABEL[game]} price drops this week, from CardFlip's own price history.`,
    "",
    ...lines,
    "",
    ...signOff(alsoScans ? [game] : null),
  ].join("\n");
}

export function dipsShortCaption(game: GameId, dips: Mover[], alsoScans = false): string {
  return [`${GAME_LABEL[game]} price drops this week`, ...dips.map((m) => `${m.name} ${pctLabel(m.pct)}`), "", shortSignOff(alsoScans ? [game] : null)].join("\n");
}

/** Caption for the all-games post (day plan morning "games"): what the scanner reads, then the card from each game in the picture. */
export function gamesCaption(leads: GameLead[]): string {
  const names = listNames(leads.map((l) => POST_GAME_NAMES[l.game]));
  // TCGplayer's Yu-Gi-Oh set names carry a print-run tag ("… (Worldwide English)") nobody says out loud.
  const setName = (s: string) => s.replace(/\s*\(Worldwide English\)$/i, "");
  return [
    `One scanner, ${countWord(leads.length)} card games. CardFlip reads ${names} cards from a photo and shows what each one is worth today.`,
    "",
    "In the picture, one card from each game at today's market price:",
    ...leads.map((l) => `${l.name}, ${setName(l.setName)} ${/^[A-Z]/.test(l.number) ? l.number : `#${l.number}`}: ${money(l.price)}`),
    "",
    SIGN_OFF,
  ].join("\n");
}

export function gamesShortCaption(leads: GameLead[]): string {
  return [`One scanner, ${countWord(leads.length)} card games: ${listNames(leads.map((l) => POST_GAME_NAMES[l.game]))}.`, "", SIGN_OFF].join("\n");
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
export function setCaption(game: GameId, spot: SetSpotlight, alsoScans = false): string {
  const lines = spot.cards.map((m) => {
    const v = variantLabel(m.variant);
    const week = m.unsettled ? "" : Math.abs(m.pct) >= 1 ? `, ${pctLabel(m.pct)} this week` : ", steady this week";
    return `${m.name} #${m.number}${v ? ` ${v}` : ""}: ${money(m.to)}${week}`;
  });
  return [`The five most valuable ${GAME_LABEL[game]} cards in ${spot.setName} right now, market price from CardFlip's own price history.`, "", ...lines, "", ...signOff(alsoScans ? [game] : null)].join("\n");
}

export function setShortCaption(game: GameId, spot: SetSpotlight, alsoScans = false): string {
  return [`${spot.setName}: the five most valuable cards right now`, ...spot.cards.map((m) => `${m.name} #${m.number} ${money(m.to)}`), "", shortSignOff(alsoScans ? [game] : null)].join("\n");
}

/** Hashtags for a single-game post: the game's own, or the "also scans" set on a plan day. */
function tagsFor(game: GameId, alsoScans: boolean): string[] {
  return alsoScans && game === "pokemon" ? [...PLAN_TAGS.pokemonAlsoScans] : GAME_TAGS[game];
}

/** Today's drafts for a game, in posting order. Empty when the data is thin. */
export async function socialDrafts(game: GameId, day = todayUtc()): Promise<SocialPost[]> {
  // A day plan (lib/socialPlan.ts) can mix Magic into the Pokémon movers,
  // add the all-games picture, and name the other games on Pokémon posts.
  const plan = dayPlan(day);
  const mixed = Boolean(plan.mixedMovers) && game === "pokemon";
  const also = Boolean(plan.alsoScans) && game === "pokemon";
  // Gainers at 1pm, drops at 7pm: no card appears in both posts on the same day.
  const [movers, spot, dips, leads] = await Promise.all([
    mixed ? mixedMovers(day) : recentlyFeatured(game, "movers", day).then((exclude) => topMovers(game, day, { direction: "up", exclude })),
    setSpotlight(game, day),
    recentlyFeatured(game, "dips", day).then((exclude) => topMovers(game, day, { direction: "down", exclude })),
    // The all-games post is the standing 7pm post (and the publisher's first fallback), so it is drafted every day.
    game === "pokemon" ? gameLeads(day) : Promise.resolve([] as GameLead[]),
  ]);
  const posts: SocialPost[] = [];
  if (leads.length >= 3) {
    posts.push({
      id: `${game}-games-${day}`,
      kind: "games",
      game,
      day,
      title: `One scanner, ${countWord(leads.length)} card games`,
      caption: gamesCaption(leads),
      shortCaption: gamesShortCaption(leads),
      hashtags: [...PLAN_TAGS.games],
      imagePath: `/api/social/image?kind=games&game=${game}&day=${day}`,
      cardIds: [],
    });
  }
  if (mixed && movers.length >= 3) {
    const games = moverGames(movers);
    posts.push({
      id: `${game}-movers-${day}`,
      kind: "movers",
      game,
      day,
      title: `${listNames(games.map((g) => POST_GAME_NAMES[g]))} movers of the week`,
      caption: mixedMoversCaption(movers),
      shortCaption: mixedMoversShortCaption(movers),
      hashtags: [...PLAN_TAGS.mixedMovers],
      imagePath: `/api/social/image?kind=movers&game=${game}&day=${day}`,
      cardIds: movers.map((m) => m.cardId),
      featured: featuredByGame(movers),
    });
  } else if (movers.length >= 3) {
    posts.push({
      id: `${game}-movers-${day}`,
      kind: "movers",
      game,
      day,
      title: `${GAME_LABEL[game]} movers of the week`,
      caption: moversCaption(game, movers, also),
      shortCaption: moversShortCaption(game, movers, also),
      hashtags: tagsFor(game, also),
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
      caption: setCaption(game, spot, also),
      shortCaption: setShortCaption(game, spot, also),
      hashtags: tagsFor(game, also),
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
      caption: dipsCaption(game, dips, also),
      shortCaption: dipsShortCaption(game, dips, also),
      hashtags: tagsFor(game, also),
      imagePath: `/api/social/image?kind=dips&game=${game}&day=${day}`,
      cardIds: dips.map((m) => m.cardId),
    });
  }
  return posts;
}

/** A mixed list's card ids by game, for each game's no-repeat list. */
export function featuredByGame(movers: Pick<Mover, "cardId" | "game">[]): Partial<Record<GameId, string[]>> {
  const out: Partial<Record<GameId, string[]>> = {};
  for (const m of movers) {
    const g = m.game ?? "pokemon";
    (out[g] ??= []).push(m.cardId);
  }
  return out;
}
