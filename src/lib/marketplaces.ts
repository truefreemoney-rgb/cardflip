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
 * 09-30 (increment 2): fee rates, per-order fees and domestic letter postage
 * come from eBay's and the carriers' official pages, fetched 2026-09-30; the
 * URL sits beside each row. `unverified` stays true on a row only when a
 * number in it could not be sourced, and `unverifiedNotes` says which. There
 * is no real-seller gate any more (owner, 09-30): the gate is the official
 * fee pages + the eBay sandbox run (scripts/ebay-sandbox-e2e.mjs) + the golden
 * US tests. Every local row is still live:false; the owner flips them.
 *
 * Fee model = final value fee + the regulatory operating fee (folded into
 * `rate`), the per-order fee as flat / flatOver around flatStep. International
 * fees apply only to a cross-border delivery and are NOT modelled (domestic
 * letters only). Fees are modelled on the item price.
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
  /** True when a number in this row could not be sourced from an official page (see unverifiedNotes). */
  unverified: boolean;
  /** What exactly is unsourced or caveated; empty when everything in the row is sourced. */
  unverifiedNotes: string[];
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
  unverifiedNotes: [],
};

export const MARKETPLACES: Record<MarketplaceKey, Marketplace> = {
  US: US_MARKETPLACE,
  // CANADA. Fees: https://www.ebay.ca/help/selling/fees-credits-invoices/selling-fees?id=4822 (fetched 2026-09-30):
  // Toys & Hobbies > Collectible Card Games 13.25% (2.35% only on the part of an item over C$7,500),
  // per-order fee C$0.30 up to C$10.00, C$0.40 over; no private/business split, no regulatory fee shown.
  // Postage: Canada Post Lettermail, non-standard/oversize up to 100g (a toploader in a bubble mailer is thicker
  // than the 5mm standard-size limit) C$2.61 excl. taxes, max 20mm:
  // https://www.canadapost-postescanada.ca/cpc/en/personal/sending/letters-mail/postage-rates.page (fetched 2026-09-30).
  // Taper C$7 / C$14 = the US $5 / $10 at ~1.37, whole units.
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
    shipping: { carrierCode: "CanadaPost", serviceCode: "CA_PostLettermail", fallbackServiceCode: "CA_StandardShipping", policyCost: "2.61" },
    postalLabel: "Postcode",
    live: false,
    unverified: false,
    unverifiedNotes: ["shippingCarrierCode string \"CanadaPost\" is a guess; the policy create retries without it (sandbox run confirms)"],
  },
  // UNITED KINGDOM. Private sellers: https://www.ebay.co.uk/help/selling/fees-credits-invoices/selling-fees?id=4822
  // (fetched 2026-09-30): "You won't pay final value fees or regulatory operating fees when your items sell";
  // no per-order fee (a 3% international fee applies only to deliveries outside the UK, not modelled).
  // Business sellers: https://www.ebay.co.uk/help/selling/fees-credits-invoices/fees-business-sellers-activated-managed-payments?id=4809
  // (fetched 2026-09-30): Collectables (incl. Collectable Card Games) 10.9% + regulatory operating fee 0.35% =
  // 11.25%; per-order fee £0.30 up to £10.00, £0.40 over (since 12 Feb 2026,
  // https://www.ebay.co.uk/sellercentre/news/2026-january/rate-card-change). Business figures exclude VAT. The 10p
  // per-order scheme for UK-registered business sellers (https://pages.ebay.co.uk/ads/2022/10p-order-fee/) is not
  // modelled (it would only lower the price). Postage: Royal Mail 2nd Class Large Letter up to 100g £1.55 (stamp):
  // https://www.royalmail.com/sending/stamp-costs-and-faqs (fetched 2026-09-30). Taper £4 / £8 = $5 / $10 at ~0.78.
  // Shipping code: eBay's own list for the site shows UK_RoyalMail2ndClassLetter (docs/ebay-marketplaces-0930.json); the
  // plan's "…LargeLetter" name appears nowhere in it, so the listed code is primary. The eBay SANDBOX (09-30 run)
  // refused both letter codes ("Please select a valid shipping service"), so the fallback is 2nd Class Standard, the
  // parcel service every UK site accepts; production keeps the letter code whenever eBay takes it.
  GB: {
    key: "GB",
    marketplaceId: "EBAY_GB",
    currency: "GBP",
    contentLanguage: "en-GB",
    domain: "ebay.co.uk",
    locationCountry: "GB",
    postage: 1.55,
    fees: { private: NO_FEE, business: { rate: 0.1125, flat: 0.3, flatOver: 0.4, flatStep: 10 } },
    taper: { coveredMax: 4, end: 8 },
    shipping: { carrierCode: "RoyalMail", serviceCode: "UK_RoyalMail2ndClassLetter", fallbackServiceCode: "UK_RoyalMailSecondClassStandard", policyCost: "1.55" },
    postalLabel: "Postcode",
    live: false,
    unverified: false,
    unverifiedNotes: [
      "business fees are quoted ex-VAT: a business seller not VAT-registered pays 20% VAT on top, which the price does not add",
      "shippingCarrierCode string \"RoyalMail\" is a guess; the policy create retries without it (sandbox run confirms)",
    ],
  },
  // IRELAND. Private: https://www.ebay.ie/help/selling/fees-credits-invoices/selling-fees?id=4822 (fetched 2026-09-30,
  // VAT included): final value fee 11% (2% only on the part over €1,990) + regulatory operating fee 0.43% = 11.43%;
  // per-order fee €0.05 if the order is below €10.00, otherwise €0.35 (so the step sits at 9.99). Business:
  // https://www.ebay.ie/help/selling/fees-credits-invoices/fees-business-sellers-activated-managed-payments?id=4809
  // (fetched 2026-09-30, ex-VAT): 11% (2% over €990; trading cards are not an exception category) + regulatory
  // operating fee 0.35% = 11.35%; per-order €0.35 up to €10.00, €0.45 over. Postage: An Post Large Envelope up to
  // 100g €3.50 (a letter is €1.85 but max 5mm deep): An Post Guide to Postal Rates, effective 3 Feb 2026,
  // https://www.anpost.com/getmedia/dd03f3ab-3027-442a-900a-86cd2f802612/10010982-Guide-Postal-Rates-A4-Feb-2026-P-CVE-02.pdf
  // (fetched 2026-09-30). Taper €4 / €10 = $5 / $10 at ~0.88 (4.4 -> 4); the end is 10, not the 8.8 -> 9 the conversion
  // gives, because €3.50 postage plus fees (~€5.5 on top) would otherwise exceed the €5 taper width and the curve would
  // dip a cent where it meets the value; €4 / €10 keeps it rising everywhere (test:ebaylocal sweeps it).
  // GPSR (EU product safety): https://www.ebay.com/sellercenter/resources/general-product-safety-regulation says business
  // sellers listing in the EU must give the manufacturer or an EU Responsible Person, but antiques "including
  // collectors' items" are excluded; whether a modern trading card is one is a legal call this table cannot make.
  IE: {
    key: "IE",
    marketplaceId: "EBAY_IE",
    currency: "EUR",
    contentLanguage: "en-IE",
    domain: "ebay.ie",
    locationCountry: "IE",
    postage: 3.5,
    fees: {
      private: { rate: 0.1143, flat: 0.05, flatOver: 0.35, flatStep: 9.99 },
      business: { rate: 0.1135, flat: 0.35, flatOver: 0.45, flatStep: 10 },
    },
    taper: { coveredMax: 4, end: 10 },
    shipping: { carrierCode: null, serviceCode: "IE_FirstClassLetterService", fallbackServiceCode: null, policyCost: "3.50" },
    postalLabel: "Postcode",
    live: false,
    unverified: false,
    unverifiedNotes: [
      "GPSR: whether eBay.ie wants manufacturer / EU Responsible Person data on a trading-card listing is not stated for this category; if a publish is refused for it, the offer needs a regulatory block",
      "An Post VAT treatment of the €3.50 postage not found",
    ],
  },
  // AUSTRALIA. No private/business split: https://www.ebay.com.au/help/selling/fees-credits-invoices/selling-fees?id=4822
  // (fetched 2026-09-30): "free for Australia-based sellers with up to $25,000 in sales over the past 12 months" =
  // the INDIVIDUAL (no-fee) model. Above that / on a Pro plan:
  // https://www.ebay.com.au/help/selling/fees-credits-invoices/ebay-pro-selling-fees?id=4809 (fetched 2026-09-30):
  // Collectable Card Games sit under Toys, Hobbies (Tier 2), 11.44% incl. GST on Pro Starter, $0.30 per order, no
  // threshold step = the BUSINESS model. Postage: Australia Post large letter up to 125g A$3.70 incl. GST from
  // 1 Sep 2026: https://auspost.com.au/personal/sending/letters/sending-in-australia/regular (fetched 2026-09-30).
  // Taper A$8 / A$15 = $5 / $10 at ~1.5.
  AU: {
    key: "AU",
    marketplaceId: "EBAY_AU",
    currency: "AUD",
    contentLanguage: "en-AU",
    domain: "ebay.com.au",
    locationCountry: "AU",
    postage: 3.7,
    fees: { private: NO_FEE, business: { rate: 0.1144, flat: 0.3, flatOver: 0.3, flatStep: 10 } },
    taper: { coveredMax: 8, end: 15 },
    shipping: { carrierCode: "AustraliaPost", serviceCode: "AU_AusPostStandardLetter", fallbackServiceCode: null, policyCost: "3.70" },
    postalLabel: "Postcode",
    live: false,
    unverified: true,
    unverifiedNotes: [
      "business 11.44% is the Pro Starter column of Tier 2 as read from the page text; the column mapping (Starter vs Basic vs Featured) is inferred, not confirmed",
      "an account is priced as no-fee when eBay says INDIVIDUAL; a BUSINESS account under A$25,000 a year also pays no fee, so the business price can be a little high (the safe side)",
      "shippingCarrierCode string \"AustraliaPost\" is a guess; the policy create retries without it (sandbox run confirms)",
    ],
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
    unverifiedNotes: ["NZ is out of scope: nobody has listed from NZ; it stays on eBay US (USD) until a NZ seller exists"],
  },
};

