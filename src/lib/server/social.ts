import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@/lib/db";
import { addDays, decodePrices, todayUtc } from "@/lib/priceSeries";
import { PRICE_TRUST, REF_ALT_SOURCE, isVintage, lastPriced, priceTrust, stepJump } from "@/lib/server/priceTrust";
import { GATED_GAMES, gamePublic, getSetting, setSetting, type GatedGame } from "@/lib/server/settings";
import { tiktokKey } from "@/lib/socialTiktok";
import type { VideoCard } from "@/lib/socialVideo";
import type { GameId } from "@/lib/types";
import { ANGLE_KINDS, GENERAL_TAGS, MAX_TAGS, JUMP_MIN_PCT, MIXED_GAMES, MIXED_PER_GAME, PLAN_TAGS, POST_GAME_NAMES, POST_GAME_ORDER, angleGameOrder, countWord, dayPlan, freshJumpsOn, gamesTags, jumpsOn, listNames, otherGameNames, questionFor, riserSetsOn, type AngleKind } from "@/lib/socialPlan";

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
/** A band read (sleepers) wants three cards from the collectible end of $1–$5, not the whole band: the dearest this many (10-03, the band was 13k rows and 2.2 s). */
const MTG_BAND_CAP = 5000;
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

/**
 * "games" = every public game in one picture (a day-plan kind, lib/socialPlan.ts).
 * guess / thennow / versus / sleepers / top = the five content angles (10-03, ANGLE_KINDS there).
 */
export type PostKind = "movers" | "card" | "dips" | "set" | "games" | "guess" | "thennow" | "versus" | "sleepers" | "top";
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
  /** Then vs now: the day `from` was read (the first day of the card's history); the caption says its month. */
  thenDay?: string;
}

/** The sleepers band: cards priced from SLEEPER_MIN to under SLEEPER_MAX today, moved up at least SLEEPER_MIN_PCT this week. */
export const SLEEPER_MIN = 1;
export const SLEEPER_MAX = 5;
export const SLEEPER_MIN_PCT = 15;
/** Then vs now: a history at least this old, a believable rise (1.8x to 6x; a 20x on a promo is a bad old print), today at least THEN_MIN_NOW. */
export const THEN_MIN_DAYS = 90;
export const THEN_MIN_NOW = 20;
const THEN_BAND: [number, number] = [1.8, 6];

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
  /** An angle post in "mixed" mode: one card per public game (the cards carry their game; `game` is the draft loop's). */
  mixed?: boolean;
}

