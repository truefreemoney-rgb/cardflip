import "server-only";
import { db } from "@/lib/db";
import { cardPath, gamePath } from "@/lib/cardPages";
import { GAMES, GAME_IDS } from "@/lib/games";
import { addDays, decodePrices, todayUtc } from "@/lib/priceSeries";
import { SITE_URL } from "@/lib/siteUrl";
import type { GameId } from "@/lib/types";
import { pageTilesByIds } from "@/lib/server/cardPages";
import { buildDigest } from "@/lib/server/digest";
import { usdSeries } from "@/lib/server/priceHistory";
import { heldTrustOrOpen, loadTrustData, judgeFull } from "@/lib/server/priceTrustSite";
import { getSetting, setSetting } from "@/lib/server/settings";
import { gameJumps, MOVER_GAMES, sleepers, topMovers, type Mover } from "@/lib/server/social";
import { monthlyScans, scanQuota, scanTier, type User } from "@/lib/server/users";
import { listWishlist } from "@/lib/server/wishlist";

/**
 * The facts each weekly mail is built from (docs/EMAILS.md). Three rules hold
 * everywhere here, Chris 10-08:
 *   - every card price in a mail passes the site's price guard
 *     (priceTrustSite); a card the guard cannot vouch for is dropped, never
 *     mailed with a number that may be wrong;
 *   - a person's game is the game of the FIRST card they ever scanned
 *     (scan_usage.read), never a question at signup;
 *   - prices and scan counts come only from lib/pricing.ts (via users.ts).
 */

const DAY = 86_400_000;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
export const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (p: number) => `${p >= 0 ? "+" : ""}${Math.round(p)}%`;

/* ------------------------------------------------------------------ */
/* Tuesday: scans                                                      */
/* ------------------------------------------------------------------ */

export type ScansVariant = "trial_left" | "trial_out" | "sub_plenty" | "sub_low" | "sub_month";
export const SCANS_VARIANTS: ScansVariant[] = ["trial_left", "trial_out", "sub_plenty", "sub_low", "sub_month"];
export const SCANS_VARIANT_LABEL: Record<ScansVariant, string> = {
  trial_left: "Trial, scans left",
  trial_out: "Trial, out of scans",
  sub_plenty: "Subscriber, barely used",
  sub_low: "Subscriber, running low",
  sub_month: "Subscriber, week report",
};

export type TipId = "ebay" | "watchlist" | "sets";
export const TIPS: Record<TipId, { text: string; path: string; label: string }> = {
  ebay: { text: "You can list a card on eBay straight from CardFlip. Open a card, tap Publish, and the listing is written for you.", path: "/app/collection", label: "Try it" },
  watchlist: { text: "Watching a card you don't own yet? Tap \"Watch this price\" on any card page and we email you when it dips.", path: "/scan", label: "Find a card" },
  sets: { text: "Set Completion shows which cards you still need for a set, with today's prices. Inventory, then Sets.", path: "/app/collection/sets", label: "See your sets" },
};

export interface ScansFacts {
  variant: ScansVariant;
  /** Scans the person can spend right now. */
  left: number;
  /** What one payment credits (subscribers) or the trial allowance. */
  included: number;
  /** Subscribers: when the next scans arrive, or null when the plan is ending. */
  nextCreditAt: number | null;
  /** Plan id so the "Move to Pro" button shows for the standard plan only. */
  plan: "standard" | "pro" | null;
  /** The week report (sub_month): scans + cards added in the last 7 days, collection change in dollars (Chris 10-08: past week, not month). */
  month?: { scans: number; cardsAdded: number; valueChange: number | null };
  tip: TipId | null;
}

