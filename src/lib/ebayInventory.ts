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
  ScanLanguage,
} from "@/lib/types";
import { SITE_URL } from "./siteUrl.ts";
import { GAMES } from "./games.ts";

export const EBAY_MARKETPLACE_ID = "EBAY_US";

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
  };
  /** Which game — drives the Game aspect and MTG-only specifics. Pokémon when absent. */
  game?: GameId;
  /** MTG finish of the copy ("nonfoil" | "foil" | "etched"). */
  finish?: string | null;
  /**
   * Whether the seller's own photo of this copy is stored on the server
   * (lib/server/cardPhotos.ts). Server-set from disk, never trusted from the
   * client — it decides whether the item has a listing image at all.
   */
  hasPhoto: boolean;
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

/** eBay's four ungraded card conditions, mapped from our five-step scale. */
const CARD_CONDITION_VALUE: Record<Condition, string> = {
  "Near Mint": "400010", // Near Mint or Better
  "Lightly Played": "400011", // Excellent
  "Moderately Played": "400012", // Very Good
  "Heavily Played": "400013", // Poor
  Damaged: "400013", // Poor
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
  if (input.card.number) aspects["Card Number"] = [clip(input.card.number)];
  if (input.card.rarity) aspects.Rarity = [clip(input.card.rarity)];
  const features: string[] = [];
  if (input.firstEdition) features.push("1st Edition");
  if (game.id === "mtg") {
    // MTG buyers filter on finish and card type; both are facts we hold.
    aspects.Finish = [input.finish === "foil" || input.finish === "etched" ? "Foil" : "Regular"];
    if (input.card.typeLine) {
      const mainType = input.card.typeLine.split(" — ")[0].split(" // ")[0].trim();
      if (mainType) aspects["Card Type"] = [clip(mainType)];
    }
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

export function buildInventoryItem(input: DraftInput): InventoryItemPayload {
  const { condition, conditionDescriptors } = ebayCondition(input);
  return {
    availability: { shipToLocationAvailability: { quantity: 1 } },
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
  pricingSummary: { price: { currency: "USD"; value: string } };
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
    pricingSummary: { price: { currency: "USD", value: input.listing.price.toFixed(2) } },
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
}

export interface OfferPayload {
  sku: string;
  marketplaceId: string;
  format: "FIXED_PRICE";
  availableQuantity: number;
  categoryId: string;
  listingDescription: string;
  listingDuration: "GTC";
  pricingSummary: { price: { currency: "USD"; value: string } };
  listingPolicies?: ListingPolicies;
  merchantLocationKey?: string;
}

export function buildOffer(
  input: DraftInput,
  extras: { policies?: ListingPolicies; merchantLocationKey?: string | null } = {},
): OfferPayload {
  const policies = extras.policies
    ? Object.fromEntries(Object.entries(extras.policies).filter(([, v]) => Boolean(v)))
    : {};
  return {
    sku: skuForCard(input.cardId),
    marketplaceId: EBAY_MARKETPLACE_ID,
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: input.listing.categoryId,
    listingDescription: descriptionHtml(input.listing.description),
    listingDuration: "GTC",
    pricingSummary: {
      price: { currency: "USD", value: input.listing.price.toFixed(2) },
    },
    ...(Object.keys(policies).length ? { listingPolicies: policies } : {}),
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

/** Everything that must hold before we spend an API call on it. */
export function validateDraftInput(input: DraftInput): string | null {
  if (!input.cardId) return "Missing card id";
  if (!input.listing?.title?.trim()) return "Listing has no title";
  if (input.listing.title.length > 80) return "Title is over eBay's 80-character limit";
  if (!input.listing.description?.trim()) return "Listing has no description";
  if (!Number.isFinite(input.listing.price) || input.listing.price <= 0) {
    return "Set a price above $0 first";
  }
  if (!ALLOWED_CATEGORY_IDS.has(input.listing.categoryId)) return "Unknown eBay category";
  if (imageUrls(input).length === 0) {
    return "Add a photo of the actual item first — eBay requires your own photo, not catalogue art";
  }
  return null;
}

/** eBay's public URL for a live listing. */
export function ebayListingUrl(listingId: string): string {
  return `https://www.ebay.com/itm/${encodeURIComponent(listingId)}`;
}
