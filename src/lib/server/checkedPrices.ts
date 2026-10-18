import { db } from "@/lib/db";
import { addDays, dayIndex, decodePrices, encodePrices } from "@/lib/priceSeries";
import type { CardPrice, GameId } from "@/lib/types";

/**
 * Hand eBay sold checks that FIX a caught price (10-18, Chris: "seems insane to
 * just leave them broken"). A row in price_checked is an admin's eBay sold
 * price (raw, no slabs) for one printing. While TCGplayer's own number stays
 * more than CHECKED_BAND away from it, the checked price is the one we keep:
 * the daily refreshers and saved lookups write it into the TCGplayer series
 * instead of TCGplayer's number (correctSeriesUpserts / checkedValue), so every
 * screen that reads our history (card pages, charts, movers, posts, Inventory,
 * insights, alerts) agrees, and live rows on their way to a screen are fixed
 * in withPriceFlags. TCGplayer's latest raw number is kept on the row
 * (tcg_usd). The check retires itself once TCGplayer is back within the band,
 * or CHECKED_MAX_DAYS after it was made; the points it fixed stay fixed.
 */

/** TCGplayer's number counts as wrong while it is more than this far from the checked price. */
export const CHECKED_BAND = 0.25;
/** A check binds for this many days, then retires (prices move: a new check is a new row). */
export const CHECKED_MAX_DAYS = 30;

export interface CheckedPrice {
  game: GameId;
  cardId: string;
  variant: string;
  usd: number;
  /** Sold listings the price was read from. */
  n: number;
  /** The day of the check (UTC). */
  day: string;
  note: string;
}

export const checkKey = (game: string, cardId: string, variant: string) => `${game}|${cardId}|${variant}`;

/** `raw` is more than CHECKED_BAND away from the checked price. Pure. */
export const isOffCheck = (raw: number, usd: number): boolean => Math.abs(raw - usd) > CHECKED_BAND * usd;

/** The check still binds on `day`. Pure. */
export const checkBinds = (c: Pick<CheckedPrice, "day">, day: string): boolean => {
  const age = dayIndex(c.day, day);
  return age >= 0 && age <= CHECKED_MAX_DAYS;
};

/** The number to keep for TCGplayer's `raw`: the checked price while the check binds and `raw` is off it, else `raw`. Pure. */
export function checkedValue(raw: number, c: CheckedPrice | undefined, day: string): number {
  return c && checkBinds(c, day) && raw > 0 && isOffCheck(raw, c.usd) ? c.usd : raw;
}

/**
 * A series with its trailing wrong stretch fixed: walking back from the last
 * point (no further than CHECKED_MAX_DAYS before the check), every point off
 * the checked price takes it, until the first point that is not off (a point
 * fixed on an earlier day is not, so a nightly re-run only touches today).
 * `raw` = the last point as given, on `rawDay`. Pure.
 */
export function correctTail(startDay: string, prices: (number | null)[], c: CheckedPrice, day: string): { prices: (number | null)[]; changed: boolean; raw: number | null; rawDay: string | null } {
  let last = -1;
  for (let i = prices.length - 1; i >= 0; i--) if (prices[i] != null) {
    last = i;
    break;
  }
  const raw = last >= 0 ? (prices[last] as number) : null;
  const rawDay = last >= 0 ? addDays(startDay, last) : null;
  if (raw == null || !checkBinds(c, day)) return { prices, changed: false, raw, rawDay };
  const floor = Math.max(0, dayIndex(startDay, addDays(c.day, -CHECKED_MAX_DAYS)));
  const out = prices.slice();
  let changed = false;
  for (let i = last; i >= floor; i--) {
    const v = out[i];
    if (v == null) continue;
    if (!isOffCheck(v, c.usd)) break;
    out[i] = c.usd;
    changed = true;
  }
  return { prices: out, changed, raw, rawDay };
}

// ---------------------------------------------------------------------------
// Reading (the table holds a few dozen rows: the binding ones are read whole)

const MEMO_MS = 10 * 60 * 1000;
let memo: { at: number; rows: Map<string, CheckedPrice> } | null = null;

export function clearCheckedMemo(): void {
  memo = null;
}