/** Countries that can ever route to a local marketplace (NZ is out of scope until a NZ seller tests it). */
export const LOCAL_MARKET_COUNTRIES: readonly MarketplaceKey[] = ["CA", "GB", "IE", "AU"];

/**
 * Which marketplace a seller lists on. EBAY_US unless ALL of: the
 * `ebay_local_markets` switch is on, the seller's home country is CA / GB / IE /
 * AU, and the marketplace their eBay account registered on (Commerce Identity
 * `registrationMarketplaceId`) is that same site. A disagreement, a missing
 * registration or NZ stays on US. Every local row is still live:false, so
 * nothing routes off the US site until the owner flips a row.
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
  // A row goes live only when the owner flips it after the sandbox run: the switch alone never routes to an unreviewed site.
  return row.live && registered === row.marketplaceId ? row : US_MARKETPLACE;
}

/**
 * The marketplace a stored card/offer lives on. NULL, EBAY_US, or anything
 * unrecognised = the US row: every listing that predates per-country selling,
 * and a bad value, both stay on the site they were made on. NZ shares
 * EBAY_AU with AU, so the lookup never returns the NZ row.
 */
export function marketplaceByEbayId(id: string | null | undefined): Marketplace {
  const want = (id ?? "").trim().toUpperCase();
  if (!want || want === US_MARKETPLACE.marketplaceId) return US_MARKETPLACE;
  for (const key of ["CA", "GB", "IE", "AU"] as const) {
    if (MARKETPLACES[key].marketplaceId === want) return MARKETPLACES[key];
  }
  return US_MARKETPLACE;
}

