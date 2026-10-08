/**
 * eBay Sell Inventory API payloads for a CardFlip listing draft.
 *
 * Pure: takes the draft the editor already shows the seller (title,
 * description, price, category) plus the facts about the copy, and returns
 * the JSON bodies for `createOrReplaceInventoryItem` and `createOffer`. The
 * HTTP side lives in lib/server/ebaySell.ts; this module is kept free of
 * server imports so scripts/test-ebay-inventory.mjs can exercise it.
 *
 * eBay specifics that shaped this:
 *  - Trading-card categories don't use the generic New/Used ladder. eBay's
 *    condition enum maps onto two card conditions — 4000 (USED_VERY_GOOD) reads
 *    as "Ungraded" and 2750 (LIKE_NEW) as "Graded" — and the real detail goes in
 *    `conditionDescriptors`, whose names and values are numeric ids from eBay's
 *    trading-card condition-descriptor table (Metadata API
 *    getItemConditionPolicies). The ids below are from eBay's published table;
 *    if a push ever 400s on a descriptor, verify them against that call.
 *  - Sealed product is plain NEW in its own categories.
 *  - Inventory-item titles cap at 80, `product.description` at 4000, aspect
 *    values at 65. The offer's `listingDescription` is HTML and is what buyers
 *    actually see.
 *  - The offer is created but NOT published here. Publishing is a separate,
 *    explicit call (fees start, listing goes live) — see ebaySell.ts.
 */

import type {
  Condition,
  GameId,
  GradedInfo,
  ItemKind,
  ListingDraft,
  PriceStrategy,
  ScanLanguage,
} from "@/lib/types";
import { SITE_URL } from "./siteUrl.ts";
import { belowFloor, belowFloorFor, floorRefusal, floorRefusalFor, listingFloorFor } from "./fees.ts";
import { US_MARKETPLACE, currencySymbol, merchantLocationKeyFor, policyNameFor, type EbayAccountType, type Marketplace } from "./marketplaces.ts";
import { GAMES, printedCardNumber } from "./games.ts";
import { ebayFeatures, ebayFinish, ebayRarityWord } from "./ebayVocab.ts";

/** The US row is the only live marketplace in increment 1 (src/lib/marketplaces.ts). */
export const EBAY_MARKETPLACE_ID = US_MARKETPLACE.marketplaceId;

/** The categories buildListing/buildSealedListing can produce. */
export const ALLOWED_CATEGORY_IDS = new Set(["183454", "183456", "261044"]);

/** What the editor knows about the copy being listed. */
export interface DraftInput {
  /** The CardFlip ledger id — becomes the SKU so a re-push updates in place. */
  cardId: string;
  listing: ListingDraft;
  card: {
    name: string;
    englishName: string | null;
    setName: string;
    number: string;
    rarity: string | null;
    imageLarge: string;
    imageSmall: string;
    /** MTG type line, for the Card Type aspect. */
    typeLine?: string | null;
    /** Printed set total (86 for "083/086"), for the padded Card Number specific. */
    setTotal?: number | null;
  };
  /** Which game — drives the Game aspect and MTG-only specifics. Pokémon when absent. */
  game?: GameId;
  /** MTG finish of the copy ("nonfoil" | "foil" | "etched"). */
  finish?: string | null;
  /** Pokémon: the quote's printing label ("Holofoil", "Reverse Holofoil", "Poké Ball Pattern", "Normal") — drives Finish. */
  printing?: string | null;
  /**
   * Whether the seller's own photo of this copy is stored on the server
   * (lib/server/cardPhotos.ts). Server-set from disk, never trusted from the
   * client — it decides whether the item has a listing image at all.
   */
  hasPhoto: boolean;
  /**
   * The seller's Quick Sale pick, which only matters when the price is worked
   * out on the server (a local eBay site): it undercuts the market value the
   * way the US quote does. Absent = full value.
   */
  strategy?: PriceStrategy;
  /** Identical copies sold on this one listing (1–99); defaults to 1. */
  quantity?: number;
  kind: ItemKind;
  condition: Condition;
  grading: GradedInfo | null;
  firstEdition: boolean;
  productType: string | null;
  language: ScanLanguage;
}