async function scansSince(userId: string, since: number): Promise<number> {
  const row = (await db.prepare("SELECT COUNT(*) AS n FROM scan_usage WHERE user_id = ? AND at >= ?").get(userId, since)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

async function cardsAddedSince(userId: string, since: number): Promise<number> {
  const row = (await db.prepare("SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND created_at >= ?").get(userId, since)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** One tip the person has not used yet: eBay first, then the watchlist, then Set Completion (not trackable, so it is the fallback). */
export async function tipFor(user: User): Promise<TipId | null> {
  if (!user.ebayConnected) {
    const listed = (await db.prepare("SELECT 1 FROM cards WHERE user_id = ? AND ebay_published_at IS NOT NULL LIMIT 1").get(user.id)) as unknown;
    if (!listed) return "ebay";
  }
  const watching = (await db.prepare("SELECT 1 FROM wishlist_items WHERE user_id = ? LIMIT 1").get(user.id)) as unknown;
  if (!watching) return "watchlist";
  return "sets";
}

export async function scansFacts(user: User, now = Date.now()): Promise<ScansFacts | null> {
  const tier = scanTier(user);
  const q = scanQuota(user, now);
  const tip = await tipFor(user);
  if (tier === "trial") {
    const left = q.remaining ?? 0;
    return { variant: left > 0 ? "trial_left" : "trial_out", left, included: q.included, nextCreditAt: null, plan: null, tip };
  }
  if (tier === "owner" || tier === "legacy") return null;
  // Booster-only accounts read like a subscriber with no next credit: plenty, low, or the month report.
  const included = tier === "pack" ? q.included : monthlyScans(user);
  const left = q.remaining ?? 0;
  const plan = tier === "pack" ? null : user.plan;
  const nextCreditAt = tier === "pack" ? null : (q.nextCreditAt ?? null);
  if (left < included / 10) return { variant: "sub_low", left, included, nextCreditAt, plan, tip };
  // Barely used: three quarters or more of one payment's scans still banked.
  if (left >= included * 0.75) return { variant: "sub_plenty", left, included, nextCreditAt, plan, tip };
  const used = await scansSince(user.id, now - 7 * DAY);
  const cardsAdded = await cardsAddedSince(user.id, now - 7 * DAY);
  let valueChange: number | null = null;
  try {
    const d = await buildDigest(user.id, now);
    if (d && d.held > 0) valueChange = Math.round((d.valueNow - d.valueBefore) * 100) / 100;
  } catch {
    valueChange = null;
  }
  return { variant: "sub_month", left, included, nextCreditAt, plan, month: { scans: used, cardsAdded, valueChange }, tip };
}

/* ------------------------------------------------------------------ */
/* Thursday: your cards                                                */
/* ------------------------------------------------------------------ */

export interface MailCard {
  name: string;
  set: string;
  number: string;
  game: GameId;
  image: string | null;
  url: string;
  /** Today's price. */
  price: number;
  /** A week ago; null when the card is shown for its price alone. */
  before: number | null;
  /** "watching" marks a watchlist card in the movers list. */
  note?: "watching";
}

export type CardsVariant = "movers" | "binder" | "five";
export const CARDS_VARIANTS: CardsVariant[] = ["movers", "binder", "five"];
export const CARDS_VARIANT_LABEL: Record<CardsVariant, string> = {
  movers: "Has cards: their movers",
  binder: "No cards: binder list for their game",
  five: "Never scanned: one card per game",
};

export interface CardsFacts {
  variant: CardsVariant;
  game: GameId | null;
  cards: MailCard[];
  /** Trial scans left, for the "Your N free scans are waiting" headline. */
  trialLeft: number | null;
}

const BINDER_MIN = 15;
const BINDER_MAX = 200;
const BINDER_SEEN_KEY = "email_binder_seen";
const BINDER_SEEN_DAYS = 14;

/** The game of the first card this person ever scanned, from the scan log; the first saved card as a fallback. */
export async function firstScanGame(userId: string): Promise<GameId | null> {
  const rows = (await db
    .prepare("SELECT read FROM scan_usage WHERE user_id = ? AND read IS NOT NULL ORDER BY at ASC LIMIT 5")
    .all(userId)) as unknown as Array<{ read: string }>;
  for (const r of rows) {
    try {
      const g = (JSON.parse(r.read) as { game?: unknown }).game;
      if (typeof g === "string" && (GAME_IDS as readonly string[]).includes(g)) return g as GameId;
    } catch {
      /* a truncated blob: try the next */
    }
  }
  const card = (await db.prepare("SELECT game FROM cards WHERE user_id = ? ORDER BY created_at ASC LIMIT 1").get(userId)) as { game: string } | undefined;
  return card && (GAME_IDS as readonly string[]).includes(card.game) ? (card.game as GameId) : null;
}

export async function hasScanned(userId: string): Promise<boolean> {
  const row = (await db.prepare("SELECT 1 FROM scan_usage WHERE user_id = ? LIMIT 1").get(userId)) as unknown;
  if (row) return true;
  const card = (await db.prepare("SELECT 1 FROM cards WHERE user_id = ? LIMIT 1").get(userId)) as unknown;
  return Boolean(card);
}

function onDay(series: { startDay: string; prices: (number | null)[] }, day: string): number | null {
  const idx = Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(series.startDay + "T00:00:00Z")) / DAY);
  const i = Math.min(idx, series.prices.length - 1);
  for (let j = i; j >= 0; j--) if (series.prices[j] != null) return series.prices[j];
  for (let j = Math.max(i, 0); j < series.prices.length; j++) if (series.prices[j] != null) return series.prices[j];
  return null;
}

/** Page link + picture for catalog cards, by game. Cards the catalog cannot place get the game's page. */
async function linksFor(cards: Array<{ cardId: string | null; game: GameId }>): Promise<Map<string, { url: string; image: string | null }>> {
  const out = new Map<string, { url: string; image: string | null }>();
  const byGame = new Map<GameId, string[]>();
  for (const c of cards) if (c.cardId) byGame.set(c.game, [...(byGame.get(c.game) ?? []), c.cardId]);
  for (const [game, ids] of byGame) {
    try {
      const tiles = await pageTilesByIds(game, ids);
      for (const id of ids) {
        const t = tiles.get(id);
        out.set(id, t ? { url: `${SITE_URL}${cardPath(game, t.setSlug, t.name, t.key)}`, image: t.image || null } : { url: `${SITE_URL}${gamePath(game)}`, image: null });
      }
    } catch (err) {
      console.warn(`campaign links: could not read ${game} tiles`, err);
      for (const id of ids) out.set(id, { url: `${SITE_URL}${gamePath(game)}`, image: null });
    }
  }
  return out;
}

/** The person's biggest moves this week across inventory and watchlist, guard-checked, biggest first. */
async function personalMovers(userId: string, now: number, limit = 3): Promise<MailCard[]> {
  const today = todayUtc(now);
  const weekAgo = addDays(today, -7);
  const picks: Array<MailCard & { abs: number; cardId: string | null }> = [];

  // Inventory: buildDigest already runs the guard and leaves junk out.
  const d = await buildDigest(userId, now);
  const owned = (await db
    .prepare("SELECT id, catalog_card_id, game, image_url FROM cards WHERE user_id = ? AND status != 'sold'")
    .all(userId)) as unknown as Array<{ id: string; catalog_card_id: string | null; game: GameId; image_url: string | null }>;
  const ownedById = new Map(owned.map((r) => [r.id, r]));
  for (const c of [...(d?.gainers ?? []), ...(d?.losers ?? [])]) {
    const row = ownedById.get(c.id);
    if (!row || c.change === 0) continue;
    picks.push({ name: c.name, set: c.set, number: c.number, game: row.game, image: row.image_url, url: `${SITE_URL}/app/collection`, price: c.now, before: c.before, abs: Math.abs(c.change), cardId: row.catalog_card_id });
  }

  // Watchlist: today vs a week ago on the catalog series, each judged by the guard.
  const watched = (await listWishlist(userId)).filter((w) => w.cardId);
  if (watched.length) {
    const ids = watched.map((w) => w.cardId!);
    const series = await usdSeries(ids);
    const trust = await heldTrustOrOpen(watched.map((w) => ({ catalog_card_id: w.cardId!, variant: null, game: w.game ?? "pokemon" })), today);
    for (const w of watched) {
      const s = series.get(w.cardId!);
      if (!s) continue;
      const nowP = onDay(s, today);
      const beforeP = onDay(s, weekAgo);
      if (nowP == null || beforeP == null || !(nowP > 0) || nowP === beforeP) continue;
      if (trust.flag({ catalog_card_id: w.cardId!, variant: null, game: w.game ?? "pokemon" })) continue;
      const game = w.game ?? "pokemon";
      picks.push({ name: w.englishName ?? w.cardName, set: w.setName, number: w.cardNumber, game, image: w.imageUrl || null, url: "", price: nowP, before: beforeP, note: "watching", abs: Math.abs(nowP - beforeP), cardId: w.cardId });
    }
  }

  picks.sort((a, b) => b.abs - a.abs);
  const top = picks.slice(0, limit);
  const links = await linksFor(top.map((p) => ({ cardId: p.cardId, game: p.game })));
  return top.map((p) => {
    const l = p.cardId ? links.get(p.cardId) : undefined;
    const { abs: _abs, cardId: _id, ...card } = p;
    void _abs;
    void _id;
    return { ...card, url: card.url || l?.url || `${SITE_URL}${gamePath(card.game)}`, image: card.image ?? l?.image ?? null };
  });
}

async function binderSeen(): Promise<Record<string, string>> {
  try {
    const raw = await getSetting(BINDER_SEEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Remember the binder cards a run mailed, so the same card does not come back for BINDER_SEEN_DAYS. */
export async function rememberBinderCards(cards: MailCard[], day = todayUtc()): Promise<void> {
  const seen = await binderSeen();
  const keep = addDays(day, -BINDER_SEEN_DAYS);
  for (const [k, d] of Object.entries(seen)) if (d < keep) delete seen[k];
  for (const c of cards) seen[`${c.game}:${c.name}:${c.number}`] = day;
  await setSetting(BINDER_SEEN_KEY, JSON.stringify(seen));
}

/** The movers reader for the games social.ts does not cover (Lorcana, One Piece, Yu-Gi-Oh!, series since 09-30): 7-day moves on tcg_cards' TCGplayer USD series, each judged by the price guard, both ends at the floor. Shaped like social.ts' Mover so the rest of this file treats all five games alike. */
type MoverLike = Pick<Mover, "cardId" | "name" | "setName" | "number" | "imageUrl" | "variant" | "from" | "to" | "pct">;
const YOUNG_LIMIT_ROWS = 4000;

async function youngGameMovers(game: GameId, day: string, { direction = "up" as "up" | "down" | "both", minPrice = 10, band = undefined as [number, number] | undefined, limit = 10, days = 7 } = {}): Promise<MoverLike[]> {
  const weekAgo = addDays(day, -days);
  const [lo, hi] = band ?? [minPrice, Infinity];
  const rows = (await db
    .prepare(
      `SELECT p.card_id, p.variant, p.start_day, p.prices, t.name, t.subtitle, t.set_name, t.collector_number, t.image_url
         FROM price_series p JOIN tcg_cards t ON t.id = p.card_id
        WHERE p.game = ? AND p.source = 'tcgplayer' AND p.currency = 'USD' AND p.updated_day >= ? AND p.start_day <= ? AND t.image_url <> ''
          AND COALESCE(json_extract(p.prices, '$[#-1]'), json_extract(p.prices, '$[#-2]'), 0) >= ?
          ${hi < Infinity ? "AND COALESCE(json_extract(p.prices, '$[#-1]'), json_extract(p.prices, '$[#-2]'), 0) < ?" : ""}
        LIMIT ${YOUNG_LIMIT_ROWS}`,
    )
    .all(...(hi < Infinity ? [game, addDays(day, -3), weekAgo, lo, hi] : [game, addDays(day, -3), weekAgo, lo]))) as unknown as Array<{
    card_id: string;
    variant: string;
    start_day: string;
    prices: string;
    name: string;
    subtitle: string;
    set_name: string;
    collector_number: string;
    image_url: string;
  }>;
  const moves: Array<MoverLike & { abs: number }> = [];
  for (const r of rows) {
    const s = { startDay: r.start_day, prices: decodePrices(r.prices) };
    const to = onDay(s, day);
    const from = onDay(s, weekAgo);
    if (to == null || from == null || !(to > 0) || !(from > 0) || Math.min(to, from) < lo || to === from) continue;
    // A move that is one odd point: the price must have held two days on each end.
    const idx = Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(s.startDay + "T00:00:00Z")) / DAY);
    const held = (i: number, v: number) => (s.prices[i] ?? s.prices[i - 1]) === v && (s.prices[i - 1] ?? s.prices[i]) === v;
    if (!held(Math.min(idx, s.prices.length - 1), to) || !held(Math.min(idx - days, s.prices.length - 1), from)) continue;
    const p = ((to - from) / from) * 100;
    if ((direction === "up" && p <= 0) || (direction === "down" && p >= 0)) continue;
    moves.push({ cardId: r.card_id, name: r.subtitle ? `${r.name} - ${r.subtitle}` : r.name, setName: r.set_name, number: r.collector_number, imageUrl: r.image_url, variant: r.variant, from, to, pct: Math.round(p * 10) / 10, abs: Math.abs(p) });
  }
  moves.sort((a, b) => b.abs - a.abs);
  const seen = new Set<string>();
  const out: MoverLike[] = [];
  const data = await loadTrustData(moves.slice(0, limit * 4).map((m) => ({ cardId: m.cardId, game })), day);
  for (const m of moves) {
    if (seen.has(m.cardId)) continue;
    const d = data.get(m.cardId);
    if (d && judgeFull(d, { variant: m.variant, day }).flag) continue;
    seen.add(m.cardId);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

/** One reader for all five games: social.ts for Pokémon + Magic, the young-game reader for the rest. */
async function moversFor(game: GameId, day: string, opts: { direction?: "up" | "down" | "both"; minPrice?: number; band?: [number, number]; limit?: number; days?: number } = {}): Promise<MoverLike[]> {
  if (MOVER_GAMES.includes(game)) {
    const list = await topMovers(game, day, opts);
    return list.filter((m) => !m.unsettled);
  }
  return youngGameMovers(game, day, opts);
}

function moverCard(m: MoverLike, game: GameId): MailCard & { cardId: string } {
  return { name: m.name, set: m.setName, number: m.number, game, image: m.imageUrl || null, url: "", price: m.to, before: m.from, cardId: m.cardId };
}

/** Three ordinary-looking cards from one game worth $15-$200 that moved up this week: the "worth checking your binder for" list. */
export async function binderCards(game: GameId, now: number, limit = 3): Promise<MailCard[]> {
  const day = todayUtc(now);
  const seen = await binderSeen();
  const keep = addDays(day, -BINDER_SEEN_DAYS);
  let list = await moversFor(game, day, { direction: "up", limit: limit * 6, minPrice: BINDER_MIN, band: [BINDER_MIN, BINDER_MAX] });
  if (list.length < limit) list = await moversFor(game, day, { direction: "up", limit: limit * 6, minPrice: BINDER_MIN, band: [BINDER_MIN, BINDER_MAX], days: 6 });
  const fresh = list.filter((m) => m.imageUrl && m.to < BINDER_MAX && !(seen[`${game}:${m.name}:${m.number}`] >= keep));
  const picked = (fresh.length >= limit ? fresh : list.filter((m) => m.imageUrl)).slice(0, limit).map((m) => moverCard(m, game));
  const links = await linksFor(picked.map((p) => ({ cardId: p.cardId, game })));
  return picked.map(({ cardId, ...c }) => ({ ...c, url: links.get(cardId)?.url ?? `${SITE_URL}${gamePath(game)}` }));
}

/** One card per game: the game's biggest guard-checked jump this week, or its lead card where the history is too young. */
const JUMP_MIN_PCT = 10;

/** gameJumps (social.ts) with the three young games' own biggest weekly jump filled in where social.ts would show a lead card. */
async function allGameJumps(day: string) {
  const leads = await gameJumps(day);
  return Promise.all(
    leads.map(async (l) => {
      if (MOVER_GAMES.includes(l.game) || (l.pct != null && l.from != null)) return l;
      try {
        const [m] = await youngGameMovers(l.game, day, { direction: "up", limit: 1 });
        if (m && m.pct >= JUMP_MIN_PCT) return { ...l, name: m.name, setName: m.setName, number: m.number, price: m.to, imageUrl: m.imageUrl, cardId: m.cardId, from: m.from, pct: m.pct, variant: m.variant };
      } catch (err) {
        console.warn(`campaign: ${l.game} jump failed`, err);
      }
      return l;
    }),
  );
}

export async function fiveGameCards(now = Date.now()): Promise<MailCard[]> {
  const leads = await allGameJumps(todayUtc(now));
  const links = await linksFor(leads.map((l) => ({ cardId: l.cardId ?? null, game: l.game })));
  return leads.map((l) => ({
    name: l.name,
    set: l.setName,
    number: l.number,
    game: l.game,
    image: l.imageUrl || null,
    url: (l.cardId && links.get(l.cardId)?.url) || `${SITE_URL}${gamePath(l.game)}`,
    price: l.price,
    before: l.from ?? null,
  }));
}

export async function cardsFacts(user: User, now = Date.now(), shared: { five?: MailCard[] } = {}): Promise<CardsFacts> {
  const tier = scanTier(user);
  const trialLeft = tier === "trial" ? (scanQuota(user, now).remaining ?? 0) : null;
  const movers = await personalMovers(user.id, now);
  if (movers.length >= 1) return { variant: "movers", game: null, cards: movers, trialLeft };
  const game = (await hasScanned(user.id)) ? await firstScanGame(user.id) : null;
  if (game) {
    const binder = await binderCards(game, now);
    if (binder.length >= 3) return { variant: "binder", game, cards: binder, trialLeft };
  }
  shared.five ??= await fiveGameCards(now);
  return { variant: "five", game, cards: shared.five, trialLeft };
}

/* ------------------------------------------------------------------ */
/* Sunday: this week in cards                                          */
/* ------------------------------------------------------------------ */

export interface WeekFacts {
  games: Array<{ game: GameId; label: string; movePct: number | null; note: string }>;
  jump: (MailCard & { pct: number }) | null;
  set: { name: string; game: GameId; risers: number } | null;
  sleeper: (MailCard & { pct: number }) | null;
  scans: number;
  mostScanned: string | null;
}

const INDEX_TOP = 200;

/** The trimmed-mean 7-day move of a game's INDEX_TOP priciest guard-passed cards; null when the history is too young. */
async function gameIndex(game: GameId, day: string): Promise<number | null> {
  const rows = (await db
    .prepare(
      `SELECT card_id, variant, start_day, prices FROM price_series
       WHERE game = ? AND source = 'tcgplayer' AND currency = 'USD' AND updated_day >= ?`,
    )
    .all(game, addDays(day, -3))) as unknown as Array<{ card_id: string; variant: string; start_day: string; prices: string }>;
  const latest: Array<{ id: string; variant: string; now: number; before: number }> = [];
  const weekAgo = addDays(day, -7);
  for (const r of rows) {
    const s = { startDay: r.start_day, prices: decodePrices(r.prices) };
    if (s.startDay > weekAgo) continue;
    const nowP = onDay(s, day);
    const beforeP = onDay(s, weekAgo);
    if (nowP == null || beforeP == null || !(nowP > 0) || !(beforeP > 0)) continue;
    latest.push({ id: r.card_id, variant: r.variant, now: nowP, before: beforeP });
  }
  if (latest.length < 20) return null;
  latest.sort((a, b) => b.now - a.now);
  const top = latest.slice(0, INDEX_TOP * 2);
  const data = await loadTrustData(top.map((t) => ({ cardId: t.id, game })), day);
  const moves: number[] = [];
  for (const t of top) {
    const d = data.get(t.id);
    if (d && judgeFull(d, { variant: t.variant, day }).flag) continue;
    moves.push(((t.now - t.before) / t.before) * 100);
    if (moves.length >= INDEX_TOP) break;
  }
  if (moves.length < 20) return null;
  // Trimmed mean (the middle 80%): most cards sit still in a week, so the median is always 0; the extremes are one card's story.
  moves.sort((a, b) => a - b);
  const cut = Math.floor(moves.length / 10);
  const mid = moves.slice(cut, moves.length - cut);
  return Math.round((mid.reduce((a, b) => a + b, 0) / mid.length) * 10) / 10;
}

async function scansThisWeek(now: number): Promise<{ scans: number; mostScanned: string | null }> {
  const since = now - 7 * DAY;
  const rows = (await db.prepare("SELECT read FROM scan_usage WHERE at >= ? ORDER BY at DESC LIMIT 5000").all(since)) as unknown as Array<{ read: string | null }>;
  const count = (await db.prepare("SELECT COUNT(*) AS n FROM scan_usage WHERE at >= ?").get(since)) as { n: number } | undefined;
  const names = new Map<string, number>();
  for (const r of rows) {
    if (!r.read) continue;
    try {
      const n = (JSON.parse(r.read) as { name?: unknown }).name;
      if (typeof n === "string" && n) names.set(n, (names.get(n) ?? 0) + 1);
    } catch {
      /* skip */
    }
  }
  let best: string | null = null;
  let bestN = 1;
  for (const [n, c] of names) if (c > bestN) [best, bestN] = [n, c];
  return { scans: Number(count?.n ?? 0), mostScanned: best };
}

export async function weekFacts(now = Date.now()): Promise<WeekFacts> {
  const day = todayUtc(now);
  const jumps = await allGameJumps(day);
  const games: WeekFacts["games"] = [];
  for (const g of GAME_IDS) {
    const lead = jumps.find((j) => j.game === g);
    let movePct: number | null = null;
    try {
      movePct = await gameIndex(g, day);
    } catch (err) {
      console.warn(`week mail: ${g} index failed`, err);
    }
    const note =
      lead?.pct != null && lead.from != null
        ? `${lead.name} ${money(lead.from)} → ${money(lead.price)}`
        : movePct == null
          ? "not enough history yet"
          : Math.abs(movePct) < 0.5
            ? "quiet week"
            : movePct > 0
              ? "more up than down"
              : "more down than up";
    games.push({ game: g, label: GAMES[g].label, movePct, note });
  }

  const top = jumps.find((j) => j.pct != null && j.from != null);
  let jump: WeekFacts["jump"] = null;
  if (top) {
    const links = await linksFor([{ cardId: top.cardId ?? null, game: top.game }]);
    jump = { name: top.name, set: top.setName, number: top.number, game: top.game, image: top.imageUrl || null, url: (top.cardId && links.get(top.cardId)?.url) || `${SITE_URL}${gamePath(top.game)}`, price: top.price, before: top.from ?? null, pct: top.pct ?? 0 };
  }

  let set: WeekFacts["set"] = null;
  for (const g of GAME_IDS) {
    const risers = await moversFor(g, day, { direction: "up", limit: 20 });
    const bySet = new Map<string, number>();
    for (const m of risers) if (!/promo/i.test(m.setName)) bySet.set(m.setName, (bySet.get(m.setName) ?? 0) + 1);
    for (const [name, n] of bySet) if (n >= 3 && (!set || n > set.risers)) set = { name, game: g, risers: n };
  }

  let sleeper: WeekFacts["sleeper"] = null;
  for (const g of GAME_IDS) {
    const [s] = MOVER_GAMES.includes(g) ? await sleepers(g, day, { limit: 1 }) : (await youngGameMovers(g, day, { direction: "up", limit: 5, minPrice: 1, band: [1, 5] })).filter((m) => m.pct >= 15).slice(0, 1);
    if (s) {
      const links = await linksFor([{ cardId: s.cardId, game: g }]);
      sleeper = { ...moverCard(s, g), url: links.get(s.cardId)?.url ?? `${SITE_URL}${gamePath(g)}`, pct: s.pct };
      break;
    }
  }

  const { scans, mostScanned } = await scansThisWeek(now);
  return { games, jump, set, sleeper, scans, mostScanned };
}

export const escapeHtml = esc;
