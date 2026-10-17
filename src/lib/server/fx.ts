import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";
import { COUNTRY_CURRENCY } from "@/lib/countries";
import { FX_MAX_AGE_MS, fxStaleReason } from "@/lib/localPricing";
import { reportServerError } from "@/lib/server/errorLog";

/**
 * USD → home-currency rates for the "≈ £12.40" price hint (Chris 09-30), the
 * Cardmarket-only Magic dollar prices (usdPerEur) and local eBay listings.
 * ECB reference rates via Frankfurter (free, no key), cached in settings
 * fx_rates and refreshed at most every 12 hours on demand; the nightly price
 * crons ask for it, so it refreshes daily even with no visitors.
 *
 * 10-17 (A-H #16, Chris: "try to never leave a price unsure ... updated daily
 * or weekly"): each currency stands on its own. Frankfurter first; any
 * currency it fails or leaves out comes from the public-domain fawazahmed0
 * currency API (jsDelivr, then its pages.dev mirror; no key, no credit line);
 * any still missing keeps its last good rate. A rate is never dropped, so a
 * price never goes blank for want of one. A failed refresh is retried at most
 * every 30 minutes (not on every page view), and a rate over 2 days old is
 * logged to error_events (the daily error mail). Local eBay listings still
 * refuse a rate over FX_MAX_AGE_MS, per currency (listingFxRate).
 */
export interface FxRates {
  /** ECB rate date (yyyy-mm-dd). */
  date: string;
  fetchedAt: number;
  /** 1 USD = rates[CUR] units. */
  rates: Record<string, number>;
  /** When each currency was last refreshed (ms); missing = fetchedAt (rows saved before 10-17). */
  rateAt?: Record<string, number>;
  /** The last refresh attempt, good or not (ms): the 30-minute retry gap. */
  triedAt?: number;
}

const KEY = "fx_rates";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const RETRY_GAP_MS = 30 * 60 * 1000;
/** Older than this, a rate in use is reported to the daily error mail. */
export const FX_ALERT_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const BACKUP_URLS = [
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
  "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
];
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
  // Per currency: a rate kept from an older refresh is as old as ITS refresh, not the latest one.
  const kept = fx ? rateAgeFrom(fx, currency) : 0;
  const reason =
    fxStaleReason(fx, now) ?? (fx && now - kept > FX_MAX_AGE_MS ? `the ${currency} rate was last updated ${new Date(kept).toISOString().slice(0, 10)}` : null);
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
      // A past day's rate never changes; "no-store" broke static pages (see getFxRates).
      cache: "force-cache",
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

/**
 * Dollars per euro from the cached ECB rates (10-03): the one rate the
 * Cardmarket-only Magic cards (Black Lotus, every print: TCGplayer publishes
 * no price) are shown in dollars at (lib/listing.ts withEurMarket). null when
 * no rate is on hand; the caller then shows what it showed before.
 */
export async function usdPerEur(now = Date.now()): Promise<number | null> {
  const fx = await getFxRates(now);
  const eurPerUsd = fx?.rates.EUR;
  return typeof eurPerUsd === "number" && eurPerUsd > 0 ? 1 / eurPerUsd : null;
}

const rateAgeFrom = (fx: FxRates, c: string): number => fx.rateAt?.[c] ?? fx.fetchedAt;
const okRate = (r: unknown): r is number => typeof r === "number" && r > 0 && r < 1000;
type Fetched = { date: string; rates: Record<string, number> };

/** Frankfurter (ECB): the currencies it gave, or null. */
async function fetchPrimary(): Promise<Fetched | null> {
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${WANTED.join(",")}`, {
      signal: AbortSignal.timeout(4000),
      // Not "no-store" (10-13): this runs inside statically rendered card pages, where a no-store fetch throws
      // Next's dynamic-usage error and flips the page to dynamic at runtime. A revalidated fetch is allowed
      // there; the settings row stays the real cache.
      next: { revalidate: MAX_AGE_MS / 1000 },
    });
    if (!res.ok) throw new Error(`frankfurter ${res.status}`);
    const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const rates: Record<string, number> = {};
    for (const c of WANTED) if (okRate(body.rates?.[c])) rates[c] = body.rates![c];
    return body.date && Object.keys(rates).length ? { date: body.date, rates } : null;
  } catch (err) {
    console.error("fx: Frankfurter failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** The backup (fawazahmed0 currency API, lower-case codes): the currencies it gave, or null. */
async function fetchBackup(): Promise<Fetched | null> {
  for (const url of BACKUP_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000), next: { revalidate: MAX_AGE_MS / 1000 } });
      if (!res.ok) throw new Error(`${res.status}`);
      const body = (await res.json()) as { date?: string; usd?: Record<string, number> };
      const rates: Record<string, number> = {};
      for (const c of WANTED) {
        const r = body.usd?.[c.toLowerCase()];
        if (okRate(r)) rates[c] = r;
      }
      if (body.date && Object.keys(rates).length) return { date: body.date, rates };
    } catch (err) {
      console.error(`fx: backup ${new URL(url).host} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

export async function getFxRates(now = Date.now()): Promise<FxRates | null> {
  const cached = parse(await getSetting(KEY));
  const complete = !!cached && WANTED.every((c) => okRate(cached.rates[c]));
  if (cached && complete && now - cached.fetchedAt < MAX_AGE_MS) return cached;
  if (cached?.triedAt && now - cached.triedAt < RETRY_GAP_MS) return cached;

  const primary = await fetchPrimary();
  const backup = WANTED.some((c) => !primary?.rates[c]) ? await fetchBackup() : null;
  const rates: Record<string, number> = {};
  const rateAt: Record<string, number> = {};
  for (const c of WANTED) {
    const fresh = primary?.rates[c] ?? backup?.rates[c];
    if (fresh) {
      rates[c] = fresh;
      rateAt[c] = now;
    } else if (cached && okRate(cached.rates[c])) {
      rates[c] = cached.rates[c];
      rateAt[c] = rateAgeFrom(cached, c);
    }
  }
  const source = primary ?? backup;
  if (!Object.keys(rates).length) {
    // Nothing now and nothing before: remember the try so the next page view does not wait on it again.
    await setSetting(KEY, JSON.stringify({ date: "", fetchedAt: 0, rates: {}, triedAt: now }));
    return null;
  }
  const next: FxRates = source
    ? { date: source.date, fetchedAt: now, rates, rateAt, triedAt: now }
    : { ...(cached as FxRates), rates, rateAt, triedAt: now };
  await setSetting(KEY, JSON.stringify(next));
  const old = WANTED.filter((c) => rates[c] && now - rateAt[c] > FX_ALERT_AGE_MS);
  if (old.length) {
    await reportServerError(
      "fx",
      new Error(`exchange rate over 2 days old for ${old.join(", ")}: Frankfurter and the backup both failed, still using the last good rate`),
    );
  }
  return next;
}