// ---------------------------------------------------------------------------
// Condition → eBay condition + descriptors

/** eBay's "Ungraded" card condition (enum USED_VERY_GOOD = 4000). */
const CONDITION_UNGRADED = "USED_VERY_GOOD";
/** eBay's "Graded" card condition (enum LIKE_NEW = 2750). */
const CONDITION_GRADED = "LIKE_NEW";

const DESCRIPTOR_CARD_CONDITION = "40001";
const DESCRIPTOR_GRADER = "27501";
const DESCRIPTOR_GRADE = "27502";

/**
 * eBay's ungraded card conditions, mapped from our five-step scale. The value
 * ids are CATEGORY-SPECIFIC: 400011/400012/400013 (Excellent/Very Good/Poor)
 * belong to the sports-card categories (183050, 261328) and are NOT accepted
 * in 183454 (CCG singles) — which is why the 08-27 push of a non-NM card got
 * eBay's opaque 500 until the ladder stripped condition detail. 183454 uses
 * its own played-scale ids (eBay's condition-descriptor table, verified
 * 09-01): Lightly Played 400015, Moderately Played 400016, Heavily Played
 * 400017.
 */
const CARD_CONDITION_VALUE: Record<Condition, string> = {
  "Near Mint": "400010", // Near Mint or Better
  "Lightly Played": "400015", // Lightly Played (Excellent)
  "Moderately Played": "400016", // Moderately Played (Very Good)
  "Heavily Played": "400017", // Heavily Played (Poor)
  Damaged: "400017", // Heavily Played (Poor) — eBay has no lower rung in 183454
};

const GRADER_VALUE: Record<GradedInfo["company"], string> = {
  PSA: "275010",
  CGC: "275015",
};

/**
 * eBay's grade ladder: 10 → 275020, then every half step down to 1 → 2750218.
 * Index i in this list is grade 10 - i/2. CGC's "10 Pristine" is grade 10 to
 * eBay (the descriptor has no Pristine value).
 */
const GRADE_VALUES = [
  "275020", // 10
  "275021", // 9.5
  "275022", // 9
  "275023", // 8.5
  "275024", // 8
  "275025", // 7.5
  "275026", // 7
  "275027", // 6.5
  "275028", // 6
  "275029", // 5.5
  "2750210", // 5
  "2750211", // 4.5
  "2750212", // 4
  "2750213", // 3.5
  "2750214", // 3
  "2750215", // 2.5
  "2750216", // 2
  "2750217", // 1.5
  "2750218", // 1
];

export function gradeDescriptorValue(grade: string): string | null {
  const numeric = parseFloat(grade);
  if (!Number.isFinite(numeric) || numeric > 10 || numeric < 1) return null;
  const steps = Math.round((10 - numeric) * 2);
  if (Math.abs((10 - numeric) * 2 - steps) > 1e-6) return null;
  return GRADE_VALUES[steps] ?? null;
}

export interface ConditionDescriptor {
  name: string;
  values: string[];
}

export interface EbayCondition {
  condition: string;
  conditionDescriptors?: ConditionDescriptor[];
}

