import "server-only";
import { db } from "@/lib/db";
import { belowFloor, belowFloorFor, floorRefusal, floorRefusalFor } from "@/lib/fees";
import { strategyValueUsd } from "@/lib/listing";
import type { PriceStrategy } from "@/lib/types";
import { toLocal, localAsk } from "@/lib/localPricing";
import {
  LOCAL_MARKET_COUNTRIES,
  US_MARKETPLACE,
  marketplaceByEbayId,
  marketplaceFor,
  marketplaceLabel,
  type EbayAccountType,
  type Marketplace,
} from "@/lib/marketplaces";
import type { CardRecord } from "@/lib/server/cards";
import { getEbayAccountFacts, refreshEbayIdentityIfMissing } from "@/lib/server/ebayAuth";
import { getFxRates, listingFxRate } from "@/lib/server/fx";
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

const lastOf = (prices: (number | null)[]): number | null => {
  for (let j = prices.length - 1; j >= 0; j--) if (prices[j] != null) return prices[j];
  return null;
};

/**
 * The card's USD market value through its condition (the value before any
 * fees or postage), from our own daily series; null when the card has no
 * series or the price guard does not believe it. Never reads cards.price.
 */
export async function marketValueUsd(
  card: Pick<CardRecord, "catalogCardId" | "variant" | "game" | "condition">,
  /** The seller's Quick Sale pick (an undercut preference they chose, not a fact the client reports). */
  strategy: PriceStrategy = "market",
): Promise<number | null> {
  if (!card.catalogCardId) return null;
  const row = { catalog_card_id: card.catalogCardId, variant: card.variant, game: card.game };
  const series = await usdSeries([card.catalogCardId], preferredVariants([row]));
  const s = heldSeries(series, row);
  const market = s ? lastOf(s.prices) : null;
  if (market == null || !(market > 0)) return null;
  const trust = await heldTrust([row]);
  if (trust.flag(row)) return null;
  const value = strategyValueUsd(market, card.condition, strategy);
  return value > 0 ? value : null;
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
 * The price to send to `mp` for this card, in the site's currency.
 *  - A price the seller typed (price_locked) is a USD figure: converted at
 *    today's rate, checked against the local floor by the caller.
 *  - Otherwise: the USD MARKET value x today's rate, through the site's fee
 *    model and cheap-card taper (never cards.price, which the live refresh
 *    writes with the US fee model).
 * Throws FxUnavailableError (rate missing/stale) or LocalPriceError (no market).
 */
export async function resolveLocalAsk(
  card: CardRecord,
  mp: Marketplace,
  account: EbayAccountType | null,
  strategy: PriceStrategy = "market",
): Promise<LocalAsk> {
  const { rate, date } = await listingFxRate(mp.currency, marketplaceLabel(mp));
  if (card.priceLocked && card.price > 0) {
    return { price: toLocal(card.price, rate), rate, rateDate: date, usdValue: null, basis: "typed" };
  }
  const usdValue = await marketValueUsd(card, strategy);
  if (usdValue == null) {
    throw new LocalPriceError(
      `CardFlip has no trusted market price for this card, so it can't work out your ${marketplaceLabel(mp)} price. Type your own price and try again.`,
    );
  }
  return { price: localAsk(mp, account, usdValue, rate), rate, rateDate: date, usdValue, basis: "market" };
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
