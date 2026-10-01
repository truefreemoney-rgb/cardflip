import "server-only";
import { db } from "@/lib/db";
import { belowFloor, belowFloorFor, floorRefusal, floorRefusalFor, listingFloorFor } from "@/lib/fees";
import { CURRENT_POINT_MAX_AGE_MS, strategyValueUsd } from "@/lib/listing";
import type { PriceStrategy } from "@/lib/types";
import { pickLocalAsk, toLocal } from "@/lib/localPricing";
import { addDays } from "@/lib/priceSeries";
import {
  LOCAL_MARKET_COUNTRIES,
  US_MARKETPLACE,
  formatLocalAmount,
  isLocalMarketplace,
  marketplaceByEbayId,
  marketplaceFor,
  marketplaceLabel,
  type EbayAccountType,
  type Marketplace,
} from "@/lib/marketplaces";
import type { CardRecord } from "@/lib/server/cards";
import { getEbayAccountFacts, refreshEbayIdentityIfMissing } from "@/lib/server/ebayAuth";
import { FxUnavailableError, getFxRates, listingFxRate } from "@/lib/server/fx";
import { heldSeries, preferredVariants, usdSeries } from "@/lib/server/priceHistory";
import { heldTrust } from "@/lib/server/priceTrustSite";
import { ebayLocalMarketsOn } from "@/lib/server/settings";

/**
 * Which eBay site a seller lists on NOW, and what a local listing costs
 * (docs/EBAY_COUNTRIES_PLAN.md, increment 2). Everything routes through
 * marketplaceFor(): switch on AND the row live AND home country AND the
 * seller's eBay registration marketplace all agreeing, otherwise EBAY_US.
 *
 * A seller whose home is not CA/GB/IE/AU costs ONE users read here and
 * nothing else, so the US path stays exactly what it was.
 */

export interface SellerMarket {
  mp: Marketplace;
  /** INDIVIDUAL | BUSINESS from Commerce Identity; null = unknown (priced as business). */
  account: EbayAccountType | null;
}

/** Thrown for a local listing we cannot price honestly (no market price, no usable rate). Seller-readable. */
export class LocalPriceError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "LocalPriceError";
  }
}

export async function sellerMarket(userId: string, opts: { refreshIdentity?: boolean } = {}): Promise<SellerMarket> {
  const row = (await db.prepare("SELECT home_country FROM users WHERE id = ?").get(userId)) as { home_country: string | null } | undefined;
  const home = (row?.home_country ?? "").trim().toUpperCase();
  if (!(LOCAL_MARKET_COUNTRIES as readonly string[]).includes(home)) return { mp: US_MARKETPLACE, account: null };
  // Sellers who connected before the account facts were captured: ask eBay (at most once an hour, never throwing).
  // A plain ledger save (refreshIdentity: false) never waits on eBay; it uses what is stored.
  const facts = opts.refreshIdentity === false ? await getEbayAccountFacts(userId) : await refreshEbayIdentityIfMissing(userId);
  const mp = marketplaceFor({
    homeCountry: home,
    ebayRegistrationMarketplace: facts.registrationMarketplace,
    switchOn: await ebayLocalMarketsOn(),
  });
  return { mp, account: facts.accountType };
}

/** The account type for fee math on a listing that already lives on a local site (the switch may have been turned off since). */
export async function sellerAccountType(userId: string): Promise<EbayAccountType | null> {
  return (await getEbayAccountFacts(userId)).accountType;
}

const lastIndexOf = (prices: (number | null)[]): number => {
  for (let j = prices.length - 1; j >= 0; j--) if (prices[j] != null) return j;
  return -1;
};

export type MarketValue =
  | { ok: true; value: number; day: string }
  | { ok: false; why: "none" | "stale"; day?: string };

/**
 * The card's USD market value through its condition and the Quick Sale pick
 * (the value before any fees or postage), from our own daily series. Not ok
 * when the card has no series or the price guard does not believe it
 * (why "none"), or when the latest point is older than the client's own
 * "current price" rule (listing.ts CURRENT_POINT_MAX_AGE_MS, 7 days; why
 * "stale"): a week-old figure is history, not a price to put on a live
 * listing. Never reads cards.price.
 */