/** True for any site other than eBay US. */
export function isLocalMarketplace(mp: Marketplace): boolean {
  return mp.key !== "US";
}

/** "£" / "€" / "A$" / "C$" / "$" for amounts shown next to US$ (en-US formatting keeps them distinct). */
export function currencySymbol(mp: Marketplace): string {
  const parts = new Intl.NumberFormat("en-US", { style: "currency", currency: mp.currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
  const symbol = parts.find((p) => p.type === "currency")?.value ?? mp.currency;
  // narrowSymbol collapses CAD and AUD to "$"; keep them apart from USD.
  return mp.currency === "CAD" ? "C$" : mp.currency === "AUD" ? "A$" : symbol;
}

/** Local amount as shown to a seller: "£3.99". */
export function formatLocalAmount(mp: Marketplace, value: number): string {
  return `${currencySymbol(mp)}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The seller's inventory-location key on this site. The US keeps its original key. */
export function merchantLocationKeyFor(mp: Marketplace): string {
  return mp.key === "US" ? "cardflip-default" : `cardflip-${mp.key.toLowerCase()}`;
}

/** Policy names carry a site suffix outside the US ("CardFlip shipping GB"); the US names are unchanged. */
export function policyNameFor(mp: Marketplace, base: string): string {
  return mp.key === "US" ? base : `${base} ${mp.key}`;
}

/** "eBay UK" / "eBay Ireland" ... for sentences like "£3.99 on eBay UK". */
export function marketplaceLabel(mp: Marketplace): string {
  return { US: "eBay US", CA: "eBay Canada", GB: "eBay UK", IE: "eBay Ireland", AU: "eBay Australia", NZ: "eBay Australia" }[mp.key];
}

/** The fee model for a marketplace + account type; unknown account = business (the higher price). */
export function feeModelFor(mp: Marketplace, account?: EbayAccountType | null): FeeModel {
  return account === "INDIVIDUAL" ? mp.fees.private : mp.fees.business;
}
