import "server-only";
import { db } from "@/lib/db";
import { addDays, dayIndex, decodePrices, todayUtc } from "@/lib/priceSeries";
import { PRICE_TRUST, isVintage, lastPriced, priceTrust } from "@/lib/server/priceTrust";
import { variantRank } from "@/lib/server/priceHistory";
import type { PriceFlag } from "@/lib/priceFlag";
import type { CardPrice, GameId, PokemonCard } from "@/lib/types";

/**
 * The price guard on the SITE (09-30): the same rule the social posts use
 * (priceTrust.ts, thresholds untouched), asked for the card a page is about to
 * show. A flagged card shows "This price looks off, check sold listings"
 * instead of its market price and gets no suggested listing price; every
 * server path that would print, store or mail a market price asks here first.
 *
 * Two layers. `judgeSeries` is pure (series in, verdict out) so the policy is
 * unit-testable; `loadTrustData` / `siteTrust` are the batched loaders (one
 * series query + one release-date/EUR query per 400 cards, never per card).
 *
 * Policy over the bare rule (why each line exists):
 *  - The HELD variant is judged on its own series (a foil row on the foil
 *    line), falling back to the card's default only when it keeps no line of
 *    that variant, the same reading heldSeries gives the ledger.
 *  - Siblings (test 3) only for Pokemon and only for the default variant, as
 *    the social path reads them. A holo is legitimately 3x its reverse holo,
 *    and a Lorcana or Magic foil 3x+ its normal print: siblings on flagged 7
 *    Lorcana foils that were fine.
 *  - Magic's referee is the finish's own Cardmarket price on the mirror row
 *    (foil and etched on price_eur_foil), not the nonfoil one.
 *  - Lorcana / One Piece / Yu-Gi-Oh series started 09-30: the "< 14 priced
 *    days" and "thin" soft signs would fire on a third of $10+ cards by youth
 *    alone, so until a series has PRICE_TRUST.minPricedDays only a hard
 *    verdict counts. The same holds for a price with no series at all (a card
 *    the price table has never seen): nothing to be suspicious of yet.
 *  - A live price that differs from the series' last point is judged as
 *    today's point (search results carry pokemontcg.io live prices).
 */

/** One series the rule reads (tcgplayer USD, oldest first, null = no point that day). */
export interface TrustSeries {
  variant: string;
  startDay: string;
  prices: (number | null)[];
}

/** Everything the rule needs about one card, loaded once. */
export interface TrustData {
  game: GameId;
  series: TrustSeries[];
  /** Pokemon: the latest fresh Cardmarket average (EUR), or null. */
  cmEur: number | null;
  /** Magic: Scryfall's Cardmarket prices on the mirror row (EUR), per finish. */
  eur: { nonfoil: number | null; foil: number | null } | null;
  /** The set's release date ("" = unknown), for the vintage exception. */
  released: string;
}

export interface JudgeOpts {
  /** The variant held or shown; none = the card's default. */
  variant?: string | null;
  /** Judge this variant only: no default fallback when it has no series (search results carry one row per printing). */
  exact?: boolean;
  /** A live price for today, appended to the series when it differs from the last point. */
  liveUsd?: number | null;
  /** Today (UTC day); the series is read up to it. */
  day?: string;
  /** Judge a past price as the OLD side of a move: `value` as it stood `back` days before `day`. */
  old?: { back: number; value: number };
}

/** Games whose price series are days old: only a hard verdict counts until they have history. */
const YOUNG_GAMES: ReadonlySet<GameId> = new Set(["lorcana", "onepiece", "yugioh"]);

const lastIn = (s: TrustSeries) => lastPriced(s.prices);

/** The default series: the printing people usually mean (same order as usdSeries). */
function defaultSeries(series: TrustSeries[]): TrustSeries | undefined {
  return series.reduce<TrustSeries | undefined>((a, b) => (!a || variantRank(b.variant) < variantRank(a.variant) ? b : a), undefined);
}

/** The value of a series on `day` (or the last point before it), or null when it has none yet. */
function valueOnOrBefore(s: TrustSeries, day: string): number | null {
  const i = Math.min(dayIndex(s.startDay, day), s.prices.length - 1);
  for (let j = i; j >= 0; j--) if (s.prices[j] != null) return s.prices[j];
  return null;
}