interface SeriesRow {
  card_id: string;
  variant: string;
  start_day: string;
  prices: string;
  /** Pokémon: the card's fresh Cardmarket 'average' series (EUR), null when it has none or it is stale. */
  cm_prices?: string | null;
  /** Pokémon: TCGdex's Cardmarket avg series (REF_ALT_SOURCE), fresh, or null. */
  alt_prices?: string | null;
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
const seriesScope = new AsyncLocalStorage<Map<string, Promise<FreshSeries>>>();

/**
 * Run `fn` with freshSeries memoized per (game, day, days, band): one drafts
 * build (ten kinds, five games) reads each pool once instead of once per
 * kind. Outside a scope every call reads the database, so a test that writes
 * a row and asks again sees it.
 */
export function withSeriesCache<T>(fn: () => Promise<T>): Promise<T> {
  return seriesScope.run(new Map(), fn);
}

function freshSeries(game: GameId, day: string, days: number, band?: [number, number]): Promise<FreshSeries> {
  const store = seriesScope.getStore();
  if (!store) return loadFreshSeries(game, day, days, band);
  const key = `${game}:${day}:${days}:${band ? band.join("-") : ""}`;
  let p = store.get(key);
  if (!p) {
    p = loadFreshSeries(game, day, days, band);
    store.set(key, p);
  }
  return p;
}

async function loadFreshSeries(game: GameId, day: string, days: number, band?: [number, number]): Promise<FreshSeries> {
  const since = new Date(Date.parse(day + "T00:00:00Z") - 3 * 86_400_000).toISOString().slice(0, 10);
  const cmSince = addDays(day, -PRICE_TRUST.refMaxAgeDays);
  // A price band (sleepers, 10-03: cards from $1 to under $5) replaces the pool floor: the floor exists so a $1.83 common
  // "up 69%" never headlines the gains, and the sleepers post is exactly the post about those cards, under the same guards.
  // Magic's band is read dearest first, so when it is over the cap the sample is the more collectible end of it.
  const [poolMin, poolMax] = band ?? [game === "mtg" ? MTG_POOL_MIN_USD : POOL_MIN_USD, Infinity];
  const rows = (
    game === "mtg"
      ? await db
          .prepare(
            `SELECT p.card_id, p.variant, p.start_day, p.prices, m.price_eur FROM mtg_cards m
              JOIN price_series p ON p.card_id = m.id AND p.game = 'mtg' AND p.source = 'tcgplayer' AND p.currency = 'USD' AND p.updated_day >= ?
              WHERE p.variant = 'nonfoil' AND m.price_usd >= ?${band ? " AND m.price_usd < ? ORDER BY m.price_usd DESC" : ""}
              LIMIT ${band ? MTG_BAND_CAP : MTG_POOL_CAP}`,
          )
          .all(...(band ? [since, poolMin, poolMax] : [since, poolMin]))
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
            `SELECT p.card_id, p.variant, p.start_day, p.prices, c.prices AS cm_prices, t.prices AS alt_prices, e.set_release_date AS released
               FROM price_series p
               JOIN en_cards e ON e.id = p.card_id
               LEFT JOIN price_series c ON c.card_id = p.card_id AND c.variant = 'average' AND c.source = 'cardmarket' AND c.updated_day >= ?
               LEFT JOIN price_series t ON t.card_id = p.card_id AND t.variant = 'average' AND t.source = '${REF_ALT_SOURCE}' AND t.updated_day >= ?
              WHERE p.game = ? AND p.currency = 'USD' AND p.source = 'tcgplayer' AND p.updated_day >= ?
                AND p.card_id IN (
                  SELECT card_id FROM price_series
                   WHERE game = ? AND currency = 'USD' AND source = 'tcgplayer' AND updated_day >= ?
                     AND MAX(COALESCE(json_extract(prices, '$[#-1]'), 0), COALESCE(json_extract(prices, '$[#-2]'), 0),
                             COALESCE(json_extract(prices, '$[#-${days + 1}]'), 0)) >= ?${band ? " AND COALESCE(json_extract(prices, '$[#-1]'), json_extract(prices, '$[#-2]'), 0) < ?" : ""})
              LIMIT ${ROW_CAP}`,
          )
          .all(...(band ? [cmSince, cmSince, game, since, game, since, poolMin, poolMax] : [cmSince, cmSince, game, since, game, since, poolMin]))
  ) as unknown as SeriesRow[];
  if (!band && rows.length >= (game === "mtg" ? MTG_POOL_CAP : ROW_CAP)) console.warn(`social: ${game} series pool hit its cap (${rows.length}); posts may miss cards`);
  // One entry per card: its series (so the preferred variant speaks for it and the rest are its siblings) and the second-source price.
  const cards = new Map<string, { series: { variant: string; prices: (number | null)[]; todayIdx: number; to: number }[]; refEur: number | null; refAlt: number | null; refPrices: (number | null)[] | null; released: string }>();
  for (const r of rows) {
    const prices = decodePrices(r.prices);
    const todayIdx = dayDiff(r.start_day, day);
    const to = priceAt(prices, todayIdx);
    if (to == null) continue;
    let card = cards.get(r.card_id);
    if (!card) {
      const refEur = game === "mtg" ? (r.price_eur ?? null) : r.cm_prices ? lastPriced(decodePrices(r.cm_prices)) : null;
      cards.set(r.card_id, (card = { series: [], refEur, refAlt: game !== "mtg" && r.alt_prices ? lastPriced(decodePrices(r.alt_prices)) : null, refPrices: game !== "mtg" && r.cm_prices ? decodePrices(r.cm_prices) : null, released: r.released ?? "" }));
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
      refAltEur: card.refAlt,
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
        refAltEur: card.refAlt,
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
      // A dip being unwound (Lugia 1st Edition, 10-03: $1,085 for months, $164.80 for five days, $1,135 since; the movers
      // read it as +589%): the old price sits well off the level that held before it, and today is back at that
      // level (1.5x or more, see below). The mirror of the spike rule: the stretch at `from` is the blip, not the move. Looks back at most 45 days.
      if (fromSettled) {
        let i = fromIdx;
        let prior: number | null = null;
        for (; i >= Math.max(0, fromIdx - 45); i--) {
          const v = priceAt(prices, i, CARRY_DAYS);
          if (v != null && Math.abs(v - from) / from > 0.15) { prior = v; break; }
        }
        // 1.5x, not 2x (10-06): Tyranitar Aquapolis $111.63 → $56.09 for five days → $113.30 is 1.99x and read as +102%.
        if (prior != null && Math.abs(to - prior) / prior <= 0.15 && Math.max(from, prior) / Math.min(from, prior) >= 1.5) fromSettled = false;
      }
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
  { days = MOVER_DAYS, limit = MOVER_LIMIT, minPrice = MOVER_MIN_PRICE, direction = "both" as "both" | "up" | "down", exclude = new Set<string>(), band = undefined as [number, number] | undefined } = {},
): Promise<Mover[]> {
  const { cards: series } = await freshSeries(game, day, days, band);
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

export type FeaturedKind = "movers" | "dips" | "jumps" | AngleKind;

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

// ---- The five angles (10-03, docs/SOCIAL-ANGLES-PLAN.md) --------------------------------------------------------

/**
 * "Most valuable" runs only for the games with a second price source to
 * referee the dearest tail (Pokémon: Cardmarket; Magic: Scryfall's EUR), the
 * guard freshSeries applies. The dearest tcg_cards rows of Yu-Gi-Oh are
 * TCGplayer placeholders (10-03, the first render: "Genex Ally Axel $213,589",
 * "Bujingi Crane $199,379") and nothing vouches for Lorcana's or One Piece's
 * either, so those games draw guess and head to head from their price-guarded
 * stage picks ($15–$300) and sit this angle out until they have a referee.
 */
const TOP_GAMES: GameId[] = ["pokemon", "mtg"];

/** POST_GAME_ORDER minus any gated game whose public switch is off (the same gate gameLeads applies). */
async function publicGames(): Promise<GameId[]> {
  const out: GameId[] = [];
  for (const g of POST_GAME_ORDER) {
    if ((GATED_GAMES as readonly string[]).includes(g) && !(await gamePublic(g as GatedGame))) continue;
    out.push(g);
  }
  return out;
}

/** "Charizard ex (Special Illustration Rare)" and "Charizard ex" are one name on a dearest-five list. */
const baseName = (name: string) => displayName(name).replace(/\s*\(.*$/, "").toLowerCase();
const nonNull = <T,>(v: T | null | undefined): v is T => v != null;
const medianOf = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

/**
 * A Mover from a fresh series and its catalog row, priced the way the set
 * spotlight prices a card: today's point when it held HELD_DAYS days, else the
 * week's median; the week claimed only when both ends are prices the movers
 * would print (held, the old price believed and settled, no lone step).
 */
function moverOf(game: GameId, cardId: string, c: CatalogRow, s: FreshCard): Mover {
  const median = s.held < HELD_DAYS;
  const to = median ? s.median : s.to;
  const unsettled = median || s.from == null || !s.fromOk || !s.fromSettled || Boolean(s.stepJump);
  const from = unsettled ? to : (s.from as number);
  return { cardId, name: displayName(c.name), setName: c.set_name, number: c.number, imageUrl: postArtUrl(game, c.image_url), variant: s.variant, from, to, pct: !unsettled && from > 0 ? ((to - from) / from) * 100 : 0, unsettled };
}

/**
 * A TCG game's scanner-stage picks (popular cards, $15–$300, price-guarded;
 * One Piece its checked-clean lead only, as gameLeads) as Movers, each with
 * its tcg_cards id so the no-repeat list and a frozen video row can name it.
 */
async function stageMovers(game: GameId): Promise<Mover[]> {
  const { getGameStageCards } = await import("@/lib/server/stageCards");
  const cards = (await getGameStageCards(game)).cards.filter((c) => c.imageUrl && c.price != null && c.price > 0);
  const pool = game === "onepiece" ? cards.filter((c) => c.lead) : cards;
  const out: Mover[] = [];
  for (const c of pool) {
    const row = (await db.prepare("SELECT id FROM tcg_cards WHERE game = ? AND set_name = ? AND collector_number = ? LIMIT 1").get(game, c.setName, c.number)) as { id: string } | undefined;
    out.push({ cardId: row?.id ?? `${game}:${c.setName}:${c.number}`, name: displayName(c.name), setName: cleanSet(c.setName), number: c.number, imageUrl: c.imageUrl, variant: "", from: c.price as number, to: c.price as number, pct: 0, unsettled: true });
  }
  return out;
}

/**
 * Most valuable (angle "top"): the dearest `limit` cards a game prices today,
 * one per name, dearest first: settled, guard-passed prices (freshSeries), so a
 * one-day print is never "the most valuable". A card the guard could not vouch
 * for is simply not on the list, which is why the caption says "five of the
 * most valuable", never "the five most valuable". TOP_GAMES only.
 */
export async function topByPrice(game: GameId, day = todayUtc(), limit = 5): Promise<Mover[]> {
  const out: Mover[] = [];
  if (!TOP_GAMES.includes(game)) return out;
  const seen = new Set<string>();
  const { cards: series } = await freshSeries(game, day, MOVER_DAYS);
  const ranked = [...series.entries()].filter(([, s]) => s.held >= HELD_DAYS).sort((a, b) => b[1].to - a[1].to || a[0].localeCompare(b[0])).slice(0, limit * 4);
  const cat = await catalogRows(game, ranked.map(([id]) => id));
  for (const [id, s] of ranked) {
    const c = cat.get(id);
    if (!c || !c.image_url || seen.has(baseName(c.name))) continue;
    seen.add(baseName(c.name));
    out.push(moverOf(game, id, c, s));
    if (out.length >= limit) break;
  }
  if (game === "mtg") return eurOnlyTop(out, limit, seen);
  return out;
}

/**
 * Magic's dearest cards often have NO TCGplayer price at all (10-03: Black
 * Lotus, every print, carries only Cardmarket's EUR average), so the list of
 * "most valuable" was Time Walk down. Those rows join at their EUR price in
 * dollars at the day's rate (fx.ts, Frankfurter, cached per day), with no week
 * claimed (unsettled). Only cards above the fifth USD card are fetched, and
 * the rate only when there is one; a day with no rate leaves the list as it was.
 */
async function eurOnlyTop(usd: Mover[], limit: number, seen: Set<string>): Promise<Mover[]> {
  const floorUsd = usd.length >= limit ? usd[usd.length - 1].to : 0;
  // A generous EUR floor (a euro has not bought less than half a dollar): the exact cut is made after the rate is known.
  const rows = (await db
    .prepare(`SELECT id, name, set_name, collector_number AS number, image_url, price_eur FROM mtg_cards WHERE price_usd IS NULL AND price_eur IS NOT NULL AND price_eur > ? AND image_url != '' AND lang = 'en' ORDER BY price_eur DESC LIMIT ?`)
    .all(floorUsd / 2, limit * 4)) as unknown as (CatalogRow & { price_eur: number })[];
  if (rows.length === 0) return usd;
  const { usdPerEur } = await import("@/lib/server/fx");
  const rate = await usdPerEur().catch(() => null);
  if (!rate) return usd;
  const out = [...usd];
  for (const r of rows) {
    if (seen.has(baseName(r.name))) continue;
    const to = Math.round(r.price_eur * rate * 100) / 100;
    if (to <= floorUsd) continue;
    seen.add(baseName(r.name));
    out.push({ cardId: r.id, name: displayName(r.name), setName: r.set_name, number: r.number, imageUrl: postArtUrl("mtg", r.image_url), variant: "nonfoil", from: to, to, pct: 0, unsettled: true });
  }
  return out.sort((a, b) => b.to - a.to || a.cardId.localeCompare(b.cardId)).slice(0, limit);
}

/**
 * Sleepers under $5 (angle "sleepers"): the cards priced from SLEEPER_MIN to
 * under SLEEPER_MAX today with the biggest weekly gains (SLEEPER_MIN_PCT or
 * more), under every guard the movers apply (a held price, a believed and
 * settled old price, no lone step). Their own pool band: the movers' pool
 * floors at $5 on purpose, and this is the post about the cards under it.
 */
export async function sleepers(game: GameId, day = todayUtc(), { limit = 3, exclude = new Set<string>() } = {}): Promise<Mover[]> {
  if (!MOVER_GAMES.includes(game)) return [];
  const list = await topMovers(game, day, { direction: "up", limit: limit * 10, minPrice: SLEEPER_MIN, exclude, band: [SLEEPER_MIN, SLEEPER_MAX] });
  return list.filter((m) => m.to < SLEEPER_MAX && m.pct >= SLEEPER_MIN_PCT && m.imageUrl).slice(0, limit);
}

/**
 * Then vs now (angle "thennow"): the card that rose the most from the start of
 * its history (THEN_MIN_DAYS or more ago) to today, a rise a collector
 * believes: the series start (median of its first ten points, $3 or more), a
 * middle that sits between the ends (a rise that happened, not a spike or an
 * old typo), a flat last five days, today settled and guard-passed, the
 * Cardmarket referee within 3x (the sample's Rillaboom $6.35 → $148 was junk
 * without it), and THEN_BAND (1.8x–6x). `from` is the then price, `thenDay`
 * the day it was read.
 */
export async function thenNow(game: GameId, day = todayUtc(), { exclude = new Set<string>() } = {}): Promise<Mover | null> {
  if (!MOVER_GAMES.includes(game)) return null;
  const { cards: series } = await freshSeries(game, day, MOVER_DAYS);
  const startBy = addDays(day, -THEN_MIN_DAYS);
  const fresh = addDays(day, -3);
  type Row = { card_id: string; variant: string; start_day: string; prices: string; ref: number | null; ref_prices: string | null };
  const rows = (
    game === "mtg"
      ? await db
          .prepare(
            `SELECT p.card_id, p.variant, p.start_day, p.prices, m.price_eur AS ref, NULL AS ref_prices FROM mtg_cards m
              JOIN price_series p ON p.card_id = m.id AND p.game = 'mtg' AND p.source = 'tcgplayer' AND p.currency = 'USD'
              WHERE p.variant = 'nonfoil' AND p.start_day <= ? AND p.updated_day >= ? AND m.price_usd >= ?`,
          )
          .all(startBy, fresh, THEN_MIN_NOW)
      : await db
          .prepare(
            `SELECT p.card_id, p.variant, p.start_day, p.prices, NULL AS ref, c.prices AS ref_prices FROM price_series p
              JOIN en_cards e ON e.id = p.card_id
              JOIN price_series c ON c.card_id = p.card_id AND c.variant = 'average' AND c.source = 'cardmarket' AND c.updated_day >= ?
              WHERE p.game = ? AND p.source = 'tcgplayer' AND p.currency = 'USD' AND p.start_day <= ? AND p.updated_day >= ?
                AND COALESCE(json_extract(p.prices, '$[#-1]'), json_extract(p.prices, '$[#-2]'), 0) >= ?`,
          )
          .all(addDays(day, -PRICE_TRUST.refMaxAgeDays), game, startBy, fresh, THEN_MIN_NOW)
  ) as unknown as Row[];
  let best: { ratio: number; cardId: string; then: number; now: number; variant: string; thenDay: string } | null = null;
  for (const r of rows) {
    const s = series.get(r.card_id);
    if (!s || s.variant !== r.variant || s.held < HELD_DAYS || exclude.has(r.card_id)) continue;
    const ref = game === "mtg" ? r.ref : r.ref_prices ? lastPriced(decodePrices(r.ref_prices)) : null;
    const now = s.to;
    if (ref == null || ref < 1 || now < THEN_MIN_NOW || now / (ref * 1.1) > 3) continue;
    const upTo = decodePrices(r.prices).slice(0, dayDiff(r.start_day, day) + 1);
    const early = upTo.slice(0, 10).filter(nonNull);
    if (early.length < 3) continue;
    const then = medianOf(early);
    if (then < 3) continue;
    const late = upTo.slice(-5).filter(nonNull);
    if (late.length < 5 || Math.max(...late) / Math.min(...late) > 1.12) continue;
    const half = Math.floor(upTo.length / 2);
    const mid = upTo.slice(Math.max(0, half - 5), half + 5).filter(nonNull);
    if (mid.length === 0) continue;
    const m = medianOf(mid);
    if (m < then * 0.9 || m > now * 1.1) continue;
    const ratio = now / then;
    if (ratio < THEN_BAND[0] || ratio > THEN_BAND[1]) continue;
    if (!best || ratio > best.ratio || (ratio === best.ratio && r.card_id < best.cardId)) best = { ratio, cardId: r.card_id, then, now, variant: r.variant, thenDay: r.start_day };
  }
  if (!best) return null;
  const c = (await catalogRows(game, [best.cardId])).get(best.cardId);
  if (!c || !c.image_url) return null;
  return {
    cardId: best.cardId,
    name: displayName(c.name),
    setName: c.set_name,
    number: c.number,
    imageUrl: postArtUrl(game, c.image_url),
    variant: best.variant,
    from: best.then,
    to: best.now,
    pct: ((best.now - best.then) / best.then) * 100,
    thenDay: best.thenDay,
  };
}

/** Head to head: two cards of ONE game. `winner` is the index of the better week (byPrice: the dearer card). */
export interface Pair {
  a: Mover;
  b: Mover;
  winner: 0 | 1;
  /** Both cards come from this set (today's set spotlight). */
  setName?: string;
  /** TCG games: no week to compare, the question is which is worth more. */
  byPrice: boolean;
}

/** A head to head needs a story: one of the two moved this week, and their weeks differ by at least this many points. */
const VERSUS_MIN_GAP_PCT = 2;

/** The two cards of a pool priced closest to each other whose weeks tell a story (one moved, the gap is real), so there is always a winner. */
function closestPair(pool: Mover[]): [Mover, Mover] | null {
  let best: [Mover, Mover] | null = null;
  let gap = Infinity;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const g = Math.abs(Math.log(pool[i].to / pool[j].to));
      const moved = Math.abs(pool[i].pct) >= 1 || Math.abs(pool[j].pct) >= 1;
      if (g < gap && moved && Math.abs(pool[i].pct - pool[j].pct) >= VERSUS_MIN_GAP_PCT) {
        gap = g;
        best = [pool[i], pool[j]];
      }
    }
  }
  return best;
}

/**
 * Head to head (angle "versus"; Chris 10-03: never cards of different games).
 * History games: two settled cards of today's set spotlight (Pokémon) or of
 * the week's movers, priced closest to each other, the better week wins.
 * TCG games: two popular stage cards at least 10% apart, rotating by day, the
 * dearer wins ("Which is worth more?").
 */
export async function pair(game: GameId, day = todayUtc(), { exclude = new Set<string>() } = {}): Promise<Pair | null> {
  if (MOVER_GAMES.includes(game)) {
    const spot = game === "pokemon" ? await setSpotlight(game, day) : null;
    const fromSet = spot ? spot.cards.filter((c) => !c.unsettled && !exclude.has(c.cardId)) : [];
    const pool = fromSet.length >= 2 ? fromSet : (await topMovers(game, day, { limit: 10, exclude })).filter((m) => m.imageUrl);
    const picked = closestPair(pool);
    if (!picked) return null;
    const [a, b] = picked;
    return { a, b, winner: a.pct >= b.pct ? 0 : 1, byPrice: false, ...(fromSet.length >= 2 ? { setName: spot!.setName } : {}) };
  }
  const pool = (await stageMovers(game)).filter((m) => !exclude.has(m.cardId));
  if (pool.length < 2) return null;
  const a = pool[hashDay(day, `${game}:versus`) % pool.length];
  const b = pool
    .filter((m) => m !== a && Math.abs(Math.log(m.to / a.to)) >= 0.095)
    .sort((x, y) => Math.abs(Math.log(x.to / a.to)) - Math.abs(Math.log(y.to / a.to)) || x.cardId.localeCompare(y.cardId))[0];
  if (!b) return null;
  return { a, b, winner: a.to >= b.to ? 0 : 1, byPrice: true };
}

/**
 * The Pair a registered head-to-head video froze (lib/socialVideo.ts: its two
 * cards in order and the winner it crowned), rebuilt the way pair() would read
 * them: a history game compares the week, a TCG game the price; both cards
 * from one set name it. A row without a winner (older) recomputes it.
 */
export function pairFromCards(game: GameId, cards: Pick<Mover, "cardId" | "name" | "setName" | "number" | "variant" | "from" | "to" | "pct" | "unsettled" | "game">[], winner?: 0 | 1): Pair | null {
  if (cards.length < 2) return null;
  const [a, b] = cards.slice(0, 2).map((c) => ({ imageUrl: "", ...c, unsettled: Boolean(c.unsettled) }));
  const byPrice = !MOVER_GAMES.includes(game);
  const w = winner ?? (byPrice ? (a.to >= b.to ? 0 : 1) : a.pct >= b.pct ? 0 : 1);
  return { a, b, winner: w, byPrice, ...(a.setName && a.setName === b.setName ? { setName: a.setName } : {}) };
}

/**
 * Guess the price (angle "guess"): one card worth guessing. History games:
 * the week's biggest riser that no gains post shows (last week's, or today's
 * 1pm), so the reveal is a move; with none, the card of the day. TCG games: a
 * popular stage card, rotating by day.
 */
export async function guessCard(game: GameId, day = todayUtc(), { exclude = new Set<string>() } = {}): Promise<Mover | null> {
  if (MOVER_GAMES.includes(game)) {
    const skip = new Set([...exclude, ...(await recentlyFeatured(game, "movers", day)), ...(await middayGainers(game, day))]);
    const risers = await topMovers(game, day, { direction: "up", limit: 5, exclude: skip });
    const m = risers.find((r) => r.pct >= JUMP_MIN_PCT && r.to >= COTD_MIN_PRICE && r.imageUrl);
    if (m) return m;
    const c = await cardOfTheDay(game, day);
    return c && !exclude.has(c.cardId) && c.imageUrl ? c : null;
  }
  const pool = (await stageMovers(game)).filter((m) => !exclude.has(m.cardId));
  return pool.length ? pool[hashDay(day, `${game}:guess`) % pool.length] : null;
}

/** "Mixed" = one card per public game in one post (guess, top) or the two history games' sleepers interleaved; null unless at least two games take part. */
async function mixedAngle(kind: AngleKind, day: string, games: GameId[]): Promise<Mover[] | null> {
  if (kind === "top") {
    const lists = await Promise.all(games.filter((g) => TOP_GAMES.includes(g)).map(async (g) => (await topByPrice(g, day, 1)).map((m) => ({ ...m, game: g }))));
    const cards = lists.flat().sort((a, b) => b.to - a.to || a.cardId.localeCompare(b.cardId));
    return cards.length >= 3 ? cards : null;
  }
  if (kind === "guess") {
    const cards = (
      await Promise.all(
        games.map(async (g) => {
          const m = await guessCard(g, day, { exclude: await recentlyFeatured(g, "guess", day) });
          return m ? [{ ...m, game: g }] : [];
        }),
      )
    ).flat();
    return cards.length >= 3 ? cards : null;
  }
  if (kind === "sleepers") {
    const lists = await Promise.all(MOVER_GAMES.filter((g) => games.includes(g)).map(async (g) => (await sleepers(g, day, { limit: 2, exclude: await recentlyFeatured(g, "sleepers", day) })).map((m) => ({ ...m, game: g }))));
    if (lists.filter((l) => l.length > 0).length < 2) return null;
    const out: Mover[] = [];
    for (let i = 0; i < 2; i++) for (const l of lists) if (l[i]) out.push(l[i]);
    return out.slice(0, 3);
  }
  return null;
}

/** An angle's cards for the day: the game the rotation picked, or the next one with something to say. */
export interface AngleData {
  kind: AngleKind;
  /** The game the post is about; a mixed post is filed under Pokémon (the draft loop's game) and its cards carry their own. */
  game: GameId;
  mixed: boolean;
  cards: Mover[];
  pair?: Pair;
}

/**
 * The day's data for one angle (lib/socialPlan.ts angleGameOrder: the cycle's
 * game first, then the rest), the first game that is public and has the data,
 * each under its own no-repeat list. null = nothing to post for this angle today.
 */
export async function angleData(kind: AngleKind, day = todayUtc()): Promise<AngleData | null> {
  const games = await publicGames();
  for (const g of angleGameOrder(kind, day)) {
    if (g === "mixed") {
      const cards = await mixedAngle(kind, day, games);
      if (cards) return { kind, game: "pokemon", mixed: true, cards };
      continue;
    }
    if (!games.includes(g)) continue;
    const exclude = await recentlyFeatured(g, kind, day);
    if (kind === "versus") {
      const p = await pair(g, day, { exclude });
      if (p) return { kind, game: g, mixed: false, cards: [p.a, p.b], pair: p };
      continue;
    }
    const cards =
      kind === "top" ? await topByPrice(g, day) : kind === "sleepers" ? await sleepers(g, day, { exclude }) : kind === "thennow" ? [await thenNow(g, day, { exclude })].filter(nonNull) : [await guessCard(g, day, { exclude })].filter(nonNull);
    if (cards.length >= (kind === "top" ? 5 : kind === "sleepers" ? 3 : 1)) return { kind, game: g, mixed: false, cards };
  }
  return null;
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

// ---- Angle captions (the same voice: plain, no exclamation marks, the question block, cardflip.io last) ------------

/** "Umbreon ex (Prismatic Evolutions #161, Holo)". */
function cardRef(m: Mover): string {
  const v = variantLabel(m.variant);
  return `${m.name} (${cleanSet(m.setName)} ${numberLabel(m.number)}${v ? `, ${v}` : ""})`;
}
/** ", +34% this week" / ", steady this week" / "" when no week is claimed (unsettled, or a TCG game with no history yet). */
function weekNote(m: Mover): string {
  return m.unsettled ? "" : Math.abs(m.pct) >= 1 ? `, ${pctLabel(m.pct)} this week` : ", steady this week";
}
/** The month a then-vs-now card's old price was read ("May"); "then" when the row carries no day. */
export function thenMonth(m: Pick<Mover, "thenDay">): string {
  return m.thenDay && /^\d{4}-\d{2}-\d{2}$/.test(m.thenDay) ? new Date(`${m.thenDay}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" }) : "then";
}
const gameName = (m: Mover, game: GameId) => POST_GAME_NAMES[m.game ?? game];

export function guessTitle(cards: Mover[]): string {
  return cards.length > 1 ? "What's it worth? One card from each game" : `What's it worth? ${cards[0].name}`;
}
export function guessCaption(game: GameId, cards: Mover[], question = ""): string {
  if (cards.length > 1) {
    return ["What's it worth? One card from each game, market price today:", "", ...cards.map((m) => `${gameName(m, game)}: ${cardRef(m)}: ${money(m.to)}${weekNote(m)}`), "", ...qBlock(question), SIGN_OFF].join("\n");
  }
  const m = cards[0];
  return [`What's it worth? ${POST_GAME_NAMES[game]}: ${cardRef(m)}.`, "", `Market price ${money(m.to)} today${weekNote(m)}, from CardFlip's own price history.`, "", ...qBlock(question), SIGN_OFF].join("\n");
}
export function guessShortCaption(game: GameId, cards: Mover[], question = ""): string {
  const lines = cards.length > 1 ? cards.map((m) => `${gameName(m, game)}: ${m.name} ${money(m.to)}`) : [`${cards[0].name}, ${cleanSet(cards[0].setName)} ${numberLabel(cards[0].number)}`, `Market price ${money(cards[0].to)} today`];
  return [cards.length > 1 ? "What's it worth? One card from each game" : "What's it worth?", ...lines, "", ...qBlock(question), SIGN_OFF].join("\n");
}

export function thenNowCaption(game: GameId, m: Mover, question = ""): string {
  const month = thenMonth(m);
  return [`${POST_GAME_NAMES[game]} then vs now: ${cardRef(m)}.`, "", `${month}: ${money(m.from)}. Today: ${money(m.to)}, ${pctLabel(m.pct)} since ${month}, from CardFlip's own price history.`, "", ...qBlock(question), SIGN_OFF].join("\n");
}
export function thenNowShortCaption(game: GameId, m: Mover, question = ""): string {
  const month = thenMonth(m);
  return [`Then vs now: ${m.name}`, `${month} ${money(m.from)} → today ${money(m.to)}, ${pctLabel(m.pct)}`, "", ...qBlock(question), SIGN_OFF].join("\n");
}

/** "Charizard climbed 7.6% this week, Emolga held at $87.03." (Chris 10-03: "stood still" read weird); by price: "Elsa is worth more today: $61.00 to $55.25." */
export function versusVerdict(p: Pair): string {
  const [w, l] = p.winner === 0 ? [p.a, p.b] : [p.b, p.a];
  if (p.byPrice) return `${w.name} is worth more today: ${money(w.to)} to ${money(l.to)}.`;
  const did = (c: Mover) => (Math.abs(c.pct) < 1 ? `held at ${money(c.to)}` : `${c.pct > 0 ? "climbed" : "slipped"} ${Math.abs(c.pct).toFixed(1)}%`);
  return `${w.name} ${did(w)} this week, ${l.name} ${did(l)}.`;
}
export function versusTitle(p: Pair): string {
  return `Head to head: ${p.a.name} vs ${p.b.name}`;
}
export function versusCaption(game: GameId, p: Pair, question = ""): string {
  const intro = p.byPrice
    ? `${POST_GAME_NAMES[game]} head to head: ${cardRef(p.a)} vs ${cardRef(p.b)}. Which is worth more?`
    : `${POST_GAME_NAMES[game]} head to head${p.setName ? ` in ${p.setName}` : ""}: ${cardRef(p.a)} at ${money(p.a.to)} vs ${cardRef(p.b)} at ${money(p.b.to)}. Which one moved this week?`;
  return [intro, "", `${versusVerdict(p)} ${p.byPrice ? "Market price from CardFlip." : "From CardFlip's own price history."}`, "", ...qBlock(question), SIGN_OFF].join("\n");
}
export function versusShortCaption(game: GameId, p: Pair, question = ""): string {
  return [`${POST_GAME_NAMES[game]} head to head: ${p.a.name} vs ${p.b.name}`, versusVerdict(p), "", ...qBlock(question), SIGN_OFF].join("\n");
}

/** "Pokémon" for a single-game list, "Pokémon and Magic" for a mixed one. */
function listWho(game: GameId, cards: Mover[]): string {
  const games = moverGames(cards);
  return games.length ? listNames(games.map((g) => POST_GAME_NAMES[g])) : POST_GAME_NAMES[game];
}
export function sleepersTitle(game: GameId, cards: Mover[]): string {
  return `${listWho(game, cards)} sleepers under $5`;
}
export function sleepersCaption(game: GameId, cards: Mover[], question = ""): string {
  const mixed = moverGames(cards).length > 0;
  return [
    `${listWho(game, cards)} cards under $5 moving the most this week, from CardFlip's own price history.`,
    "",
    ...cards.map((m) => `${mixed ? `${gameName(m, game)}: ` : ""}${cardRef(m)} ${money(m.from)} → ${money(m.to)}, ${pctLabel(m.pct)}`),
    "",
    ...qBlock(question),
    SIGN_OFF,
  ].join("\n");
}
export function sleepersShortCaption(game: GameId, cards: Mover[], question = ""): string {
  return [sleepersTitle(game, cards), ...cards.map((m) => `${m.name} ${money(m.to)}, ${pctLabel(m.pct)}`), "", ...qBlock(question), SIGN_OFF].join("\n");
}

export function topTitle(game: GameId, cards: Mover[]): string {
  return moverGames(cards).length ? "The most valuable card in each game" : `Most valuable ${POST_GAME_NAMES[game]} cards right now`;
}
export function topCaption(game: GameId, cards: Mover[], question = ""): string {
  const games = moverGames(cards);
  if (games.length) {
    return [`The most valuable card in each game priced on CardFlip today: ${listNames(games.map((g) => POST_GAME_NAMES[g]))}.`, "", ...cards.map((m) => `${gameName(m, game)}: ${cardRef(m)}: ${money(m.to)}${weekNote(m)}`), "", ...qBlock(question), SIGN_OFF].join("\n");
  }
  return [`Five of the most valuable ${POST_GAME_NAMES[game]} cards priced on CardFlip today, across every set.`, "", ...cards.map((m) => `${cardRef(m)}: ${money(m.to)}${weekNote(m)}`), "", ...qBlock(question), SIGN_OFF].join("\n");
}
export function topShortCaption(game: GameId, cards: Mover[], question = ""): string {
  const mixed = moverGames(cards).length > 0;
  return [mixed ? "The most valuable card in each game" : `Five of the most valuable ${POST_GAME_NAMES[game]} cards today, across every set`, ...cards.map((m) => `${mixed ? `${gameName(m, game)}: ` : ""}${m.name} ${money(m.to)}`), "", ...qBlock(question), SIGN_OFF].join("\n");
}

/** One angle's draft (socialDrafts): the kind's caption pair, its own tags (a mixed post tags every game it shows), the cards for the no-repeat list. */
export function angleDraft(a: AngleData, day: string): SocialPost {
  const { kind, game, cards } = a;
  const q = questionFor(kind, day);
  const games = a.mixed ? moverGames(cards) : [];
  const text =
    kind === "guess"
      ? { title: guessTitle(cards), caption: guessCaption(game, cards, q), shortCaption: guessShortCaption(game, cards, q) }
      : kind === "thennow"
        ? { title: `Then vs now: ${cards[0].name}`, caption: thenNowCaption(game, cards[0], q), shortCaption: thenNowShortCaption(game, cards[0], q) }
        : kind === "versus"
          ? { title: versusTitle(a.pair as Pair), caption: versusCaption(game, a.pair as Pair, q), shortCaption: versusShortCaption(game, a.pair as Pair, q) }
          : kind === "sleepers"
            ? { title: sleepersTitle(game, cards), caption: sleepersCaption(game, cards, q), shortCaption: sleepersShortCaption(game, cards, q) }
            : { title: topTitle(game, cards), caption: topCaption(game, cards, q), shortCaption: topShortCaption(game, cards, q) };
  return {
    id: `${game}-${kind}-${day}`,
    kind,
    game,
    day,
    ...text,
    question: q,
    hashtags: a.mixed ? gamesTags(games) : tagsFor(game, false),
    imagePath: `/api/social/image?kind=${kind}&game=${game}&day=${day}`,
    cardIds: cards.map((m) => m.cardId),
    ...(a.mixed ? { mixed: true, featured: featuredByGame(cards) } : {}),
  };
}

/** Hashtags for a single-game post: the game's own, or the "also scans" set on a plan day. */
function tagsFor(game: GameId, alsoScans: boolean): string[] {
  const out = alsoScans && game === "pokemon" ? [...PLAN_TAGS.pokemonAlsoScans] : [...GAME_TAGS[game]];
  // Filled to MAX_TAGS with the general ones (10-02: Instagram takes five and was getting three). Each site still cuts from the end to its own limit.
  for (const t of GENERAL_TAGS) if (!out.includes(t)) out.push(t);
  return out.slice(0, MAX_TAGS);
}

/** Every kind a day can draft: the four standing posts and the five angles. */
export const ALL_DRAFT_KINDS: PostKind[] = ["games", "movers", "set", "dips", ...ANGLE_KINDS];

/**
 * A day's drafts for a game, in posting order. Empty when the data is thin.
 * `kinds` limits the build to the kinds named (the publisher, the render and
 * the admin page pass the day's slot kinds: Chris 10-03, "only create what we
 * are going to use, nothing extra"); omitted = every kind.
 */
export function socialDrafts(game: GameId, day = todayUtc(), kinds: readonly PostKind[] = ALL_DRAFT_KINDS): Promise<SocialPost[]> {
  return withSeriesCache(() => buildDrafts(game, day, kinds));
}

/**
 * The drafts cache (10-03, Chris: "/admin/social loads so damn slow"): a
 * build is ~9 s and ~100 queries on prod (two pool reads of 30k series rows,
 * the five angles trying their games), so the page reads the last build from
 * settings when it is under `maxAgeMs` old, and the publisher writes its
 * own build there at 7:05, 1:05 and 7:05 (it builds anyway). The publisher
 * itself never reads the cache: it posts prices as of the minute.
 */
const DRAFTS_CACHE_PREFIX = "social_drafts:";
export const DRAFTS_CACHE_MAX_AGE_MS = 20 * 60_000;
export async function storeDraftsCache(game: GameId, day: string, drafts: SocialPost[], now = Date.now()): Promise<void> {
  await setSetting(`${DRAFTS_CACHE_PREFIX}${game}:${day}`, JSON.stringify({ at: now, drafts }));
}
/** Whole minutes since a timestamp, for the page's "built N min ago". */
export function minutesSince(at: number, now = Date.now()): number {
  return Math.max(0, Math.round((now - at) / 60_000));
}
export async function cachedSocialDrafts(
  game: GameId,
  day: string,
  opts: { maxAgeMs?: number; fresh?: boolean; now?: number; kinds?: readonly PostKind[]; all?: boolean; staleOk?: boolean } = {},
): Promise<{ drafts: SocialPost[]; at: number; cached: boolean; stale?: boolean }> {
  const now = opts.now ?? Date.now();
  // `kinds` = the day's slot kinds (the page passes socialPublish.ts dayKinds). `all` = the spares too (?all=1 on
  // /admin/social), built on request and never cached: the cache holds what posts.
  if (opts.all) return { drafts: await socialDrafts(game, day, ALL_DRAFT_KINDS), at: now, cached: false };
  if (!opts.fresh) {
    try {
      const row = JSON.parse((await getSetting(`${DRAFTS_CACHE_PREFIX}${game}:${day}`)) || "null") as { at?: number; drafts?: SocialPost[] } | null;
      if (row && typeof row.at === "number" && Array.isArray(row.drafts)) {
        const old = now - row.at > (opts.maxAgeMs ?? DRAFTS_CACHE_MAX_AGE_MS);
        // staleOk (10-07, Chris: the Social tab "still takes forever"): hand back an old build at once and let
        // the caller rebuild it after the response, instead of a ~9 s-per-game build on most visits.
        if (!old || opts.staleOk) return { drafts: row.drafts, at: row.at, cached: true, stale: old };
      }
    } catch {
      /* an unreadable row is rebuilt */
    }
  }
  const drafts = await socialDrafts(game, day, opts.kinds);
  await storeDraftsCache(game, day, drafts, now).catch((err) => console.warn("social: drafts cache write failed", err instanceof Error ? err.message : err));
  return { drafts, at: now, cached: false };
}

async function buildDrafts(game: GameId, day: string, kinds: readonly PostKind[]): Promise<SocialPost[]> {
  // A day plan (lib/socialPlan.ts) can mix Magic into the Pokémon movers,
  // add the all-games picture, and name the other games on Pokémon posts.
  const plan = dayPlan(day);
  const mixed = Boolean(plan.mixedMovers) && game === "pokemon";
  const also = Boolean(plan.alsoScans) && game === "pokemon";
  const want = (k: PostKind) => kinds.includes(k);
  const none = <T,>(): Promise<T[]> => Promise.resolve([] as T[]);
  // Gainers at 1pm, drops at 7pm: no card appears in both posts on the same day. Only the kinds asked for are read.
  const [movers, spot, dips, leads] = await Promise.all([
    !want("movers") ? none<Mover>() : mixed ? mixedMovers(day) : recentlyFeatured(game, "movers", day).then((exclude) => topMovers(game, day, { direction: "up", exclude })),
    want("set") ? setSpotlight(game, day) : Promise.resolve(null),
    want("dips") ? recentlyFeatured(game, "dips", day).then((exclude) => topMovers(game, day, { direction: "down", exclude })) : none<Mover>(),
    // The all-games post: from JUMPS_FROM it is each game's biggest weekly jump (a game with none keeps its lead card); before, the lead cards.
    want("games") && game === "pokemon" ? (jumpsOn(day) ? gameJumps(day) : gameLeads(day)) : none<GameLead>(),
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
  // The five angles ride the Pokémon loop (the one the publisher runs) and carry their own game: the day's rotation pick,
  // or the next game with the data (angleData). A slot posts one when the schedule names it (phase 3); only those asked for are drawn.
  if (game === "pokemon") {
    const angles = await Promise.all(ANGLE_KINDS.filter(want).map((kind) => angleData(kind, day)));
    for (const a of angles) if (a) posts.push(angleDraft(a, day));
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
