/**
 * The eBay marketplace table (docs/EBAY_COUNTRIES_PLAN.md, increment 1).
 *
 * Pure data + one pure picker; nothing here touches the network or the DB, so
 * client and server share it. In this increment ONLY the US row is live:
 * every eBay call a seller makes reads its literals (marketplace id, currency,
 * Content-Language, site domain, USPS service code, ...) from US_MARKETPLACE,
 * and scripts/test-ebay-golden.mjs proves the bytes sent are unchanged. The
 * other rows are the facts gathered for increment 2+ (see the plan's Facts
 * section and docs/ebay-marketplaces-0930.json); nothing routes to them yet.
 *
 * Numbers marked `unverified` (fee rates, per-order fees, postage, taper
 * thresholds for every non-US row) are best estimates that MUST be confirmed
 * against a real seller's statement before that marketplace goes live.
 */

export type MarketplaceKey = "US" | "CA" | "GB" | "IE" | "AU" | "NZ";

/** eBay's `accountType` from Commerce Identity getUser (Unknown = business, the conservative price). */
export type EbayAccountType = "INDIVIDUAL" | "BUSINESS";

export interface FeeModel {
  /** Final value fee as a share of the sale price (0.1325 = 13.25%). */
  rate: number;
  /** Per-order fee on an order up to `flatStep`, in the local currency. */
  flat: number;
  /** Per-order fee on an order over `flatStep`. */
  flatOver: number;
  /** Order value (local currency) where the per-order fee steps up. */
  flatStep: number;
}

export interface Marketplace {
  key: MarketplaceKey;
  /** eBay's marketplace id, sent as X-EBAY-C-MARKETPLACE-ID and in offers. */
  marketplaceId: string;
  currency: string;
  /** Content-Language / Accept-Language on Inventory API writes. */
  contentLanguage: string;
  /** eBay site domain, without "www." */
  domain: string;
  /** Country of the seller's ship-from location. */
  locationCountry: string;
  /** What the seller pays to post one card, local currency. */
  postage: number;
  /** Fee models by account type; UK and AU private sellers pay no final value fee. */
  fees: { private: FeeModel; business: FeeModel };
  /**
   * Cheap-card listing taper (see fees.ts): under `coveredMax` the whole cost
   * goes on top of the value, tapering to nothing at `end`. Hard-coded per
   * marketplace in whole units, never derived from FX.
   */
  taper: { coveredMax: number; end: number };
  /** Domestic untracked-letter shipping service the default policy uses. */
  shipping: {
    carrierCode: string | null;
    serviceCode: string;
    /** Tried when the account refuses `serviceCode`; null = no fallback. */
    fallbackServiceCode: string | null;
    /** Flat cost the default fulfillment policy charges the buyer, as eBay's decimal string; null = not decided yet. */
    policyCost: string | null;
  };
  /** Postal code label in prompts. */
  postalLabel: "ZIP" | "Postcode";
  /** Only the US row is live in increment 1; everything else is data for later increments. */
  live: boolean;
  /** True when the facts in this row have not been confirmed by a real seller. */
  unverified: boolean;
}

const same = (m: FeeModel): { private: FeeModel; business: FeeModel } => ({ private: m, business: m });
const NO_FEE: FeeModel = { rate: 0, flat: 0, flatOver: 0, flatStep: 10 };

export const US_MARKETPLACE: Marketplace = {
  key: "US",
  marketplaceId: "EBAY_US",
  currency: "USD",
  contentLanguage: "en-US",
  domain: "ebay.com",
  locationCountry: "US",
  postage: 0.75,
  fees: same({ rate: 0.1325, flat: 0.3, flatOver: 0.4, flatStep: 10 }),
  taper: { coveredMax: 5, end: 10 },
  shipping: {
    carrierCode: "USPS",
    serviceCode: "USPSGroundAdvantage",
    fallbackServiceCode: "USPSPriority",
    policyCost: "4.99",
  },
  postalLabel: "ZIP",
  live: true,
  unverified: false,
};

