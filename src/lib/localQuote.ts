import { listingFloorFor } from "./fees.ts";
import { strategyValueUsd } from "./listing.ts";
import { pickLocalAsk } from "./localPricing.ts";
import { formatLocalAmount, type EbayAccountType, type Marketplace } from "./marketplaces.ts";
import type { Condition, PriceStrategy } from "./types.ts";

/** What the client knows about a seller's local site (from /api/ebay/market). Pure data, no React. */
export interface LocalMarketInfo {
  mp: Marketplace;
  account: EbayAccountType | null;
  /** Local units per 1 USD; null = the rate is too old for the server to price a listing. */
  rate: number | null;
  rateDate: string | null;
}

export interface LocalListingQuote {
  /** The asking price in the site's currency. */
  price: number;
  /** "£3.99" */
  text: string;
  /** The site's break-even in local currency. */
  floor: number;
}

/**
 * The pure client estimate of what the server will list at: the SAME rule
 * (localPricing.ts pickLocalAsk) the server's resolveLocalAsk runs. `locked`
 * is the card's price_locked: only a price the seller typed or picked is
 * converted as typed; a row that merely HOLDS a price (the live refresh wrote
 * it, a resumed editor shows it) is priced from the market value, with the
 * Quick Sale pick applied (strategyValueUsd). Null when there is no rate or
 * nothing to price from. The editors and the confirm step show the SERVER's
 * own answer (client/localMarket.ts fetchLocalAsk) rather than this; this
 * serves the reprice sheet (always a typed price) and the test that pins
 * client = server (scripts/test-ebay-local.mjs).
 */
export function quoteLocalListing(
  info: LocalMarketInfo,
  input: {
    locked: boolean;
    priceUsd?: number | null;
    marketUsd?: number | null;
    condition: Condition | string;
    strategy?: PriceStrategy;
  },
): (LocalListingQuote & { basis: "typed" | "market" }) | null {
  if (!info.rate) return null;
  const valueUsd = input.marketUsd != null && input.marketUsd > 0 ? strategyValueUsd(input.marketUsd, input.condition, input.strategy ?? "market") : null;
  const picked = pickLocalAsk(info.mp, info.account, info.rate, { locked: input.locked, priceUsd: input.priceUsd ?? 0, valueUsd });
  if (!picked) return null;
  return { price: picked.price, basis: picked.basis, text: formatLocalAmount(info.mp, picked.price), floor: listingFloorFor(info.mp, info.account) };
}
