/**
 * Compact price-series codec shared by the app, the sync/backfill scripts and
 * the tests. One row per (card, variant, source): a start day plus a JSON
 * array of daily prices, `null` for days with no reading. 90 days of a card
 * is ~500 bytes instead of 90 rows with UUID keys — the row-per-day version
 * of this table hit 6.4 GB on the Magic backfill.
 */

export const DAY_MS = 86_400_000;
/** Keep at most this many days per series (older days roll off the front). */
export const MAX_DAYS = 730;

export function todayUtc(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function dayIndex(fromDay: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export interface SeriesRow {
  startDay: string;
  prices: (number | null)[];
}

/** Insert/overwrite one day's price; returns the new row (never mutates). */
export function setDay(row: SeriesRow | null, day: string, price: number): SeriesRow {
  const p = Math.round(price * 100) / 100;
  if (!row || row.prices.length === 0) return { startDay: day, prices: [p] };
  let { startDay } = row;
  const prices = row.prices.slice();
  let i = dayIndex(startDay, day);
  if (i < 0) {
    prices.unshift(...new Array(-i).fill(null));
    startDay = day;
    i = 0;
  }
  while (prices.length <= i) prices.push(null);
  prices[i] = p;
  if (prices.length > MAX_DAYS) {
    const drop = prices.length - MAX_DAYS;
    prices.splice(0, drop);
    startDay = addDays(startDay, drop);
  }
  return { startDay, prices };
}

export interface HistoryPoint {
  day: string;
  price: number;
}

export function toPoints(row: SeriesRow): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  row.prices.forEach((p, i) => {
    if (p != null) out.push({ day: addDays(row.startDay, i), price: p });
  });
  return out;
}

export function encodePrices(prices: (number | null)[]): string {
  return JSON.stringify(prices);
}

export function decodePrices(text: string): (number | null)[] {
  try {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr.map((v) => (typeof v === "number" ? v : null)) : [];
  } catch {
    return [];
  }
}