export async function marketValue(
  card: Pick<CardRecord, "catalogCardId" | "variant" | "game" | "condition">,
  /** The seller's Quick Sale pick (an undercut preference they chose, not a fact the client reports). */
  strategy: PriceStrategy = "market",
  now = Date.now(),
): Promise<MarketValue> {
  if (!card.catalogCardId) return { ok: false, why: "none" };
  const row = { catalog_card_id: card.catalogCardId, variant: card.variant, game: card.game };
  const series = await usdSeries([card.catalogCardId], preferredVariants([row]));
  const s = heldSeries(series, row);
  const idx = s ? lastIndexOf(s.prices) : -1;
  const market = s && idx >= 0 ? s.prices[idx] : null;
  if (!s || market == null || !(market > 0)) return { ok: false, why: "none" };
  const trust = await heldTrust([row]);
  if (trust.flag(row)) return { ok: false, why: "none" };
  const day = addDays(s.startDay, idx);
  if (now - Date.parse(`${day}T00:00:00Z`) > CURRENT_POINT_MAX_AGE_MS) return { ok: false, why: "stale", day };
  const value = strategyValueUsd(market, card.condition, strategy);
  return value > 0 ? { ok: true, value, day } : { ok: false, why: "none" };
}

/** marketValue, as a bare number (null when there is no usable value). */
export async function marketValueUsd(
  card: Pick<CardRecord, "catalogCardId" | "variant" | "game" | "condition">,
  strategy: PriceStrategy = "market",
  now = Date.now(),
): Promise<number | null> {
  const v = await marketValue(card, strategy, now);
  return v.ok ? v.value : null;
}

export interface LocalAsk {
  /** The asking price in `mp.currency`. */
  price: number;
  /** Units of local currency per 1 USD. */
  rate: number;
  rateDate: string;
  /** The USD market value it came from (market basis only). */
  usdValue: number | null;
  /** typed = the seller's own price converted; market = USD market value through the local fee model. */
  basis: "typed" | "market";
}

/**
 * The price to send to `mp` for this card, in the site's currency, by the one
 * rule in localPricing.ts pickLocalAsk: a price the seller typed (price_locked,
 * a USD figure) converts at today's rate (the caller checks the local floor);
 * otherwise the USD MARKET value x today's rate through the site's fee model and
 * cheap-card taper (never cards.price, which the live refresh writes with the
 * US fee model).
 * Throws FxUnavailableError (rate missing/stale) or LocalPriceError (no market,
 * or a market point older than a week).
 */
export async function resolveLocalAsk(
  card: CardRecord,
  mp: Marketplace,
  account: EbayAccountType | null,
  strategy: PriceStrategy = "market",
): Promise<LocalAsk> {
  const { rate, date } = await listingFxRate(mp.currency, marketplaceLabel(mp));
  const typed = card.priceLocked && card.price > 0;
  let mv: MarketValue | null = null;
  if (!typed) {
    mv = await marketValue(card, strategy);
    if (!mv.ok) {
      throw new LocalPriceError(
        mv.why === "stale"
          ? `CardFlip's latest market price for this card is from ${mv.day}, too old to price an ${marketplaceLabel(mp)} listing from. Prices refresh daily: try again later, or type your own price.`
          : `CardFlip has no trusted market price for this card, so it can't work out your ${marketplaceLabel(mp)} price. Type your own price and try again.`,
      );
    }
  }
  const picked = pickLocalAsk(mp, account, rate, { locked: typed, priceUsd: card.price, valueUsd: mv?.ok ? mv.value : null });
  if (!picked) throw new LocalPriceError(`CardFlip can't work out your ${marketplaceLabel(mp)} price for this card. Type your own price and try again.`);
  return { price: picked.price, rate, rateDate: date, usdValue: mv?.ok ? mv.value : null, basis: picked.basis };
}