export function ebayCondition(input: DraftInput): EbayCondition {
  if (input.kind === "sealed") return { condition: "NEW" };

  if (input.grading) {
    const descriptors: ConditionDescriptor[] = [
      { name: DESCRIPTOR_GRADER, values: [GRADER_VALUE[input.grading.company]] },
    ];
    const grade = gradeDescriptorValue(input.grading.grade);
    if (grade) descriptors.push({ name: DESCRIPTOR_GRADE, values: [grade] });
    return { condition: CONDITION_GRADED, conditionDescriptors: descriptors };
  }

  return {
    condition: CONDITION_UNGRADED,
    conditionDescriptors: [
      {
        name: DESCRIPTOR_CARD_CONDITION,
        values: [CARD_CONDITION_VALUE[input.condition] ?? CARD_CONDITION_VALUE["Near Mint"]],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Aspects (item specifics)

const LANGUAGE_ASPECT: Record<ScanLanguage, string> = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
};

function clip(value: string, max = 65): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max).trim();
}

/**
 * Item specifics buyers filter on. Only facts we actually know — an empty or
 * guessed aspect is worse than none because eBay's search trusts it.
 */
export function buildAspects(input: DraftInput): Record<string, string[]> {
  const game = GAMES[input.game ?? "pokemon"];
  const aspects: Record<string, string[]> = {
    Game: [game.ebayGameAspect],
    Language: [LANGUAGE_ASPECT[input.language] ?? "English"],
  };
  if (input.card.setName) aspects.Set = [clip(input.card.setName)];

  if (input.kind === "sealed") {
    if (input.productType) aspects.Type = [clip(input.productType)];
    return aspects;
  }

  aspects["Card Name"] = [clip(input.card.englishName || input.card.name)];
  // The number as printed ("083/086") — the form buyers type into the Card
  // Number filter; the bare "083" matches nothing they search.
  if (input.card.number) {
    aspects["Card Number"] = [clip(printedCardNumber({ ...input.card, game: game.id }))];
  }
  const features: string[] = [];
  if (input.firstEdition) features.push("1st Edition");
  if (game.id === "mtg") {
    if (input.card.rarity) aspects.Rarity = [clip(input.card.rarity)];
    // MTG buyers filter on finish and card type; both are facts we hold.
    aspects.Finish = [input.finish === "foil" || input.finish === "etched" ? "Foil" : "Regular"];
    if (input.card.typeLine) {
      const mainType = input.card.typeLine.split(" — ")[0].split(" // ")[0].trim();
      if (mainType) aspects["Card Type"] = [clip(mainType)];
    }
  } else {
    // Pokémon: eBay's sidebar filters are Finish / Features / Graded, so the
    // rarity goes in as eBay's word ("Special Illustration Rare", "Holo
    // Rare"), the finish comes from the picked printing (or a rarity that can
    // only be a holo), and Full Art / Alternative Art follow the rarity. No
    // Card Type: the catalog mirror carries no supertype (09-28), and a
    // guessed specific is worse than none.
    const rarity = ebayRarityWord(input.card.rarity);
    if (rarity) aspects.Rarity = [clip(rarity)];
    const finish = ebayFinish(input.printing, input.card.rarity);
    if (finish) aspects.Finish = [finish];
    features.push(...ebayFeatures(input.card.rarity));
  }
  if (features.length) aspects.Features = features;

  if (input.grading) {
    aspects.Graded = ["Yes"];
    aspects["Professional Grader"] = [
      input.grading.company === "PSA"
        ? "Professional Sports Authenticator (PSA)"
        : "Certified Guaranty Company (CGC)",
    ];
    aspects.Grade = [clip(input.grading.grade.replace(/\s*Pristine$/i, ""))];
  } else {
    aspects.Graded = ["No"];
  }
  return aspects;
}

// ---------------------------------------------------------------------------
// Payloads

export function skuForCard(cardId: string): string {
  // eBay SKUs cap at 50 chars; a UUID is 36.
  return `cardflip-${cardId}`.slice(0, 50);
}

/**
 * The listing's photos: exactly one, the seller's own photo of the copy,
 * served from our origin at `/api/card-image/<ledger id>` for eBay's picture
 * service to fetch. Catalogue art (card.imageLarge/imageSmall) is deliberately
 * never sent — eBay's picture policy requires photos of the actual item for
 * used goods, which every raw or graded card is to eBay; stock art risks the
 * listing being pulled. (It also went live with an EMPTY gallery on the
 * first real listing 08-16: eBay quietly drops what it can't ingest.)
 */
export function imageUrls(input: DraftInput): string[] {
  if (!input.hasPhoto) return [];
  return [`${SITE_URL}/api/card-image/${encodeURIComponent(input.cardId)}`];
}

/** The plain-text description as the HTML eBay renders on the listing. */
export function descriptionHtml(description: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return description
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escape(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export interface InventoryItemPayload {
  availability: { shipToLocationAvailability: { quantity: number } };
  condition: string;
  conditionDescriptors?: ConditionDescriptor[];
  product: {
    title: string;
    description: string;
    imageUrls: string[];
    aspects: Record<string, string[]>;
  };
}

/** The listing quantity a DraftInput carries, clamped to eBay-sane bounds. */
export function listingQuantity(input: Pick<DraftInput, "quantity">): number {
  const q = Math.floor(input.quantity ?? 1);
  return Number.isFinite(q) ? Math.min(99, Math.max(1, q)) : 1;
}

export function buildInventoryItem(input: DraftInput): InventoryItemPayload {
  const { condition, conditionDescriptors } = ebayCondition(input);
  return {
    availability: { shipToLocationAvailability: { quantity: listingQuantity(input) } },
    condition,
    ...(conditionDescriptors ? { conditionDescriptors } : {}),
    product: {
      title: clip(input.listing.title, 80),
      description: clip(input.listing.description, 4000),
      imageUrls: imageUrls(input),
      aspects: buildAspects(input),
    },
  };
}

/**
 * Listing API `createItemDraft` body (sell/listing/v1_beta/item_draft). This
 * is what a seller sees on eBay itself: the draft appears under My eBay ›
 * Drafts / Seller Hub and opens pre-filled in eBay's listing tool, where they
 * finish and publish it (Chris's expectation, 08-16: "hit Send draft, it
 * should be in the eBay drafts"). Same title/description/condition/aspects/
 * photo as the inventory item, so both roads describe the copy identically.
 */
export interface ItemDraftPayload {
  categoryId: string;
  condition: string;
  conditionDescriptors?: ConditionDescriptor[];
  format: "FIXED_PRICE";
  marketplaceId: string;
  pricingSummary: { price: { currency: string; value: string } };
  product: {
    title: string;
    description: string;
    imageUrls: string[];
    aspects: Record<string, string[]>;
  };
}

export function buildItemDraft(input: DraftInput): ItemDraftPayload {
  const { condition, conditionDescriptors } = ebayCondition(input);
  return {
    categoryId: input.listing.categoryId,
    condition,
    ...(conditionDescriptors ? { conditionDescriptors } : {}),
    format: "FIXED_PRICE",
    marketplaceId: EBAY_MARKETPLACE_ID,
    pricingSummary: { price: { currency: US_MARKETPLACE.currency, value: input.listing.price.toFixed(2) } },
    product: {
      title: clip(input.listing.title, 80),
      description: descriptionHtml(input.listing.description),
      imageUrls: imageUrls(input),
      aspects: buildAspects(input),
    },
  };
}

export interface ListingPolicies {
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  bestOfferTerms?: BestOfferTerms;
  shippingCostOverrides?: ShippingCostOverride[];
}

export interface BestOfferTerms {
  bestOfferEnabled: true;
  autoAcceptPrice?: { currency: string; value: string };
  autoDeclinePrice?: { currency: string; value: string };
}

export interface ShippingCostOverride {
  priority: number;
  shippingServiceType: "DOMESTIC";
  shippingCost: { currency: string; value: string };
}

/**
 * The seller's opt-in listing terms (users.accept_offers / tracked_ship_*).
 * Absent or null = off, and an off feature adds NOT ONE BYTE to any payload
 * (scripts/test-ebay-golden.mjs pins that). `trackedShipping` is only ever
 * filled in by the server when EBAY_VALUE_SHIPPING=1.
 */
export interface SellerListingPrefs {
  offers?: { acceptPercent: number; declinePercent: number } | null;
  trackedShipping?: { over: number; cost: number } | null;
}

/** Defaults offered when a seller turns Accept Offers on. */
export const DEFAULT_OFFER_ACCEPT_PERCENT = 90;
export const DEFAULT_OFFER_DECLINE_PERCENT = 70;

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Best Offer terms for ONE listing, computed from its price: auto-accept at
 * acceptPercent (never under the fee floor, so a seller can't be auto-sold into
 * a loss) and auto-decline under declinePercent. eBay needs accept < price and
 * decline < accept, so a price too small to leave room for a distinct accept
 * point just enables Best Offer without that threshold.
 */
export function bestOfferTermsFor(
  price: number,
  offers: { acceptPercent: number; declinePercent: number },
  marketplace: Marketplace = US_MARKETPLACE,
  account?: EbayAccountType | null,
): BestOfferTerms {
  const money = (n: number) => ({ currency: marketplace.currency, value: n.toFixed(2) });
  const terms: BestOfferTerms = { bestOfferEnabled: true };
  const accept = Math.max(cents((price * offers.acceptPercent) / 100), listingFloorFor(marketplace, account));
  const hasAccept = accept < price - 0.005;
  if (hasAccept) terms.autoAcceptPrice = money(accept);
  const decline = cents((price * offers.declinePercent) / 100);
  if (decline > 0 && decline < (hasAccept ? accept : price) - 0.005) terms.autoDeclinePrice = money(decline);
  return terms;
}

/** The fields a seller's prefs put on an offer's listingPolicies at this price (empty when nothing applies). */
export function sellerPolicyExtras(
  price: number,
  prefs: SellerListingPrefs | null | undefined,
  marketplace: Marketplace = US_MARKETPLACE,
  account?: EbayAccountType | null,
): Pick<ListingPolicies, "bestOfferTerms" | "shippingCostOverrides"> {
  const out: Pick<ListingPolicies, "bestOfferTerms" | "shippingCostOverrides"> = {};
  if (prefs?.offers) out.bestOfferTerms = bestOfferTermsFor(price, prefs.offers, marketplace, account);
  // The tracked rate is a US-dollar figure the seller typed; only the US site uses it.
  if (prefs?.trackedShipping && marketplace.key === "US" && price > prefs.trackedShipping.over) {
    out.shippingCostOverrides = [
      { priority: 1, shippingServiceType: "DOMESTIC", shippingCost: { currency: marketplace.currency, value: prefs.trackedShipping.cost.toFixed(2) } },
    ];
  }
  return out;
}

/**
 * An existing offer's listingPolicies re-aimed at a new price (reprice): the
 * seller's best-offer thresholds follow the price, and the tracked-postage
 * override is added or dropped as the price crosses the threshold. Features the
 * seller has off are left exactly as eBay returned them; with both off this
 * returns the input untouched.
 */
export function repriceListingPolicies(
  current: unknown,
  price: number,
  prefs: SellerListingPrefs | null | undefined,
  marketplace: Marketplace = US_MARKETPLACE,
  account?: EbayAccountType | null,
): unknown {
  if (!prefs?.offers && !prefs?.trackedShipping) return current;
  const next: Record<string, unknown> = { ...((current as Record<string, unknown> | undefined) ?? {}) };
  if (prefs.trackedShipping && marketplace.key === "US") delete next.shippingCostOverrides;
  return { ...next, ...sellerPolicyExtras(price, prefs, marketplace, account) };
}

export interface OfferPayload {
  sku: string;
  marketplaceId: string;
  format: "FIXED_PRICE";
  availableQuantity: number;
  categoryId: string;
  listingDescription: string;
  listingDuration: "GTC";
  pricingSummary: { price: { currency: string; value: string } };
  listingPolicies?: ListingPolicies;
  merchantLocationKey?: string;
}

/**
 * The offer for one eBay site. `marketplace` defaults to the US row (every
 * call that predates per-country listing); for another site `input.listing.price`
 * is in THAT site's currency (the server prices it, see ebayMarket.ts).
 */
export function buildOffer(
  input: DraftInput,
  extras: {
    policies?: ListingPolicies;
    merchantLocationKey?: string | null;
    /** The seller's opt-in Best Offer / tracked-postage terms; off (absent) changes nothing. */
    prefs?: SellerListingPrefs | null;
    account?: EbayAccountType | null;
  } = {},
  marketplace: Marketplace = US_MARKETPLACE,
): OfferPayload {
  const policies: Record<string, unknown> = {
    ...(extras.policies ? Object.fromEntries(Object.entries(extras.policies).filter(([, v]) => Boolean(v))) : {}),
    ...sellerPolicyExtras(input.listing.price, extras.prefs, marketplace, extras.account),
  };
  return {
    sku: skuForCard(input.cardId),
    marketplaceId: marketplace.marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: listingQuantity(input),
    categoryId: input.listing.categoryId,
    listingDescription: descriptionHtml(input.listing.description),
    listingDuration: "GTC",
    pricingSummary: {
      price: { currency: marketplace.currency, value: input.listing.price.toFixed(2) },
    },
    ...(Object.keys(policies).length ? { listingPolicies: policies as ListingPolicies } : {}),
    ...(extras.merchantLocationKey ? { merchantLocationKey: extras.merchantLocationKey } : {}),
  };
}

/**
 * updateOffer replaces the offer, but sku/marketplaceId/format are fixed at
 * creation and eBay rejects attempts to send them again.
 */
export function offerUpdateBody(
  offer: OfferPayload,
): Omit<OfferPayload, "sku" | "marketplaceId" | "format"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sku, marketplaceId, format, ...rest } = offer;
  return rest;
}

/**
 * Everything that must hold before we spend an API call on it. For a non-US
 * `marketplace` the price is in that site's currency and the floor is that
 * site's break-even (fees.ts …For variants); the US call is unchanged.
 */
export function validateDraftInput(
  input: DraftInput,
  marketplace: Marketplace = US_MARKETPLACE,
  account?: EbayAccountType | null,
): string | null {
  const local = marketplace.key !== "US";
  if (!input.cardId) return "Missing card id";
  if (!input.listing?.title?.trim()) return "Listing has no title";
  if (input.listing.title.length > 80) return "Title is over eBay's 80-character limit";
  if (!input.listing.description?.trim()) return "Listing has no description";
  if (!Number.isFinite(input.listing.price) || input.listing.price <= 0) {
    return local ? `Set a price above ${currencySymbol(marketplace)}0 first` : "Set a price above $0 first";
  }
  // Never under the fee floor (Chris, 09-08) — drafts and publishes included.
  if (local) {
    if (belowFloorFor(marketplace, input.listing.price, account)) return floorRefusalFor(marketplace, account);
  } else if (belowFloor(input.listing.price)) {
    return floorRefusal();
  }
  if (!ALLOWED_CATEGORY_IDS.has(input.listing.categoryId)) return "Unknown eBay category";
  if (imageUrls(input).length === 0) {
    return "Add a photo of the actual item first — eBay requires your own photo, not catalogue art";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-site request pieces. Pure, so the sandbox harness (scripts/ebay-sandbox-
// e2e.mjs) sends exactly the bytes the app sends.

/**
 * Headers for every Sell API call. The Inventory API rejects writes without
 * BOTH Content-Language and Accept-Language as the site's language (errorId
 * 25709, seen on the first real push 08-16). The US row reproduces the
 * original headers byte for byte (key order included).
 */
export function ebayRequestHeaders(token: string, marketplace: Marketplace, hasBody: boolean): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Language": marketplace.contentLanguage,
    "Accept-Language": marketplace.contentLanguage,
    "X-EBAY-C-MARKETPLACE-ID": marketplace.marketplaceId,
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}

function policyBase(marketplace: Marketplace) {
  return { marketplaceId: marketplace.marketplaceId, categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }] };
}

/**
 * The shipping-service attempts for the default fulfillment policy, in order.
 * US: Ground Advantage then Priority (some accounts refuse a code). Other
 * sites: the letter code with the carrier, then without it (eBay's Account
 * API takes a carrier name only on some sites), then the site's alternate
 * code. The throwaway-policy check per site is what the sandbox run is for.
 */
export function fulfillmentAttempts(marketplace: Marketplace): { serviceCode: string; carrierCode: string | null }[] {
  const s = marketplace.shipping;
  const out: { serviceCode: string; carrierCode: string | null }[] = [{ serviceCode: s.serviceCode, carrierCode: s.carrierCode }];
  if (marketplace.key === "US") {
    if (s.fallbackServiceCode) out.push({ serviceCode: s.fallbackServiceCode, carrierCode: s.carrierCode });
    return out;
  }
  if (s.carrierCode) out.push({ serviceCode: s.serviceCode, carrierCode: null });
  if (s.fallbackServiceCode) out.push({ serviceCode: s.fallbackServiceCode, carrierCode: null });
  return out;
}

/**
 * Account API createFulfillmentPolicy body: free domestic shipping (the price
 * covers postage), handling 1 day. eBay's LSAS validator rejected the first US shape
 * (08-27, LOGISTICS_INFO_IS_MISSING: buyerResponsibleForShipping is a
 * freight flag, not "buyer pays"); buyer-pays is simply a non-zero flat cost.
 */
export function fulfillmentPolicyBody(marketplace: Marketplace, serviceCode: string, carrierCode: string | null) {
  return {
    ...policyBase(marketplace),
    name: policyNameFor(marketplace, "CardFlip shipping"),
    handlingTime: { value: 1, unit: "DAY" },
    shippingOptions: [
      {
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            sortOrder: 1,
            ...(carrierCode ? { shippingCarrierCode: carrierCode } : {}),
            shippingServiceCode: serviceCode,
            // Free shipping (Chris 10-08): the asking price already carries the postage
            // (lib/fees.ts), so the buyer pays nothing on top. policyCost stays as the
            // site's reference cost; it is not charged.
            shippingCost: { value: "0.00", currency: marketplace.currency },
            freeShipping: true,
          },
        ],
      },
    ],
  };
}

