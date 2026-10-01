/**
 * Pricing a listing for another eBay site (docs/EBAY_COUNTRIES_PLAN.md,
 * increment 2). Pure: no env, no DB, no network, so the client shows the same
 * number the server sends.
 *
 * The market price is USD (TCGplayer). A local listing is priced from the
 * USD MARKET value converted at the day's rate, then run through THAT site's
 * fee model and cheap-card taper (fees.ts …For variants). It is never derived
 * from cards.price, which the live refresh writes with the US fee model.
 * A price the seller typed (a USD number, price_locked) converts at the rate
 * and is only checked against the local floor.
 */

import { costTaperedPriceFor } from "./fees.ts";
import type { EbayAccountType, Marketplace } from "./marketplaces.ts";

/** A local listing is refused when the rate we hold is older than this (we last fetched it that long ago). */
export const FX_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** ...or when the ECB reference date behind it is older than this (a long weekend + a holiday is ~5 days). */
export const FX_MAX_RATE_DATE_AGE_MS = 6 * 24 * 60 * 60 * 1000;

export interface FxStamp {
  /** ECB reference date, yyyy-mm-dd. */
  date: string;
  /** When we last fetched it (ms). */
  fetchedAt: number;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Why a rate may not price a listing, or null when it may. */
export function fxStaleReason(fx: FxStamp | null | undefined, now = Date.now()): string | null {
  if (!fx) return "no exchange rate is available";
  if (now - fx.fetchedAt > FX_MAX_AGE_MS) return `the exchange rate was last updated ${fx.date}`;
  const rateDate = Date.parse(`${fx.date}T00:00:00Z`);
  if (!Number.isFinite(rateDate) || now - rateDate > FX_MAX_RATE_DATE_AGE_MS) return `the exchange rate is dated ${fx.date}`;
  return null;
}

/** USD → local, to the cent. `rate` = units of local currency per 1 USD. */
export function toLocal(usd: number, rate: number): number {
  return round2(usd * rate);
}

/** Local → USD, to the cent (the ledger figure). */
export function toUsd(local: number, rate: number): number {
  return round2(local / rate);
}

/**
 * The asking price on `mp` for a copy worth `usdValue` (USD, condition
 * already applied): the value in local currency, then the site's cheap-card
 * taper (value + that site's fees + postage on top under the taper end, the
 * value itself above it).
 */
export function localAsk(mp: Marketplace, account: EbayAccountType | null | undefined, usdValue: number, rate: number): number {
  return costTaperedPriceFor(mp, toLocal(usdValue, rate), account);
}
