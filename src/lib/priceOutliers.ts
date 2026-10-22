/**
 * The one read-time outlier filter for price history (10-06). price_series keeps junk one-off prints (Aquapolis
 * Tyranitar: a 3-day $0.32 between $110s) that a chart's low/high and the "the low was" sentence would print.
 * Stored data is never touched; every place history feeds a UI reads it through dropOutliers.
 *
 * Rule: a short stretch (at most MAX_JUNK_RUN consecutive points within 1.5x of each other) that sits more than
 * 4x above, or under a quarter of, the level on BOTH sides of it (median of up to 5 points each side) is dropped.
 * A real step change survives: its far side keeps the new level, so the stretch is not off both neighbours
 * (Tyranitar $56 to $111 is a doubling, and a level that persisted for weeks is a market, not a blip).
 * The first and last stretch are never dropped: with one neighbour there is nothing to tell a blip from a move,
 * and the newest point must match the headline price.
 */

import { addDays, toPoints, type HistoryPoint } from "./priceSeries.ts";

export const OUTLIER = { factor: 4, maxRun: 7, joinRatio: 1.5, side: 5 } as const;

const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/** Consecutive points whose neighbours stay within joinRatio of each other: [start, end) index pairs. */
function runsOf(points: HistoryPoint[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1]?.price, b = points[i]?.price;
    if (i === points.length || Math.max(a, b) / Math.min(a, b) > OUTLIER.joinRatio) {
      runs.push([start, i]);
      start = i;
    }
  }
  return runs;
}

/** The points with junk blips removed (a new array; the input is not mutated). Series under 3 points pass through. */
export function dropOutliers<T extends HistoryPoint>(points: T[]): T[] {
  let cur = points.filter((p) => p.price > 0);
  // Two passes: a spike next to another spike only shows once its neighbour is gone.
  for (let pass = 0; pass < 2 && cur.length >= 3; pass++) {
    const runs = runsOf(cur);
    const drop = new Set<number>();
    for (let r = 1; r < runs.length - 1; r++) {
      const [s, e] = runs[r];
      if (e - s > OUTLIER.maxRun) continue;
      const level = median(cur.slice(s, e).map((p) => p.price));
      const before = median(cur.slice(Math.max(0, s - OUTLIER.side), s).map((p) => p.price));
      const after = median(cur.slice(e, e + OUTLIER.side).map((p) => p.price));
      const hi = Math.max(before, after), lo = Math.min(before, after);
      if (level > hi * OUTLIER.factor || level < lo / OUTLIER.factor) for (let i = s; i < e; i++) drop.add(i);
    }
    if (drop.size === 0) break;
    cur = cur.filter((_, i) => !drop.has(i));
  }
  return cur;
}

/** How many points dropOutliers would remove. */
export const countOutliers = (points: HistoryPoint[]): number => points.length - dropOutliers(points).length;

/**
 * Days OUR pricing rule changed a game's TCGplayer numbers (the cheapest-listing caps), not the market. Measured 10-19
 * as $20+ series falling 15%+ in one day (a normal day: ~10): Magic 1,027 on 10-13 (6f3fc80f); Pokémon 779 on 10-16
 * (d4c436e1) and 528 on 10-18 (12b63f06, 1.45x with no cliff). A history read across one compares the old uncapped
 * number with the capped one: card pages said "Down 75%" (Dragonair 1st Ed $198 -> $29) and a 7am post called them
 * price drops. Stored data keeps every point (the price guard still reads all of it).
 */
export const CAP_BREAK_DAYS: Readonly<Record<string, readonly string[]>> = { mtg: ["2026-10-13"], pokemon: ["2026-10-16", "2026-10-18"] };
/** A point on a cap day this far under the one before it is the cap, not a move. */
export const CAP_BREAK_DROP = 0.85;

/** The last cap day a series fell on (its first point on that day or the next is 15%+ under the point before), or null. */
export function capBreakDay(points: readonly HistoryPoint[], game: string | undefined): string | null {
  const days = game ? CAP_BREAK_DAYS[game] : undefined;
  let found: string | null = null;
  for (const day of days ?? []) {
    const i = points.findIndex((p) => p.day >= day);
    if (i <= 0 || points[i].day > addDays(day, 1)) continue;
    if (points[i].price < CAP_BREAK_DROP * points[i - 1].price) found = points[i].day;
  }
  return found;
}

/** A step back up after a cap cut counts as the lift once it reaches this share of the level before the cut. */
export const CAP_LIFT_BACK = 0.65;

/**
 * The day a cut series came BACK (10-22): the Pokémon cap is off (pokemonPriceRefresh.ts POKEMON_CAP_ON), hand checks
 * at TCGplayer's sales put 28 cut cards back, and the cut points sit between. The first point after the cap break that
 * steps up 15%+ in one day to at least CAP_LIFT_BACK of the price just before the cut is the lift: the chart and its
 * change words start there, not at the cut (Raikou SL9: $698.99 -> $217.50 on 10-16 -> $579.99 on 10-22 read as
 * "Up 167%"). A step back to half the old level is a market move after the cut, not the lift. No date list: the lift
 * lands whenever the code ships or a check is recorded. Null when nothing came back.
 */
