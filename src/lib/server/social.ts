import "server-only";
import { db } from "@/lib/db";
import { addDays, decodePrices, todayUtc } from "@/lib/priceSeries";
import { PRICE_TRUST, isVintage, lastPriced, priceTrust, stepJump } from "@/lib/server/priceTrust";
import { GATED_GAMES, gamePublic, getSetting, setSetting, type GatedGame } from "@/lib/server/settings";
import { tiktokKey } from "@/lib/socialTiktok";
import type { VideoCard } from "@/lib/socialVideo";
import type { GameId } from "@/lib/types";
import { GENERAL_TAGS, MAX_TAGS, JUMP_MIN_PCT, MIXED_GAMES, MIXED_PER_GAME, PLAN_TAGS, POST_GAME_NAMES, POST_GAME_ORDER, countWord, dayPlan, freshJumpsOn, gamesTags, jumpsOn, listNames, otherGameNames, questionFor, riserSetsOn } from "@/lib/socialPlan";

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
/** The price guard logs a run's skipped cards once per game and day (freshSeries runs several times per run). */
const guardLogged = new Set<string>();
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
  /** No % is claimed: today's point has not held HELD_DAYS days (`to` is then the week's median), or the price a week ago did not pass the price guard. */
  unsettled?: boolean;
  /** Set on a mixed-game list (mixedMovers); a single-game list leaves it off. */
  game?: GameId;
  /** A set spotlight card's place by value among the set's five (1 = the most valuable): the list itself may lead with the biggest riser instead. */
  rank?: number;
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
  /**
   * The one question the caption carries (lib/socialPlan.ts questionFor), kept
   * apart so fitText can drop it first when a site's limit is tight (it sits
   * after the card lines and before the sign-off, in caption and shortCaption).
   */
  question?: string;
}

interface SeriesRow {
  card_id: string;
  variant: string;
  start_day: string;
  prices: string;
  /** Pokémon: the card's fresh Cardmarket 'average' series (EUR), null when it has none or it is stale. */
  cm_prices?: string | null;
  /** Magic: Scryfall's Cardmarket price (EUR) from mtg_cards. */
  price_eur?: number | null;
  /** Pokémon: the set's release date (priceTrust vintage). */
  released?: string | null;
}

interface FreshCard {
  variant: string;
  from: number | null;
  to: number;
  held: number;
  median: number;
  fromSettled: boolean;
  /** `from` passes the price guard as an old price (or there is no `from`): the old side of a printed move is judged too. */
  fromOk: boolean;
  /** `median` passes it too (only asked when today's point has not held HELD_DAYS days, the one case the median is printed). */
  medianOk: boolean;
  /** Why the latest price is a lone one-day step out of a long flat stretch nobody confirmed (priceTrust stepJump), "" when it is not. Movers leave such a card out of the gains. */
  stepJump: string;
}

