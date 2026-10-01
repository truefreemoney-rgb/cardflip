import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";
import { COUNTRY_CURRENCY } from "@/lib/countries";
import { fxStaleReason } from "@/lib/localPricing";

/**
 * USD → home-currency rates for the "≈ £12.40" price hint (Chris 09-30).
 * ECB reference rates via Frankfurter (free, no key), cached in settings
 * fx_rates and refreshed at most every 12 hours on demand, so no cron and no
 * billing job depends on it. A failed fetch keeps the last good rates; no
 * rates at all = no hint (USD is always shown).
 */
export interface FxRates {
  /** ECB rate date (yyyy-mm-dd). */
  date: string;
  fetchedAt: number;
  /** 1 USD = rates[CUR] units. */
  rates: Record<string, number>;
}

const KEY = "fx_rates";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const WANTED = [...new Set(Object.values(COUNTRY_CURRENCY))].filter((c) => c !== "USD");

function parse(raw: string | null): FxRates | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as FxRates;
    return v && typeof v.date === "string" && v.rates && typeof v.fetchedAt === "number" ? v : null;
  } catch {
    return null;
  }
}

/** Thrown when no rate good enough to price or convert a local listing is on hand. Seller-readable. */
export class FxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxUnavailableError";
  }
}

/**
 * The rate a LOCAL listing may be priced with: 1 USD = `rate` units of
 * `currency`. Refuses (FxUnavailableError) when the rate is missing for that
 * currency or older than ~3 days (lib/localPricing.ts fxStaleReason): a
 * stale rate would put a wrong price on a live listing, so no listing is
 * better than a guessed one.
 */
export async function listingFxRate(currency: string, siteLabel: string, now = Date.now()): Promise<{ rate: number; date: string }> {
  const fx = await getFxRates(now);
  const reason = fxStaleReason(fx, now);
  const rate = fx?.rates[currency];
  if (reason || !fx || !(typeof rate === "number" && rate > 0)) {
    throw new FxUnavailableError(
      `CardFlip can't price an ${siteLabel} listing right now: ${reason ?? `no ${currency} rate is available`}. Nothing was sent to eBay; try again in a little while.`,
    );
  }
  return { rate, date: fx.date };
}

const DAY_KEY = (currency: string, day: string) => `fx_day:${currency}:${day}`;
const goodRate = (r: unknown): r is number => typeof r === "number" && r > 0 && r < 1000;

/**
 * USD → `currency` at the rate on `day` (yyyy-mm-dd, UTC) from Frankfurter's
 * historical endpoint, fetched on demand. Frankfurter answers a weekend with
 * the previous business day's rate. EVERY answer is cached in settings under
 * currency + day (one fetch fills all the currencies for that day), recent
 * days included, so the sales sync (sold_price) and the fee sync (sold_fees)
 * of one sale always use the SAME rate, and a day costs one Frankfurter call
 * in total. `memo` (one Map per sync pass) also remembers a FAILURE for the
 * pass, so many order lines on a day with no rate cost one failed call, not
 * one each. Returns null when no rate can be had: the caller defers the sale,
 * it never guesses.
 */
export async function fxRateOnDay(currency: string, day: string, memo?: Map<string, number | null>): Promise<number | null> {
  if (currency === "USD") return 1;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const memoKey = `${currency}:${day}`;
  if (memo?.has(memoKey)) return memo.get(memoKey) ?? null;
  const done = (r: number | null) => {
    memo?.set(memoKey, r);
    return r;
  };
  const cached = Number(await getSetting(DAY_KEY(currency, day)));
  if (goodRate(cached)) return done(cached);
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${day}?base=USD&symbols=${WANTED.join(",")}`, {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`frankfurter ${res.status}`);
    const body = (await res.json()) as { rates?: Record<string, number> };
    if (!goodRate(body.rates?.[currency])) throw new Error("frankfurter: no rate for " + currency);
    for (const c of WANTED) {
      const r = body.rates?.[c];
      if (goodRate(r)) await setSetting(DAY_KEY(c, day), String(r));
    }
    return done(body.rates![currency]);
  } catch (err) {
    console.error(`fx: no ${currency} rate for ${day}:`, err instanceof Error ? err.message : err);
    return done(null);
  }
}

export async function getFxRates(now = Date.now()): Promise<FxRates | null> {
  const cached = parse(await getSetting(KEY));
  if (cached && now - cached.fetchedAt < MAX_AGE_MS) return cached;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${WANTED.join(",")}`, {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`frankfurter ${res.status}`);
    const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const rates: Record<string, number> = {};
    for (const c of WANTED) {
      const r = body.rates?.[c];
      if (typeof r === "number" && r > 0 && r < 1000) rates[c] = r;
    }
    if (!body.date || Object.keys(rates).length !== WANTED.length) throw new Error("frankfurter: incomplete rates");
    const fresh: FxRates = { date: body.date, fetchedAt: now, rates };
    await setSetting(KEY, JSON.stringify(fresh));
    return fresh;
  } catch (err) {
    console.error("fx: rate refresh failed, keeping the last good rates:", err);
    return cached;
  }
}