export function capLiftDay(points: readonly HistoryPoint[], game: string | undefined): string | null {
  const cut = capBreakDay(points, game);
  if (!cut) return null;
  const i = points.findIndex((p) => p.day >= cut);
  if (i <= 0) return null;
  const before = points[i - 1].price;
  for (let j = i + 1; j < points.length; j++) {
    const p = points[j].price;
    if (p < points[j - 1].price / CAP_BREAK_DROP) continue;
    if (p >= CAP_LIFT_BACK * before) return points[j].day;
  }
  return null;
}

/**
 * Days OUR pricing rule LIFTED a game's Cardmarket-converted numbers (lib/priceChain.ts CARDMARKET_LIFT, built 10-19,
 * first nightly fill 10-20): 618 of 708 Magic cardmarket-converted series stepped up 10-14% on 10-20 (Black Lotus Beta
 * $25,121 -> $28,229, the app's chart said "up 12.4%"). The same read as the caps, the other way round.
 */
export const LIFT_BREAK_DAYS: Readonly<Record<string, readonly string[]>> = { mtg: ["2026-10-20"] };
/** A point on a lift day this far (ratio) over the one before it is the lift, not a move. */
export const LIFT_BREAK_RANGE: readonly [number, number] = [1.08, 1.16];
/** The one source the lift touched. */
export const LIFT_SOURCE = "cardmarket-converted";

/** The last lift day a series stepped up on (its first point on that day or the next is 8-16% over the point before), or null. */
export function liftBreakDay(points: readonly HistoryPoint[], game: string | undefined): string | null {
  const days = game ? LIFT_BREAK_DAYS[game] : undefined;
  let found: string | null = null;
  for (const day of days ?? []) {
    const i = points.findIndex((p) => p.day >= day);
    if (i <= 0 || points[i].day > addDays(day, 1)) continue;
    const r = points[i].price / points[i - 1].price;
    if (r >= LIFT_BREAK_RANGE[0] && r <= LIFT_BREAK_RANGE[1]) found = points[i].day;
  }
  return found;
}

/** The break of a row by its source: TCGplayer rows break at a cap cut, Cardmarket-converted rows at the lift; other sources never. */
export function seriesBreakDay(points: readonly HistoryPoint[], source: string | undefined, game: string | undefined): string | null {
  if (!source || source === "tcgplayer") return game && CAP_BREAK_DAYS[game] ? (capLiftDay(points, game) ?? capBreakDay(points, game)) : null;
  if (source === LIFT_SOURCE) return game && LIFT_BREAK_DAYS[game] ? liftBreakDay(points, game) : null;
  return null;
}

/** The points from a row's break on (the whole series when it has none): fromCapBreak for any source. */
export function fromSeriesBreak<T extends HistoryPoint>(points: T[], source: string | undefined, game: string | undefined): T[] {
  const day = seriesBreakDay(points, source, game);
  return day ? points.filter((p) => p.day >= day) : points;
}

/**
 * The break day of a stored series row (seriesBreakDay): a TCGplayer row's cap cut, a Cardmarket-converted row's lift day
 * (10-20), nothing for any other source. A row that names no source is read as TCGplayer.
 */
export function seriesCapBreak(series: { startDay: string; prices: (number | null)[]; source?: string }, game: string | undefined): string | null {
  return seriesBreakDay(toPoints(series), series.source, game);
}

/**
 * The first day a series' history counts from: its first priced day, or its cap break when that is later (null = no
 * point at all). A "week ago" or "when you added it" price before this day is no honest before (alerts, mail, insights).
 */
export function historyStart(series: { startDay: string; prices: (number | null)[]; source?: string }, game: string | undefined): string | null {
  const first = series.prices.findIndex((p) => p != null);
  if (first < 0) return null;
  const firstDay = addDays(series.startDay, first);
  const brk = seriesCapBreak(series, game);
  return brk && brk > firstDay ? brk : firstDay;
}

/** The points from a series' cap break on, or from its lift when the series came back (the whole series when it has neither). */
export function fromCapBreak<T extends HistoryPoint>(points: T[], game: string | undefined): T[] {
  const day = capLiftDay(points, game) ?? capBreakDay(points, game);
  return day ? points.filter((p) => p.day >= day) : points;
}

/**
 * A stored series row as chart points, junk blips removed: the way every UI reader turns a row into history. With the
 * game of a TCGplayer row, history starts at its cap break (CAP_BREAK_DAYS); other sources pass no game.
 */
export const cleanSeriesPoints = (row: { startDay: string; prices: (number | null)[] }, capGame?: string): HistoryPoint[] =>
  fromCapBreak(dropOutliers(toPoints(row)), capGame);