/** Managed payments: eBay ignores payment methods, the policy is a shell. */
export function paymentPolicyBody(marketplace: Marketplace) {
  return { ...policyBase(marketplace), name: policyNameFor(marketplace, "CardFlip payments") };
}

/** 30 days, buyer pays return postage, and NO returnMethods (14 is invalid on GB/AU/CA; the field is unsupported there). */
export function returnPolicyBody(marketplace: Marketplace) {
  return {
    ...policyBase(marketplace),
    name: policyNameFor(marketplace, "CardFlip returns"),
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" },
    returnShippingCostPayer: "BUYER",
  };
}

/**
 * The Inventory API location create body for the seller's ship-from address.
 * `city` is added only when given (IE needs it, see Marketplace.locationNeedsCity),
 * so every other site's body is unchanged.
 */
export function locationBody(postalCode: string, country: string, city?: string) {
  return {
    location: { address: city ? { city, postalCode, country } : { postalCode, country } },
    locationTypes: ["WAREHOUSE"],
    merchantLocationStatus: "ENABLED",
    name: "CardFlip ship-from location",
  };
}

export interface InventoryLocationRow {
  merchantLocationKey?: string;
  merchantLocationStatus?: string;
  location?: { address?: { country?: string } };
}

/**
 * The seller's ship-from location on a non-US site: our own `cardflip-<cc>`
 * key when it is there AND in the site's country, else any enabled location
 * of theirs in that country, else null (the caller creates `cardflip-<cc>`).
 * Filtering by country matters: a seller with a US warehouse and a UK one
 * must not have a GB listing attached to the US address.
 */
export function pickMerchantLocation(locations: InventoryLocationRow[], marketplace: Marketplace): string | null {
  const country = marketplace.locationCountry.toUpperCase();
  const enabled = locations.filter((l) => l.merchantLocationKey && (l.merchantLocationStatus ?? "ENABLED").toUpperCase() === "ENABLED");
  const inCountry = (l: InventoryLocationRow) => (l.location?.address?.country ?? "").toUpperCase() === country;
  const own = merchantLocationKeyFor(marketplace);
  const byKey = enabled.find((l) => l.merchantLocationKey === own && (!l.location?.address?.country || inCountry(l)));
  if (byKey) return own;
  return enabled.find(inCountry)?.merchantLocationKey ?? null;
}

export { merchantLocationKeyFor };

/** eBay's public URL for a live listing. */
export function ebayListingUrl(listingId: string, marketplace: Marketplace = US_MARKETPLACE): string {
  return `https://www.${marketplace.domain}/itm/${encodeURIComponent(listingId)}`;
}