/** Every check that is still on, by checkKey. A failed read is "no checks" (advisory, like the guard). */
export async function activeChecks(): Promise<Map<string, CheckedPrice>> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.rows;
  const rows = new Map<string, CheckedPrice>();
  try {
    const got = (await db.prepare("SELECT game, card_id, variant, usd, n, day, note FROM price_checked WHERE off_day IS NULL").all()) as unknown as {
      game: GameId;
      card_id: string;
      variant: string;
      usd: number;
      n: number;
      day: string;
      note: string;
    }[];
    for (const r of got) {
      const usd = Number(r.usd);
      if (!(usd > 0)) continue;
      rows.set(checkKey(r.game, r.card_id, r.variant), { game: r.game, cardId: r.card_id, variant: r.variant, usd, n: Number(r.n) || 0, day: r.day, note: r.note ?? "" });
    }
  } catch (err) {
    // Not remembered: a read that failed (the table not there yet, 10-18 first deploy) must not hide checks for 10 minutes.
    console.warn("checked prices: could not read price_checked", err);
    return rows;
  }
  memo = { at: Date.now(), rows };
  return rows;
}

/** The check that fixes this TCGplayer USD row's number on `day`, or undefined. */
export function checkFor(checks: Map<string, CheckedPrice>, game: GameId, cardId: string, p: Pick<CardPrice, "source" | "currency" | "variant" | "market">, day: string): CheckedPrice | undefined {
  if (p.source !== "tcgplayer" || p.currency !== "USD" || p.market == null || !(p.market > 0)) return undefined;
  const c = checks.get(checkKey(game, cardId, p.variant));
  return c && checkedValue(p.market, c, day) !== p.market ? c : undefined;
}

// ---------------------------------------------------------------------------
// Writing

/**
 * Notes TCGplayer's latest raw number on the check, and retires it when that
 * number is back within the band or the check is too old. Best effort.
 */
async function noteRaw(c: CheckedPrice, raw: number, day: string): Promise<void> {
  const retire = !checkBinds(c, day) || !isOffCheck(raw, c.usd);
  try {
    await db
      .prepare(`UPDATE price_checked SET tcg_usd = ?, tcg_day = ?${retire ? ", off_day = ?" : ""} WHERE game = ? AND card_id = ? AND variant = ?`)
      .run(...(retire ? [raw, day, day] : [raw, day]), c.game, c.cardId, c.variant);
    if (retire) clearCheckedMemo();
  } catch (err) {
    console.warn("checked prices: could not note TCGplayer's number", err);
  }
}

interface SeriesRowLike {
  cardId: string;
  game: GameId;
  variant: string;
  source: string;
  currency: string;
  startDay: string;
  prices: string;
  /** The day being written (the series runs to it). */
  updatedDay: string;
}

/** `rows` (about to be written to price_series) with every checked TCGplayer USD series' wrong tail fixed. Untouched rows are the same objects. */
export async function correctSeriesUpserts<T extends SeriesRowLike>(rows: T[]): Promise<T[]> {
  if (!rows.some((r) => r.source === "tcgplayer" && r.currency === "USD")) return rows;
  const checks = await activeChecks();
  if (checks.size === 0) return rows;
  const out: T[] = [];
  for (const r of rows) {
    const c = r.source === "tcgplayer" && r.currency === "USD" ? checks.get(checkKey(r.game, r.cardId, r.variant)) : undefined;
    if (!c) {
      out.push(r);
      continue;
    }
    const fixed = correctTail(r.startDay, decodePrices(r.prices), c, r.updatedDay);
    // Only a point written for this day is TCGplayer's word (a row carried over from an earlier day may end on a fixed point).
    if (fixed.raw != null && fixed.rawDay === r.updatedDay) await noteRaw(c, fixed.raw, r.updatedDay);
    out.push(fixed.changed ? { ...r, prices: encodePrices(fixed.prices) } : r);
  }
  return out;
}

/** One point about to be written (a saved lookup): the checked price instead of a wrong TCGplayer number. Read-only (it runs inside recordPrices' transaction): the nightly refresh notes the raw number. */
export async function correctPoint(game: GameId, cardId: string, variant: string, source: string, currency: string, price: number, day: string): Promise<number> {
  if (source !== "tcgplayer" || currency !== "USD") return price;
  const c = (await activeChecks()).get(checkKey(game, cardId, variant));
  return checkedValue(price, c, day);
}

/** Add or replace a check (admin / seed script). The tail of the series is fixed on the next write, or now with fixSeries. */
export async function putCheck(c: CheckedPrice): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO price_checked (game, card_id, variant, usd, n, day, note, tcg_usd, tcg_day, off_day)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    )
    .run(c.game, c.cardId, c.variant, c.usd, c.n, c.day, c.note.slice(0, 300));
  clearCheckedMemo();
}