/** The verdict for one price, or null when it is fine (or there is nothing to judge). Pure. */
export function judgeSeries(data: TrustData, opts: JudgeOpts = {}): PriceFlag | null {
  const day = opts.day ?? todayUtc();
  const def = defaultSeries(data.series);
  const own = opts.variant ? data.series.find((s) => s.variant === opts.variant) : undefined;
  const s = own ?? (opts.exact && opts.variant ? undefined : def);
  const variant = own ? own.variant : opts.variant && opts.exact ? opts.variant : (s?.variant ?? "");
  let prices = s ? s.prices : [];
  let startDay = s ? s.startDay : day;
  let to: number | null;
  const todayIdx = dayIndex(startDay, day);

  if (opts.old) {
    // The OLD side of a move: this series up to that day, the siblings as they stood then (social.ts oldPriceOk).
    to = opts.old.value;
    if (!(to > 0)) return null;
    prices = prices.slice(0, todayIdx - opts.old.back + 1);
  } else {
    to = s ? lastIn(s) : null;
    const live = opts.liveUsd != null && opts.liveUsd > 0 ? opts.liveUsd : null;
    if (live != null && live !== to) {
      // Today's point is the live one (a card the series has never seen starts its own).
      if (!s) startDay = day;
      const i = dayIndex(startDay, day);
      const next = prices.slice();
      while (next.length <= i) next.push(null);
      if (i >= 0) next[i] = live;
      prices = next;
      to = live;
    }
    if (to == null || !(to > 0)) return null;
  }

  // Siblings: Pokemon's other printings, only for the default one (see the header).
  let siblings: number[] = [];
  if (data.game === "pokemon" && s && s === def) {
    siblings = data.series
      .filter((o) => o !== s)
      .map((o) => (opts.old ? valueOnOrBefore(o, addDays(day, -opts.old.back)) : lastIn(o)))
      .filter((v): v is number => v != null && v > 0);
  }
  const refEur = data.game === "mtg" ? (variant === "nonfoil" ? (data.eur?.nonfoil ?? null) : (data.eur?.foil ?? null)) : data.game === "pokemon" ? data.cmEur : null;
  const verdict = priceTrust({ to, prices, siblings, refEur, vintage: isVintage(data.game === "pokemon" ? variant : "", data.released), old: opts.old != null });
  if (verdict.ok) return null;
  const priced = prices.reduce((n, v) => n + (v != null ? 1 : 0), 0);
  // Unverified only (soft signs): not evidence on a series too young to have any, or a price the table has no series for.
  if (!verdict.hard && (!s || (YOUNG_GAMES.has(data.game) && priced < PRICE_TRUST.minPricedDays))) return null;
  return { hard: !!verdict.hard, reason: verdict.reason };
}

// ---------------------------------------------------------------------------
// Loading

interface SeriesRow {
  card_id: string;
  variant: string;
  source: string;
  start_day: string;
  prices: string;
}

const MEMO_MS = 10 * 60 * 1000;
const MEMO_CAP = 3000;
const memo = new Map<string, { at: number; day: string; data: TrustData }>();

/** Forget the per-process memo (tests; a price refresh that must show at once). */
export function clearTrustMemo(): void {
  memo.clear();
}

/**
 * TrustData for a batch of cards: one series query and one release-date / EUR
 * query per 400 cards of a game. Kept 10 minutes per process (keyed by card and
 * UTC day) so a popular search does not re-read the same rows on every request.
 */