/**
 * The site an offer belongs on. An offer that was PUBLISHED keeps the site it
 * was created on (an offer cannot move, and its price, currency and policies
 * are that site's). One that was never published follows the seller's
 * CURRENT market: if that differs from where it was made (a US offer pushed
 * before the seller's site went live), `staleOffer` names the old site so the
 * push can delete it and create the right one (ebaySell.ts pushDraft).
 */
export async function marketFor(userId: string, card: CardRecord): Promise<SellerMarket & { staleOffer?: Marketplace }> {
  if (!card.ebayOfferId) return sellerMarket(userId);
  const stored = marketplaceByEbayId(card.ebayMarketplace);
  if (card.ebayListingId) {
    return { mp: stored, account: isLocalMarketplace(stored) ? await sellerAccountType(userId) : null };
  }
  const here = await sellerMarket(userId);
  if (here.mp.marketplaceId === stored.marketplaceId) return { mp: stored, account: isLocalMarketplace(stored) ? here.account : null };
  return { ...here, staleOffer: stored };
}

/**
 * What a seller's push of THIS card would list at, by the same code the push
 * runs (marketFor + resolveLocalAsk), so the number the editor and the confirm
 * step show is by construction the number that is sent. `local: false` = the
 * card lists on eBay US exactly as before (no number here).
 */
export type CardSiteQuote =
  | { local: false }
  | { local: true; key: string; currency: string; label: string; price: number; text: string; basis: "typed" | "market"; floor: number; rateDate: string }
  | { local: true; key: string; currency: string; label: string; error: string };

export async function quoteCardForSite(userId: string, card: CardRecord, strategy: PriceStrategy = "market"): Promise<CardSiteQuote> {
  const here = await marketFor(userId, card);
  const mp = here.mp;
  if (!isLocalMarketplace(mp)) return { local: false };
  const base = { local: true as const, key: mp.key, currency: mp.currency, label: marketplaceLabel(mp) };
  try {
    const ask = await resolveLocalAsk(card, mp, here.account, strategy);
    return { ...base, price: ask.price, text: formatLocalAmount(mp, ask.price), basis: ask.basis, floor: listingFloorFor(mp, here.account), rateDate: ask.rateDate };
  } catch (err) {
    if (err instanceof FxUnavailableError || err instanceof LocalPriceError) return { ...base, error: err.message };
    throw err;
  }
}

/**
 * The floor check for a USD price a seller saves on the ledger (POST /api/cards,
 * PATCH /api/cards/[id]). A US seller gets the original sentence; a seller on a
 * local site is checked in THEIR currency at today's rate against that site's
 * break-even. No rate to hand = the US check only (saving a ledger price must
 * not depend on the rate; the listing itself refuses later).
 */
export async function ledgerFloorProblem(userId: string, usdPrice: number): Promise<string | null> {
  const { mp, account } = await sellerMarket(userId, { refreshIdentity: false });
  return floorProblemOn(mp, account, usdPrice);
}

/** The same check for a card whose offer already exists: THAT offer's site (stored on the card), not the seller's current one. */
export async function listedFloorProblem(
  userId: string,
  card: Pick<CardRecord, "ebayMarketplace">,
  usdPrice: number,
): Promise<string | null> {
  const mp = marketplaceByEbayId(card.ebayMarketplace);
  return floorProblemOn(mp, mp.key === "US" ? null : await sellerAccountType(userId), usdPrice);
}

async function floorProblemOn(mp: Marketplace, account: EbayAccountType | null, usdPrice: number): Promise<string | null> {
  const usCheck = () => (belowFloor(usdPrice) ? floorRefusal() : null);
  if (mp.key === "US") return usCheck();
  const rate = (await getFxRates())?.rates[mp.currency];
  if (!(typeof rate === "number" && rate > 0)) return usCheck();
  return belowFloorFor(mp, toLocal(usdPrice, rate), account) ? floorRefusalFor(mp, account) : null;
}