export const MARKETPLACES: Record<MarketplaceKey, Marketplace> = {
  US: US_MARKETPLACE,
  CA: {
    key: "CA",
    marketplaceId: "EBAY_CA",
    currency: "CAD",
    contentLanguage: "en-CA",
    domain: "ebay.ca",
    locationCountry: "CA",
    postage: 2.61,
    fees: same({ rate: 0.1325, flat: 0.3, flatOver: 0.4, flatStep: 10 }),
    taper: { coveredMax: 7, end: 14 },
    shipping: { carrierCode: null, serviceCode: "CA_PostLettermail", fallbackServiceCode: null, policyCost: null },
    postalLabel: "Postcode",
    live: false,
    unverified: true,
  },
  GB: {
    key: "GB",
    marketplaceId: "EBAY_GB",
    currency: "GBP",
    contentLanguage: "en-GB",
    domain: "ebay.co.uk",
    locationCountry: "GB",
    postage: 1.55,
    fees: { private: NO_FEE, business: { rate: 0.128, flat: 0.3, flatOver: 0.4, flatStep: 10 } },
    taper: { coveredMax: 4, end: 8 },
    shipping: { carrierCode: null, serviceCode: "UK_RoyalMail2ndClassLargeLetter", fallbackServiceCode: null, policyCost: null },
    postalLabel: "Postcode",
    live: false,
    unverified: true,
  },
  IE: {
    key: "IE",
    marketplaceId: "EBAY_IE",
    currency: "EUR",
    contentLanguage: "en-IE",
    domain: "ebay.ie",
    locationCountry: "IE",
    postage: 3.5,
    fees: same({ rate: 0.1295, flat: 0.3, flatOver: 0.4, flatStep: 10 }),
    taper: { coveredMax: 4, end: 9 },
    shipping: { carrierCode: null, serviceCode: "IE_FirstClassLetterService", fallbackServiceCode: null, policyCost: null },
    postalLabel: "Postcode",
    live: false,
    unverified: true,
  },
  AU: {
    key: "AU",
    marketplaceId: "EBAY_AU",
    currency: "AUD",
    contentLanguage: "en-AU",
    domain: "ebay.com.au",
    locationCountry: "AU",
    postage: 3.7,
    fees: { private: NO_FEE, business: { rate: 0.134, flat: 0.3, flatOver: 0.4, flatStep: 10 } },
    taper: { coveredMax: 8, end: 15 },
    shipping: { carrierCode: null, serviceCode: "AU_AusPostStandardLetter", fallbackServiceCode: null, policyCost: null },
    postalLabel: "Postcode",
    live: false,
    unverified: true,
  },
  // NZ sellers would list on eBay Australia in AUD, shipping internationally
  // from NZ. Nobody has verified it, so marketplaceFor() keeps NZ on EBAY_US.
  NZ: {
    key: "NZ",
    marketplaceId: "EBAY_AU",
    currency: "AUD",
    contentLanguage: "en-AU",
    domain: "ebay.com.au",
    locationCountry: "NZ",
    postage: 3.7,
    fees: { private: NO_FEE, business: { rate: 0.134, flat: 0.3, flatOver: 0.4, flatStep: 10 } },
    taper: { coveredMax: 8, end: 15 },
    shipping: { carrierCode: null, serviceCode: "AU_IntlEconomyUntracked", fallbackServiceCode: null, policyCost: null },
    postalLabel: "Postcode",
    live: false,
    unverified: true,
  },
};

/** Countries that can ever route to a local marketplace (NZ is out of scope until a NZ seller tests it). */
export const LOCAL_MARKET_COUNTRIES: readonly MarketplaceKey[] = ["CA", "GB", "IE", "AU"];

/**
 * Which marketplace a seller lists on. EBAY_US unless ALL of: the
 * `ebay_local_markets` switch is on, the seller's home country is CA / GB / IE /
 * AU, and the marketplace their eBay account registered on (Commerce Identity
 * `registrationMarketplaceId`) is that same site. A disagreement, a missing
 * registration or NZ stays on US. Nothing passes switchOn=true in increment 1.
 */
export function marketplaceFor(input: {
  homeCountry?: string | null;
  ebayRegistrationMarketplace?: string | null;
  switchOn?: boolean;
}): Marketplace {
  if (input.switchOn !== true) return US_MARKETPLACE;
  const home = (input.homeCountry ?? "").trim().toUpperCase();
  if (!(LOCAL_MARKET_COUNTRIES as readonly string[]).includes(home)) return US_MARKETPLACE;
  const row = MARKETPLACES[home as MarketplaceKey];
  const registered = (input.ebayRegistrationMarketplace ?? "").trim().toUpperCase();
  return registered === row.marketplaceId ? row : US_MARKETPLACE;
}

/** The fee model for a marketplace + account type; unknown account = business (the higher price). */
export function feeModelFor(mp: Marketplace, account?: EbayAccountType | null): FeeModel {
  return account === "INDIVIDUAL" ? mp.fees.private : mp.fees.business;
}