/** What freshSeries hands back: the clean cards, and the cards the guard could not vouch for (not proved wrong) with their price. */
interface FreshSeries {
  cards: Map<string, FreshCard>;
  unverified: Map<string, number>;
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
 *
 * The price guard lives here (09-30, lib/server/priceTrust.ts): a card whose
 * chosen series fails it is left out of the Map, so movers, dips, the set
 * spotlight, the card of the day and every video read only prices a
 * collector would believe. The judged series is the one `to` comes from.
 * The other printed numbers are judged too (the old price of a move, the
 * week's median an unsettled card shows), as OLD prices: a junk price that
 * has just corrected must not headline the drops post as "$1,013 -> $100".
 * A card the guard could not prove wrong (soft signs only) is left out but
 * remembered in `unverified`, so the set spotlight does not claim "the most
 * valuable cards" of a set whose marquee card it had to drop.
 * Only catalog cards come back (en_cards / mtg_cards): the price table also
 * holds sealed products, which made "tcgp-sealed" count as a set and a quarter
 * of the card-of-the-day pool a non-card.
 */
async function freshSeries(game: GameId, day: string, days: number): Promise<FreshSeries> {
  const since = new Date(Date.parse(day + "T00:00:00Z") - 3 * 86_400_000).toISOString().slice(0, 10);
  const cmSince = addDays(day, -PRICE_TRUST.refMaxAgeDays);
  const rows = (
    game === "mtg"
      ? await db
          .prepare(
            `SELECT p.card_id, p.variant, p.start_day, p.prices, m.price_eur FROM mtg_cards m
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
            // stand in for a $1.02 Team Aqua's Corphish). TCGplayer rows only
            // (an eBay PSA 10 row sat in the pool at rank 99), catalog cards
            // only, and the card's fresh Cardmarket average rides along as the
            // price guard's second source (one PK lookup per row, no extra query).
            `SELECT p.card_id, p.variant, p.start_day, p.prices, c.prices AS cm_prices, e.set_release_date AS released
               FROM price_series p
               JOIN en_cards e ON e.id = p.card_id
               LEFT JOIN price_series c ON c.card_id = p.card_id AND c.variant = 'average' AND c.source = 'cardmarket' AND c.updated_day >= ?
              WHERE p.game = ? AND p.currency = 'USD' AND p.source = 'tcgplayer' AND p.updated_day >= ?
                AND p.card_id IN (
                  SELECT card_id FROM price_series
                   WHERE game = ? AND currency = 'USD' AND source = 'tcgplayer' AND updated_day >= ?
                     AND MAX(COALESCE(json_extract(prices, '$[#-1]'), 0), COALESCE(json_extract(prices, '$[#-2]'), 0),
                             COALESCE(json_extract(prices, '$[#-${days + 1}]'), 0)) >= ?)
              LIMIT ${ROW_CAP}`,
          )
          .all(cmSince, game, since, game, since, POOL_MIN_USD)
  ) as unknown as SeriesRow[];
  if (rows.length >= (game === "mtg" ? MTG_POOL_CAP : ROW_CAP)) console.warn(`social: ${game} series pool hit its cap (${rows.length}); posts may miss cards`);
  // One entry per card: its series (so the preferred variant speaks for it and the rest are its siblings) and the second-source price.
  const cards = new Map<string, { series: { variant: string; prices: (number | null)[]; todayIdx: number; to: number }[]; refEur: number | null; refPrices: (number | null)[] | null; released: string }>();
  for (const r of rows) {
    const prices = decodePrices(r.prices);
    const todayIdx = dayDiff(r.start_day, day);
    const to = priceAt(prices, todayIdx);
    if (to == null) continue;
    let card = cards.get(r.card_id);
    if (!card) {
      const refEur = game === "mtg" ? (r.price_eur ?? null) : r.cm_prices ? lastPriced(decodePrices(r.cm_prices)) : null;
      cards.set(r.card_id, (card = { series: [], refEur, refPrices: game !== "mtg" && r.cm_prices ? decodePrices(r.cm_prices) : null, released: r.released ?? "" }));
    }
    card.series.push({ variant: r.variant, prices, todayIdx, to });
  }
  const out = new Map<string, FreshCard>();
  const unverified = new Map<string, number>();
  const skipped: { id: string; reason: string }[] = [];
  for (const [cardId, card] of cards) {
    // The preferred variant (first among equals, as before).
    const pref = card.series.reduce((a, b) => (rank(b.variant) < rank(a.variant) ? b : a));
    const { prices, todayIdx, to } = pref;
    const others = card.series.filter((s) => s !== pref);
    const vintage = isVintage(pref.variant, card.released);
    const trust = priceTrust({
      to,
      prices: todayIdx < 0 ? prices : prices.slice(0, todayIdx + 1),
      siblings: others.map((s) => s.to),
      refEur: card.refEur,
      vintage,
    });
    if (!trust.ok) {
      skipped.push({ id: cardId, reason: trust.reason });
      // A stale price (flat 45+ days, 10-02) is skipped exactly as the old hard "flat" verdict was: the site shows it with a note,
      // but a post never prints it, and it does not count as an unverified price that would stop a set from posting.
      if (!trust.hard && trust.stale == null) unverified.set(cardId, to);
      continue;
    }
    // A price `back` days before today, judged as an old price: this series up to that day, the siblings as they stood then.
    const oldPriceOk = (back: number, value: number) =>
      priceTrust({
        to: value,
        prices: prices.slice(0, todayIdx - back + 1),
        siblings: others.flatMap((s) => (s.todayIdx - back >= 0 ? [priceAt(s.prices, s.todayIdx - back, CARRY_DAYS)] : [])).filter((v): v is number => v != null),
        refEur: card.refEur,
        vintage,
        old: true,
      }).ok;
    const from = todayIdx - days >= 0 ? priceAt(prices, todayIdx - days, CARRY_DAYS) : null;
    const fromOk = from == null || oldPriceOk(days, from);
    // Days in the window whose price sits within 15% of today's: a real move holds, a stray sale does not.
    let held = 0;
    const window: { v: number; back: number }[] = [];
    // Carry the last known price across a few days with no point, so a card priced twice a week still "holds".
    for (let i = Math.max(0, todayIdx - days + 1); i <= todayIdx; i++) {
      const v = priceAt(prices, i, CARRY_DAYS);
      if (v == null) continue;
      window.push({ v, back: todayIdx - i });
      if (Math.abs(v - to) / to <= 0.15) held++;
    }
    // Median of the window: the price to show when today's point has not held (Pikachu Star $3,217 → $900 in a day, 09-25).
    const sorted = window.map((w) => w.v).sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : to;
    // Only asked when the median is what gets printed; judged on the most recent day that stood at it.
    const medianDay = window.filter((w) => w.v === median).reduce((m, w) => Math.min(m, w.back), Infinity);
    const medianOk = held >= HELD_DAYS || medianDay === Infinity || oldPriceOk(medianDay, median);
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
    // A gain that is one unconfirmed day-step out of months of nothing is a thin-market print, not a move (the movers pick reads this; the price itself still passes).
    const upTo = todayIdx < 0 ? prices : prices.slice(0, todayIdx + 1);
    const step = stepJump({ prices: todayIdx >= upTo.length ? [...upTo, ...Array(todayIdx - upTo.length + 1).fill(null)] : upTo, days, refEur: card.refEur, refPrices: card.refPrices }).reason;
    out.set(cardId, { variant: pref.variant, from, to, held, median, fromSettled, fromOk, medianOk, stepJump: step });
  }
  // Logged once per game and day, not once per call (drafts read this several times): the next session can see what the guard dropped.
  const logKey = `${game}:${day}`;
  if (skipped.length && !guardLogged.has(logKey)) {
    guardLogged.add(logKey);
    console.warn(`social: price guard skipped ${skipped.length} ${game} cards (${skipped.slice(0, 5).map((s) => `${s.id} ${s.reason}`).join("; ")})`);
  }
  return { cards: out, unverified };
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
  const { cards: series } = await freshSeries(game, day, days);
  const moves: { cardId: string; variant: string; from: number; to: number; pct: number }[] = [];
  const staleFrom: string[] = [];
  const stepped: string[] = [];
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
    // The old price is printed too ("$662 -> $345"), so it has to be a price a collector believes: a parked
    // listing or a spike being unwound is not a market price (the doubling rule lives in priceTrust).
    if (!s.fromOk) {
      staleFrom.push(cardId);
      continue;
    }
    // The step-jump rule (priceTrust): a rise that arrived in one day out of a long flat stretch and no second source backs. The next mover takes its place.
    if (pct > 0 && s.stepJump) {
      stepped.push(`${cardId} ${s.stepJump}`);
      continue;
    }
    moves.push({ cardId, variant: s.variant, from: s.from, to: s.to, pct });
  }
  const logKey = `${game}:${day}:from`;
  if (staleFrom.length && !guardLogged.has(logKey)) {
    guardLogged.add(logKey);
    console.warn(`social: ${staleFrom.length} ${game} moves left out, the old price fails the price guard (${staleFrom.slice(0, 5).join(", ")})`);
  }
  const stepKey = `${game}:${day}:step`;
  if (stepped.length && !guardLogged.has(stepKey)) {
    guardLogged.add(stepKey);
    console.warn(`social: ${stepped.length} ${game} gains left out, one unconfirmed day-step after a long flat stretch (${stepped.slice(0, 5).join("; ")})`);
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
  /** Set only on a game's biggest weekly jump (gameJumps): the card's id, its price a week ago, the move in % and its price variant. A lead has none of these. */
  cardId?: string;
  from?: number;
  pct?: number;
  variant?: string;
}

/** A lead that is a card's weekly jump (it carries its move), not a plain market-price lead. */
export function isJump(l: Pick<GameLead, "from" | "pct">): boolean {
  return l.pct != null && l.from != null;
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

/**
 * The games whose price history the movers read (freshSeries reads Pokémon's
 * en_cards and Magic's mtg_cards). Lorcana, One Piece and Yu-Gi-Oh price series
 * only began on 09-30 and live in tcg_cards, which freshSeries does not read
 * yet: those games keep their lead card on the biggest-jump post.
 */
export const MOVER_GAMES: GameId[] = ["pokemon", "mtg"];

/**
 * A game's biggest weekly gainer for the 7pm "biggest price jump" post: the
 * top of topMovers' up list under every guard it already applies (priceTrust,
 * the step-jump rule, the $10 floor on both ends, a price that held, a
 * believable old price), skipping cards an earlier 7pm post already led with
 * ("jumps" no-repeat list, FEATURED_DAYS) and needing at least JUMP_MIN_PCT.
 * Magic's history has a gap 09-16 to 09-23, so an empty 7-day look back is
 * retried over 6 days (mixedMovers does the same). null = no gainer to claim.
 * From FRESH_JUMPS_FROM the cards today's 1pm gains post shows sit out too
 * (the 7pm cover was the 1pm's No. 1 again); when nothing else qualifies the
 * 1pm's card is kept, since a repeated gain beats a card with no move.
 */
export async function gameGainer(game: GameId, day = todayUtc()): Promise<Mover | null> {
  if (!MOVER_GAMES.includes(game)) return null;
  const seen = await recentlyFeatured(game, "jumps", day);
  const pick = async (exclude: Set<string>): Promise<Mover | null> => {
    let list = await topMovers(game, day, { direction: "up", exclude, limit: 1 });
    if (list.length < 1) list = await topMovers(game, day, { direction: "up", exclude, limit: 1, days: MOVER_DAYS - 1 });
    const m = list[0];
    return m && m.imageUrl && m.pct >= JUMP_MIN_PCT ? m : null;
  };
  const midday = await middayGainers(game, day);
  return (midday.size ? await pick(new Set([...seen, ...midday])) : null) ?? (await pick(seen));
}

/**
 * The cards a game has in today's 1pm gains post: the mixed list on a day
 * plan that mixes, else Pokémon's own top gainers (the 1pm is the Pokémon
 * post). Empty before FRESH_JUMPS_FROM, and when the list is under three
 * (socialDrafts posts no gains post then, so there is nothing to repeat).
 */
async function middayGainers(game: GameId, day: string): Promise<Set<string>> {
  if (!freshJumpsOn(day)) return new Set();
  const list = dayPlan(day).mixedMovers
    ? await mixedMovers(day)
    : game === "pokemon"
      ? (await topMovers(game, day, { direction: "up", exclude: await recentlyFeatured(game, "movers", day) })).map((m) => ({ ...m, game }))
      : [];
  return new Set(list.length >= 3 ? list.filter((m) => m.game === game).map((m) => m.cardId) : []);
}

/**
 * The 7pm post's cards (10-01, "the biggest price jump in each game this
 * week"): one per public game (the same games gameLeads picks), each the
 * game's top weekly gainer (gameGainer) or, where there is none, its lead
 * card exactly as before, so the post is never empty and never skips. Jumps
 * come first, biggest move first (the video opens on the best one); the
 * lead cards follow in the site's game order. With no jump anywhere this IS
 * gameLeads' list, in its own order.
 */
export async function gameJumps(day = todayUtc()): Promise<GameLead[]> {
  const leads = await gameLeads(day);
  const picked = await Promise.all(
    leads.map(async (l): Promise<GameLead> => {
      const m = await gameGainer(l.game, day);
      if (!m) return l;
      return { game: l.game, name: m.name, setName: m.setName, number: m.number, price: m.to, imageUrl: m.imageUrl, cardId: m.cardId, from: m.from, pct: m.pct, variant: m.variant };
    }),
  );
  const jumps = picked.filter(isJump).sort((a, b) => (b.pct as number) - (a.pct as number) || POST_GAME_ORDER.indexOf(a.game) - POST_GAME_ORDER.indexOf(b.game));
  return jumps.length ? [...jumps, ...picked.filter((l) => !isJump(l))] : picked;
}

type FeaturedKind = "movers" | "dips" | "jumps";

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
  const { cards: series } = await freshSeries(game, day, MOVER_DAYS);
  // The caption states the week's move, which is printed from the old price: it has to pass too.
  const pool = [...series.entries()].filter(([, s]) => s.to >= minPrice && s.fromOk).map(([id]) => id).sort();
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

/** The set on the day's registered 7am TikTok video (settings social_tiktok:morning:<day>, kind "set"), if there is one. */
async function renderedSet(day: string): Promise<string | undefined> {
  try {
    const row = JSON.parse((await getSetting(tiktokKey("morning", day))) || "null") as { kind?: string; cards?: { cardId?: string }[] } | null;
    const id = row?.kind === "set" ? row.cards?.[0]?.cardId : undefined;
    const dash = typeof id === "string" ? id.lastIndexOf("-") : -1;
    return dash > 0 ? id!.slice(0, dash) : undefined;
  } catch {
    return undefined;
  }
}

export interface SetSpotlight {
  setId: string;
  setName: string;
  /** In the order the post shows them: the set's most valuable cards, dearest first, unless one of them rose this week, which then leads (leadId). */
  cards: Mover[];
  /** The card that leads because it moved up the most this week among the five (the cover of the video, the first row of the picture); absent when none rose or the day is before JUMPS_FROM. */
  leadId?: string;
}

/**
 * Set spotlight (Chris 09-25: no single-card posts, several cards and
 * something to learn): the SET_MIN_CARDS most valuable cards of one set,
 * with their 7-day move. The set is picked by a hash of the date over
 * every set with enough priced cards, so the sets cycle and every run
 * agrees. PokÃ©mon only: the set is the card id's prefix (sv1-2 â†’ sv1);
 * Magic ids are opaque and Magic is not posted anyway.
 *
 * The guard's survivors are all it ranks, so a set whose marquee card the
 * guard could not vouch for (an unverified price that would rank inside the
 * five) does not qualify: the captions say "five of the most valuable", and
 * that stays true. A card proved wrong (a $1,013 Rayquaza at Cardmarket
 * EUR 45) does not block its set; its real price is unknown, not high.
 */
export async function setSpotlight(game: GameId, day = todayUtc(), { minCards = SET_MIN_CARDS, minPrice = SET_MIN_PRICE, leadFirst = jumpsOn(day) } = {}): Promise<SetSpotlight | null> {
  if (game !== "pokemon") return null;
  const { cards: series, unverified } = await freshSeries(game, day, MOVER_DAYS);
  // Rank on the settled price: today's point when it has held HELD_DAYS days, else the week's median.
  const settled = (id: string) => {
    const s = series.get(id)!;
    return s.held >= HELD_DAYS ? s.to : s.median;
  };
  const setOf = (id: string) => id.slice(0, id.lastIndexOf("-"));
  const bySet = new Map<string, string[]>();
  for (const [id, s] of series) {
    // An unsettled card prints the week's median, which has to be a price the guard believes too.
    if (s.to < minPrice || (s.held < HELD_DAYS && !s.medianOk)) continue;
    const dash = id.lastIndexOf("-");
    if (dash <= 0) continue;
    const setId = id.slice(0, dash);
    bySet.set(setId, [...(bySet.get(setId) ?? []), id]);
  }
  const blocked = (setId: string, ids: string[]) => {
    const fifth = ids.map(settled).sort((a, b) => b - a)[minCards - 1];
    for (const [id, price] of unverified) if (price > fifth && setOf(id) === setId) return true;
    return false;
  };
  const sets = [...bySet.entries()].filter(([setId, ids]) => ids.length >= minCards && !blocked(setId, ids)).map(([setId]) => setId).sort();
  if (sets.length === 0) return null;
  // A set Chris approved for the day wins (socialPlan.ts DayPlan.set), when it still qualifies.
  // Then the set already on the day's night-rendered 7am video (10-01: prices moved overnight, the pool changed size, the
  // hash landed on Neo Discovery and the sites posted it over a Noble Victories video). Then the hash.
  const pinned = [dayPlan(day).set, await renderedSet(day)].find((s) => s && sets.includes(s));
  // From RISER_SETS_FROM the hash runs over the sets that HAVE a riser among their five most valuable cards, when any
  // do (10-02: gains posts average 22 views, set posts 13, and that morning's Sun & Moon caption said "steady" four
  // times). Same test as the lead card below: a held price, an old price the guard believes, a real jump. With no such
  // set that day, every qualifying set is in the pool as before.
  const rises = (id: string) => {
    const s = series.get(id)!;
    if (s.held < HELD_DAYS || !s.fromOk || !s.fromSettled || s.stepJump) return false;
    const from = s.from ?? s.to;
    return from > 0 && Math.min(from, s.to) >= MOVER_MIN_PRICE && ((s.to - from) / from) * 100 >= JUMP_MIN_PCT;
  };
  const hot = riserSetsOn(day)
    ? sets.filter((id) => [...(bySet.get(id) ?? [])].sort((a, b) => settled(b) - settled(a) || a.localeCompare(b)).slice(0, minCards).some(rises))
    : [];
  const pool = hot.length > 0 ? hot : sets;
  const setId = pinned ?? pool[hashDay(day, `${game}:set`) % pool.length];
  const top = (bySet.get(setId) ?? []).sort((a, b) => settled(b) - settled(a) || a.localeCompare(b)).slice(0, minCards * 2);
  const cat = await catalogRows(game, top);
  const cards: Mover[] = [];
  for (const id of top) {
    const c = cat.get(id);
    if (!c) continue;
    const s = series.get(id)!;
    // No week claim when today's point has not held (`to` is then the median) or the price a week ago is not one the guard believes.
    const median = s.held < HELD_DAYS;
    const unsettled = median || !s.fromOk;
    const to = median ? s.median : s.to;
    const from = s.fromOk ? (s.from ?? to) : to;
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
  cards.forEach((c, i) => (c.rank = i + 1));
  // The eye-catching card leads (10-01: a video whose cover fell 3.8% got 41 views, one that rose 134% got 110): the
  // biggest up-move among these five, ties to the more valuable (the earlier one). Only a move the movers would print:
  // a held price, an old price the guard believes, both ends at the floor, no lone step out of a flat stretch. It leads
  // when it is a real jump (JUMP_MIN_PCT) or when the card that would lead on value FELL this week, so a cover is never
  // red while the set has a riser; a set that is flat or down, or only up a point or two, keeps today's order, and no gain
  // is invented for a card that did not make one.
  let lead = -1;
  if (leadFirst) {
    cards.forEach((c, i) => {
      const s = series.get(c.cardId)!;
      if (c.unsettled || !s.fromSettled || s.stepJump || c.pct < 1 || Math.min(c.from, c.to) < MOVER_MIN_PRICE) return;
      if (lead < 0 || Math.round(c.pct * 10) > Math.round(cards[lead].pct * 10)) lead = i;
    });
    const firstFell = !cards[0].unsettled && cards[0].pct <= -1;
    if (lead >= 0 && cards[lead].pct < JUMP_MIN_PCT && !firstFell) lead = -1;
  }
  const leadId = lead >= 0 ? cards[lead].cardId : undefined;
  if (lead > 0) cards.unshift(...cards.splice(lead, 1));
  return { setId, setName: cards[0].setName, cards, ...(leadId ? { leadId } : {}) };
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

/** The question block of a caption: after the card lines, before the sign-off (fitText drops it first when a site is tight). */
const qBlock = (question?: string): string[] => (question ? [question, ""] : []);

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
export function moversCaption(game: GameId, movers: Mover[], alsoScans = false, question = ""): string {
  const lines = movers.map((m) => `${m.name} (${m.setName} ${m.number}) ${money(m.from)} → ${money(m.to)}, ${pctLabel(m.pct)}`);
  return [
    `${GAME_LABEL[game]} price gains this week, from CardFlip's own price history.`,
    "",
    ...lines,
    "",
    ...qBlock(question),
    ...signOff(alsoScans ? [game] : null),
  ].join("\n");
}

/** The movers post in under 300 characters: name and % only. */
export function moversShortCaption(game: GameId, movers: Mover[], alsoScans = false, question = ""): string {
  return [
    `${GAME_LABEL[game]} price gains this week`,
    ...movers.map((m) => `${m.name} ${pctLabel(m.pct)}`),
    "",
    ...qBlock(question),
    shortSignOff(alsoScans ? [game] : null),
  ].join("\n");
}

function moverGames(movers: Mover[]): GameId[] {
  return POST_GAME_ORDER.filter((g) => movers.some((m) => m.game === g));
}

/** Caption for a mixed-game movers post (mixedMovers): each line says its game. */
export function mixedMoversCaption(movers: Mover[], question = ""): string {
  const games = moverGames(movers);
  const lines = movers.map((m) => `${POST_GAME_NAMES[m.game ?? "pokemon"]}: ${m.name} (${m.setName} ${m.number}) ${money(m.from)} → ${money(m.to)}, ${pctLabel(m.pct)}`);
  return [
    `The week's biggest price gains in ${listNames(games.map((g) => POST_GAME_NAMES[g]))}, from CardFlip's own price history.`,
    "",
    ...lines,
    "",
    ...qBlock(question),
    ...signOff(games),
  ].join("\n");
}

export function mixedMoversShortCaption(movers: Mover[], question = ""): string {
  const games = moverGames(movers);
  return [
    `${listNames(games.map((g) => POST_GAME_NAMES[g]))} price gains this week`,
    ...movers.map((m) => `${m.name} ${pctLabel(m.pct)}`),
    "",
    ...qBlock(question),
    shortSignOff(games),
  ].join("\n");
}

/** Caption for the price-drops post (evening slot): the week's biggest falls. */
export function dipsCaption(game: GameId, dips: Mover[], alsoScans = false, question = ""): string {
  const lines = dips.map((m) => `${m.name} (${m.setName} ${m.number}) ${money(m.from)} → ${money(m.to)}, ${pctLabel(m.pct)}`);
  return [
    `${GAME_LABEL[game]} price drops this week, from CardFlip's own price history.`,
    "",
    ...lines,
    "",
    ...qBlock(question),
    ...signOff(alsoScans ? [game] : null),
  ].join("\n");
}

export function dipsShortCaption(game: GameId, dips: Mover[], alsoScans = false, question = ""): string {
  return [`${GAME_LABEL[game]} price drops this week`, ...dips.map((m) => `${m.name} ${pctLabel(m.pct)}`), "", ...qBlock(question), shortSignOff(alsoScans ? [game] : null)].join("\n");
}

/** Caption for the all-games post (day plan morning "games"): what the scanner reads, then the card from each game in the picture. */
/** TCGplayer's Yu-Gi-Oh set names carry a print-run tag ("… (Worldwide English)") nobody says out loud. */
const cleanSet = (s: string) => s.replace(/\s*\(Worldwide English\)$/i, "");
const numberLabel = (n: string) => (/^[A-Z]/.test(n) ? n : `#${n}`);

/** The all-games post's title: with a jump in it the post is about the jumps. */
export function gamesTitle(leads: GameLead[]): string {
  const jumps = leads.filter(isJump).length;
  if (jumps === 0) return `One scanner, ${countWord(leads.length)} card games`;
  return jumps === leads.length ? "Biggest price jump in every game this week" : "Biggest price jumps this week";
}

/** One line of the jumps caption: "Pokémon: Umbreon ex (Prismatic Evolutions #161, Holo): $412, +34% this week"; a game with no jump says its price today. */
function jumpLine(l: GameLead): string {
  const v = l.variant ? variantLabel(l.variant) : "";
  const card = `${l.name} (${cleanSet(l.setName)} ${numberLabel(l.number)}${v ? `, ${v}` : ""})`;
  return `${POST_GAME_NAMES[l.game]}: ${card}: ${money(l.price)}${isJump(l) ? `, ${pctLabel(l.pct as number)} this week` : " today"}`;
}

function jumpsCaption(leads: GameLead[], question: string): string {
  const jumps = leads.filter(isJump);
  const rest = leads.filter((l) => !isJump(l));
  const intro =
    rest.length === 0
      ? "The biggest price jump in every game this week, from CardFlip's own price history."
      : `The biggest price jumps this week in ${listNames(jumps.map((l) => POST_GAME_NAMES[l.game]))}, and one card from ${listNames(rest.map((l) => POST_GAME_NAMES[l.game]))} at today's price, from CardFlip's own price history.`;
  return [intro, "", ...leads.map(jumpLine), "", ...qBlock(question), SIGN_OFF].join("\n");
}

function jumpsShortCaption(leads: GameLead[], question: string): string {
  const lines = leads.map((l) => `${POST_GAME_NAMES[l.game]}: ${l.name} ${isJump(l) ? pctLabel(l.pct as number) : money(l.price)}`);
  return [gamesTitle(leads), ...lines, "", ...qBlock(question), SIGN_OFF].join("\n");
}

export function gamesCaption(leads: GameLead[], question = ""): string {
  if (leads.some(isJump)) return jumpsCaption(leads, question);
  const names = listNames(leads.map((l) => POST_GAME_NAMES[l.game]));
  const setName = cleanSet;
  return [
    `One scanner, ${countWord(leads.length)} card games. CardFlip reads ${names} cards from a photo and shows what each one is worth today.`,
    "",
    "In the picture, one card from each game at today's market price:",
    ...leads.map((l) => `${l.name}, ${setName(l.setName)} ${numberLabel(l.number)}: ${money(l.price)}`),
    "",
    ...qBlock(question),
    SIGN_OFF,
  ].join("\n");
}

export function gamesShortCaption(leads: GameLead[], question = ""): string {
  if (leads.some(isJump)) return jumpsShortCaption(leads, question);
  return [`One scanner, ${countWord(leads.length)} card games: ${listNames(leads.map((l) => POST_GAME_NAMES[l.game]))}.`, "", ...qBlock(question), SIGN_OFF].join("\n");
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
export function setCaption(game: GameId, spot: SetSpotlight, alsoScans = false, question = ""): string {
  const lines = spot.cards.map((m) => {
    const v = variantLabel(m.variant);
    const week = m.unsettled ? "" : Math.abs(m.pct) >= 1 ? `, ${pctLabel(m.pct)} this week` : ", steady this week";
    return `${m.name} #${m.number}${v ? ` ${v}` : ""}: ${money(m.to)}${week}`;
  });
  return [`Five of the most valuable ${GAME_LABEL[game]} cards in ${spot.setName} right now, market price from CardFlip's own price history.`, "", ...lines, "", ...qBlock(question), ...signOff(alsoScans ? [game] : null)].join("\n");
}

export function setShortCaption(game: GameId, spot: SetSpotlight, alsoScans = false, question = ""): string {
  return [`${spot.setName}: five of the most valuable cards right now`, ...spot.cards.map((m) => `${m.name} #${m.number} ${money(m.to)}`), "", ...qBlock(question), shortSignOff(alsoScans ? [game] : null)].join("\n");
}

/** Hashtags for a single-game post: the game's own, or the "also scans" set on a plan day. */
function tagsFor(game: GameId, alsoScans: boolean): string[] {
  const out = alsoScans && game === "pokemon" ? [...PLAN_TAGS.pokemonAlsoScans] : [...GAME_TAGS[game]];
  // Filled to MAX_TAGS with the general ones (10-02: Instagram takes five and was getting three). Each site still cuts from the end to its own limit.
  for (const t of GENERAL_TAGS) if (!out.includes(t)) out.push(t);
  return out.slice(0, MAX_TAGS);
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
    // From JUMPS_FROM it is each game's biggest weekly jump (a game with none keeps its lead card); before, the lead cards.
    game === "pokemon" ? (jumpsOn(day) ? gameJumps(day) : gameLeads(day)) : Promise.resolve([] as GameLead[]),
  ]);
  const posts: SocialPost[] = [];
  if (leads.length >= 3) {
    const jumped = leads.filter((l) => isJump(l) && l.cardId);
    const q = questionFor("games", day);
    posts.push({
      id: `${game}-games-${day}`,
      kind: "games",
      game,
      day,
      title: gamesTitle(leads),
      caption: gamesCaption(leads, q),
      shortCaption: gamesShortCaption(leads, q),
      question: q,
      hashtags: gamesTags(leads.map((l) => l.game)),
      imagePath: `/api/social/image?kind=games&game=${game}&day=${day}`,
      cardIds: jumped.map((l) => l.cardId as string),
      ...(jumped.length ? { featured: featuredByGame(jumped.map((l) => ({ cardId: l.cardId as string, game: l.game }))) } : {}),
    });
  }
  if (mixed && movers.length >= 3) {
    const games = moverGames(movers);
    const q = questionFor("movers", day);
    posts.push({
      id: `${game}-movers-${day}`,
      kind: "movers",
      game,
      day,
      title: `${listNames(games.map((g) => POST_GAME_NAMES[g]))} movers of the week`,
      caption: mixedMoversCaption(movers, q),
      shortCaption: mixedMoversShortCaption(movers, q),
      question: q,
      hashtags: [...PLAN_TAGS.mixedMovers],
      imagePath: `/api/social/image?kind=movers&game=${game}&day=${day}`,
      cardIds: movers.map((m) => m.cardId),
      featured: featuredByGame(movers),
    });
  } else if (movers.length >= 3) {
    const q = questionFor("movers", day);
    posts.push({
      id: `${game}-movers-${day}`,
      kind: "movers",
      game,
      day,
      title: `${GAME_LABEL[game]} movers of the week`,
      caption: moversCaption(game, movers, also, q),
      shortCaption: moversShortCaption(game, movers, also, q),
      question: q,
      hashtags: tagsFor(game, also),
      imagePath: `/api/social/image?kind=movers&game=${game}&day=${day}`,
      cardIds: movers.map((m) => m.cardId),
    });
  }
  if (spot) {
    const q = questionFor("set", day, spot.setName);
    posts.push({
      id: `${game}-set-${day}`,
      kind: "set",
      game,
      day,
      title: `Set spotlight: ${spot.setName}`,
      caption: setCaption(game, spot, also, q),
      shortCaption: setShortCaption(game, spot, also, q),
      question: q,
      hashtags: tagsFor(game, also),
      imagePath: `/api/social/image?kind=set&game=${game}&day=${day}`,
      cardIds: spot.cards.map((m) => m.cardId),
    });
  }
  if (dips.length >= 3) {
    const q = questionFor("dips", day);
    posts.push({
      id: `${game}-dips-${day}`,
      kind: "dips",
      game,
      day,
      title: `${GAME_LABEL[game]} price drops this week`,
      caption: dipsCaption(game, dips, also, q),
      shortCaption: dipsShortCaption(game, dips, also, q),
      question: q,
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