export async function loadTrustData(cards: { cardId: string; game: GameId }[], day = todayUtc()): Promise<Map<string, TrustData>> {
  const out = new Map<string, TrustData>();
  const now = Date.now();
  const byGame = new Map<GameId, Set<string>>();
  for (const c of cards) {
    const hit = memo.get(c.cardId);
    if (hit && hit.day === day && now - hit.at < MEMO_MS && hit.data.game === c.game) {
      out.set(c.cardId, hit.data);
      continue;
    }
    const set = byGame.get(c.game) ?? new Set<string>();
    set.add(c.cardId);
    byGame.set(c.game, set);
  }
  const cmSince = addDays(day, -PRICE_TRUST.refMaxAgeDays);
  for (const [game, idSet] of byGame) {
    const ids = [...idSet];
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const marks = chunk.map(() => "?").join(",");
      const rows = (await db
        .prepare(
          `SELECT card_id, variant, source, start_day, prices FROM price_series
            WHERE game = ? AND card_id IN (${marks})
              AND ((source = 'tcgplayer' AND currency = 'USD') OR (source = 'cardmarket' AND variant = 'average' AND updated_day >= ?))`,
        )
        .all(game, ...chunk, cmSince)) as unknown as SeriesRow[];
      const meta = new Map<string, { released: string; eur: TrustData["eur"] }>();
      if (game === "pokemon") {
        const r = (await db.prepare(`SELECT id, set_release_date FROM en_cards WHERE id IN (${marks})`).all(...chunk)) as unknown as { id: string; set_release_date: string }[];
        for (const m of r) meta.set(m.id, { released: m.set_release_date ?? "", eur: null });
      } else if (game === "mtg") {
        const r = (await db.prepare(`SELECT id, set_release_date, price_eur, price_eur_foil FROM mtg_cards WHERE id IN (${marks})`).all(...chunk)) as unknown as {
          id: string;
          set_release_date: string;
          price_eur: number | null;
          price_eur_foil: number | null;
        }[];
        for (const m of r) meta.set(m.id, { released: m.set_release_date ?? "", eur: { nonfoil: m.price_eur, foil: m.price_eur_foil } });
      }
      const built = new Map<string, TrustData>();
      for (const id of chunk) {
        const m = meta.get(id);
        built.set(id, { game, series: [], cmEur: null, eur: m?.eur ?? null, released: m?.released ?? "" });
      }
      for (const r of rows) {
        const d = built.get(r.card_id);
        if (!d) continue;
        const prices = decodePrices(r.prices);
        if (r.source === "cardmarket") d.cmEur = lastPriced(prices);
        else if (prices.some((p) => p != null)) d.series.push({ variant: r.variant, startDay: r.start_day, prices });
      }
      for (const [id, d] of built) {
        out.set(id, d);
        if (memo.size >= MEMO_CAP) memo.clear();
        memo.set(id, { at: now, day, data: d });
      }
    }
  }
  return out;
}

/** The key a verdict is found under: card id + variant ("" = the card's default). */
export const trustKey = (cardId: string, variant?: string | null) => `${cardId}|${variant ?? ""}`;

export interface TrustQuery {
  cardId: string;
  game: GameId;
  variant?: string | null;
  liveUsd?: number | null;
  exact?: boolean;
}

/**
 * The cards among `queries` whose price the rule flags, by trustKey. Fine cards
 * are absent, so `map.has(key)` is the whole question. Two queries per 400 cards.
 */
export async function siteTrust(queries: TrustQuery[], day = todayUtc()): Promise<Map<string, PriceFlag>> {
  const out = new Map<string, PriceFlag>();
  if (queries.length === 0) return out;
  const data = await loadTrustData(queries.map((q) => ({ cardId: q.cardId, game: q.game })), day);
  for (const q of queries) {
    const d = data.get(q.cardId);
    if (!d) continue;
    const flag = judgeSeries(d, { variant: q.variant, exact: q.exact, liveUsd: q.liveUsd, day });
    if (flag) out.set(trustKey(q.cardId, q.variant), flag);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cards on their way to a screen

const isTrustedRow = (p: CardPrice) => p.source === "tcgplayer" && p.currency === "USD" && p.market != null && p.market > 0;

/**
 * `cards` with `untrusted` set on each TCGplayer USD price row the rule flags.
 * Annotated at response time, on copies: the card cache and price_checks store
 * the payloads verbatim, so a flag must never be written into them. Cards the
 * price table cannot join (upstream-fallback ids, CJK) come back untouched.
 */
export async function withPriceFlags(cards: PokemonCard[], day = todayUtc()): Promise<PokemonCard[]> {
  const queries: TrustQuery[] = [];
  for (const c of cards) {
    for (const p of c.prices) if (isTrustedRow(p)) queries.push({ cardId: c.id, game: c.game ?? "pokemon", variant: p.variant, liveUsd: p.market, exact: true });
  }
  const flags = await siteTrust(queries, day);
  if (flags.size === 0) return cards;
  return cards.map((c) => {
    if (!c.prices.some((p) => isTrustedRow(p) && flags.has(trustKey(c.id, p.variant)))) return c;
    return { ...c, prices: c.prices.map((p) => (isTrustedRow(p) && flags.has(trustKey(c.id, p.variant)) ? { ...p, untrusted: flags.get(trustKey(c.id, p.variant)) } : p)) };
  });
}
