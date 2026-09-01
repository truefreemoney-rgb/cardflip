import "server-only";
import { draftScopeEnabled, getUserAccessToken } from "@/lib/server/ebayAuth";
import {
  getCardForUser,
  setCardEbayDraft,
  setCardEbayListing,
  updateCard,
  type CardRecord,
} from "@/lib/server/cards";
import { hasCardPhoto } from "@/lib/server/cardPhotos";
import { db } from "@/lib/db";
import {
  buildInventoryItem,
  buildItemDraft,
  buildOffer,
  ebayListingUrl,
  EBAY_MARKETPLACE_ID,
  offerUpdateBody,
  skuForCard,
  validateDraftInput,
  type DraftInput,
  type InventoryItemPayload,
  type ListingPolicies,
} from "@/lib/ebayInventory";

/**
 * Pushing a CardFlip draft into the seller's own eBay account, on the user
 * token from ./ebayAuth.ts.
 *
 * Two explicit steps, because they mean different things to the seller:
 *
 *  1. pushDraft — createOrReplaceInventoryItem (keyed by SKU = our card id) +
 *     createOffer / updateOffer. Free, reversible, invisible to buyers. eBay
 *     doesn't show API-created offers in Seller Hub until published, so
 *     CardFlip is where the draft lives.
 *  2. publishDraft — publishOffer. The listing goes live under the seller's
 *     account and eBay's fees apply. Needs the seller's business policies
 *     (fulfillment / payment / return) and an inventory location; we attach
 *     their defaults when they exist and otherwise let eBay's own error tell
 *     them what's missing — we can't invent a return policy for someone.
 *
 * Every eBay failure surfaces as EbaySellError with eBay's message list, so
 * the UI can show the seller exactly why (missing policy, bad descriptor…)
 * instead of a generic "failed".
 */

const API = "https://api.ebay.com";

interface EbayApiError {
  errorId?: number;
  domain?: string;
  category?: string;
  message?: string;
  longMessage?: string;
}

export class EbaySellError extends Error {
  status: number;
  errors: EbayApiError[];
  constructor(message: string, status: number, errors: EbayApiError[] = []) {
    super(message);
    this.name = "EbaySellError";
    this.status = status;
    this.errors = errors;
  }
  /** The most useful line for a seller, or the generic message. */
  get sellerMessage(): string {
    const first = this.errors.find((e) => e.longMessage || e.message);
    return first?.longMessage || first?.message || this.message;
  }
}

/** The seller has no (live) eBay link — the UI should send them to Connect. */
export class EbayNotConnectedError extends Error {
  constructor() {
    super("Connect your eBay account first");
    this.name = "EbayNotConnectedError";
  }
}

export async function ebayFetch(
  token: string,
  method: "GET" | "PUT" | "POST",
  path: string,
  body?: unknown,
  /** The Finances API lives on apiz.ebay.com; everything else on api.ebay.com. */
  base: string = API,
): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      // The Inventory API rejects writes without BOTH of these as "en-US"
      // (errorId 25709 "Invalid value for header Accept-Language" — seen on
      // the first real push 08-16 with only Content-Language set). Harmless
      // on reads.
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
      "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });

  const text = await res.text().catch(() => "");
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const errors = ((json as { errors?: EbayApiError[] } | null)?.errors ?? []).slice(0, 5);
    console.error(`eBay ${method} ${path} → ${res.status}:`, text.slice(0, 500));
    throw new EbaySellError(
      res.status === 401
        ? "eBay no longer accepts this connection — reconnect your eBay account"
        : `eBay rejected the request (${res.status})`,
      res.status,
      errors,
    );
  }
  // eBay reports what it quietly ignored (an image it couldn't fetch, an
  // aspect it dropped) as warnings on a 2xx — the only trace of a listing
  // that will go live with an empty gallery, so they always hit the log.
  const warnings = (json as { warnings?: EbayApiError[] } | null)?.warnings;
  if (warnings?.length) {
    console.warn(`eBay ${method} ${path} → ${res.status} with warnings:`, JSON.stringify(warnings).slice(0, 800));
  }
  return json;
}

async function tokenFor(userId: string): Promise<string> {
  const token = await getUserAccessToken(userId);
  if (!token) throw new EbayNotConnectedError();
  return token;
}

// ---------------------------------------------------------------------------
// Seller defaults: business policies + inventory location, best-effort

interface SellerDefaults {
  policies: ListingPolicies;
  merchantLocationKey: string | null;
}

/** eBay's "not opted into Business Policies" answer on the policy endpoints. */
const NOT_OPTED_IN = 20403;

async function firstId<T>(
  token: string,
  path: string,
  listKey: string,
  idKey: string,
): Promise<string | undefined | typeof NOT_OPTED_IN> {
  try {
    const json = (await ebayFetch(token, "GET", path)) as Record<string, T[]> | null;
    const list = json?.[listKey] ?? [];
    const row = list[0] as Record<string, unknown> | undefined;
    const id = row?.[idKey];
    return typeof id === "string" ? id : undefined;
  } catch (err) {
    if (err instanceof EbaySellError && err.errors.some((e) => e.errorId === NOT_OPTED_IN)) {
      return NOT_OPTED_IN;
    }
    // Anything else: the offer is still created, and publish will explain
    // what's missing.
    console.warn(`eBay seller default lookup failed for ${path}:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * Business Policies opt-in. The Inventory API can't publish without
 * fulfillment/payment/return policy ids, and a seller who has never listed
 * through Seller Hub's policy system isn't opted in ("User is not eligible
 * for Business Policy", 20403 — seen on the first real push 08-16). The
 * Account API can opt them in directly; eBay then seeds default policies
 * from the account's existing preferences, which the next lookup picks up.
 */
async function optIntoBusinessPolicies(token: string): Promise<boolean> {
  try {
    await ebayFetch(token, "POST", "/sell/account/v1/program/opt_in", {
      programType: "SELLING_POLICY_MANAGEMENT",
    });
    console.warn("eBay: opted seller into Business Policies");
    return true;
  } catch (err) {
    console.warn("eBay Business Policies opt-in failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Create the three default policies for an account that has none. eBay
 * refuses to publish an offer without fulfillment/payment/return policy
 * ids, and a brand-new seller has zero even after the opt-in above (seen
 * 08-27: publish stopped at "create them once in Seller Hub"). These are
 * deliberately plain defaults -- Ground Advantage at a flat $4.99 the
 * buyer pays, managed payments, 30-day buyer-pays returns -- created ONLY
 * when the account has no policy of that kind, never touching existing
 * ones. The seller can edit or replace them in Seller Hub afterwards;
 * CardFlip just refuses to make an empty account a dead end.
 */
async function createDefaultPolicies(token: string, missing: { f: boolean; p: boolean; r: boolean }): Promise<void> {
  const base = { marketplaceId: EBAY_MARKETPLACE_ID, categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }] };
  const jobs: Promise<unknown>[] = [];
  if (missing.f) {
    // eBay's LSAS validator rejected the first shape of this (08-27:
    // LOGISTICS_INFO_IS_MISSING -- buyerResponsibleForShipping is a
    // freight/pickup flag, not "buyer pays", and its presence sank the
    // whole option). Buyer-pays is simply a non-zero flat cost. Some
    // accounts also refuse specific service codes, so try Ground
    // Advantage first and fall back to Priority.
    const fulfillmentBody = (serviceCode: string) => ({
      ...base,
      name: "CardFlip shipping",
      handlingTime: { value: 1, unit: "DAY" },
      shippingOptions: [
        {
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [
            {
              sortOrder: 1,
              shippingCarrierCode: "USPS",
              shippingServiceCode: serviceCode,
              shippingCost: { value: "4.99", currency: "USD" },
              freeShipping: false,
            },
          ],
        },
      ],
    });
    jobs.push(
      ebayFetch(token, "POST", "/sell/account/v1/fulfillment_policy", fulfillmentBody("USPSGroundAdvantage")).catch(() =>
        ebayFetch(token, "POST", "/sell/account/v1/fulfillment_policy", fulfillmentBody("USPSPriority")),
      ),
    );
  }
  if (missing.p) {
    // Managed payments: eBay ignores payment methods here, the policy is a shell.
    jobs.push(ebayFetch(token, "POST", "/sell/account/v1/payment_policy", {
      ...base,
      name: "CardFlip payments",
    }));
  }
  if (missing.r) {
    jobs.push(ebayFetch(token, "POST", "/sell/account/v1/return_policy", {
      ...base,
      name: "CardFlip returns",
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: "DAY" },
      returnShippingCostPayer: "BUYER",
    }));
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "rejected") {
      console.warn("eBay default policy creation failed:", r.reason instanceof Error ? r.reason.message : r.reason);
    }
  }
}
async function policyIds(token: string): Promise<ListingPolicies | typeof NOT_OPTED_IN> {
  const mp = `marketplace_id=${EBAY_MARKETPLACE_ID}`;
  const [f, p, r] = await Promise.all([
    firstId(token, `/sell/account/v1/fulfillment_policy?${mp}`, "fulfillmentPolicies", "fulfillmentPolicyId"),
    firstId(token, `/sell/account/v1/payment_policy?${mp}`, "paymentPolicies", "paymentPolicyId"),
    firstId(token, `/sell/account/v1/return_policy?${mp}`, "returnPolicies", "returnPolicyId"),
  ]);
  if (f === NOT_OPTED_IN || p === NOT_OPTED_IN || r === NOT_OPTED_IN) return NOT_OPTED_IN;
  return { fulfillmentPolicyId: f, paymentPolicyId: p, returnPolicyId: r };
}

async function sellerDefaults(token: string): Promise<SellerDefaults> {
  let policies = await policyIds(token);
  if (policies === NOT_OPTED_IN) {
    policies = (await optIntoBusinessPolicies(token)) ? await policyIds(token) : NOT_OPTED_IN;
  }
  const loc = await firstId(token, `/sell/inventory/v1/location?limit=1`, "locations", "merchantLocationKey");
  return {
    policies: policies === NOT_OPTED_IN ? {} : policies,
    merchantLocationKey: typeof loc === "string" ? loc : null,
  };
}

/** Our one inventory location per seller — publishOffer requires one. */
const LOCATION_KEY = "cardflip-default";

/**
 * Inventory locations are API-only objects (Seller Hub has no screen for
 * them), so CardFlip has to make one. A ship-from postal code + country is
 * all eBay needs for a WAREHOUSE-type location.
 */
async function createLocation(
  token: string,
  postalCode: string,
  country: string,
): Promise<string> {
  await ebayFetch(token, "POST", `/sell/inventory/v1/location/${LOCATION_KEY}`, {
    location: { address: { postalCode, country } },
    locationTypes: ["WAREHOUSE"],
    merchantLocationStatus: "ENABLED",
    name: "CardFlip ship-from location",
  });
  return LOCATION_KEY;
}

// ---------------------------------------------------------------------------
// The inventory item, with a self-bisecting fallback

/**
 * eBay answers an inventory payload it can't digest with a generic 500
 * (errorId 25001, "Core Inventory Service internal error") instead of naming
 * the field. With no way to poke the API outside a real seller's token, the
 * push bisects for itself: on that exact failure it strips one part at a
 * time — condition descriptors, then aspects, then images, then condition —
 * and PUTs again. The first shape eBay accepts still creates the draft; what
 * was left off comes back as human-readable notes (and hits the log with the
 * SKU) so the culprit is known after one attempt rather than a guessing
 * round-trip per deploy. Anything other than a 500 propagates untouched.
 */
async function putInventoryItem(
  token: string,
  path: string,
  full: InventoryItemPayload,
): Promise<string[]> {
  const ladder: { note: string; strip: (p: InventoryItemPayload) => InventoryItemPayload }[] = [
    {
      note: "condition detail (card condition / grader / grade)",
      strip: (p) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { conditionDescriptors, ...rest } = p;
        return rest;
      },
    },
    {
      note: "item specifics (set, card number, rarity…)",
      strip: (p) => ({ ...p, product: { ...p.product, aspects: {} } }),
    },
    {
      note: "the card image",
      strip: (p) => ({ ...p, product: { ...p.product, imageUrls: [] } }),
    },
    {
      note: "the condition itself",
      strip: (p) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { condition, ...rest } = p;
        return rest as InventoryItemPayload;
      },
    },
  ];

  const isOpaque500 = (err: unknown) => err instanceof EbaySellError && err.status === 500;

  let payload = full;
  const dropped: string[] = [];
  console.info(`eBay inventory PUT ${path} images: ${full.product.imageUrls.join(" ") || "(none)"}`);
  try {
    await ebayFetch(token, "PUT", path, payload);
    return dropped;
  } catch (err) {
    if (!isOpaque500(err)) throw err;
  }
  for (const step of ladder) {
    payload = step.strip(payload);
    dropped.push(step.note);
    console.warn(`eBay inventory PUT 500 for ${path}; retrying without ${step.note}`);
    try {
      await ebayFetch(token, "PUT", path, payload);
      console.warn(`eBay inventory PUT succeeded for ${path} after dropping: ${dropped.join(" | ")}`);
      return dropped;
    } catch (err) {
      if (!isOpaque500(err)) throw err;
    }
  }
  throw new EbaySellError(
    "eBay's inventory service rejected this item even in its simplest form (title, description, quantity). eBay reports this as a generic system error — it may be a temporary outage on their side; try again in a few minutes.",
    502,
  );
}

// ---------------------------------------------------------------------------
// The two steps

export interface PushResult {
  card: CardRecord;
  offerId: string;
  sku: string;
  /** Which seller defaults were attached — the UI can warn before publish. */
  attached: { fulfillment: boolean; payment: boolean; return: boolean; location: boolean };
  /** True when the offer already existed and was updated rather than created. */
  updated: boolean;
  /**
   * Parts of the item eBay refused (see putInventoryItem). Empty on a clean
   * push. Non-empty means the draft exists but the seller should finish
   * those fields on eBay before publishing.
   */
  degraded: string[];
}

export interface DraftResult {
  card: CardRecord;
  draftId: string;
  /** Opens the draft in eBay's listing tool (also under My eBay › Drafts). */
  draftUrl: string | null;
}

/**
 * "Send draft to eBay" — a Listing API item draft. This is the road a seller
 * expects: the draft appears in their My eBay › Drafts / Seller Hub and
 * opens pre-filled in eBay's own listing tool, where they add anything
 * else and publish. Nothing goes live here. eBay has no update-draft call,
 * so sending again creates a fresh draft (the old one stays in their
 * Drafts until they discard it — harmless, and we say so in the UI).
 *
 * Needs the sell.item.draft scope; a link granted before it was added
 * gets eBay's 403 → surfaced as needs_reconnect.
 */
export async function createDraft(
  userId: string,
  draft: Omit<DraftInput, "hasPhoto">,
): Promise<DraftResult> {
  const card = await getCardForUser(draft.cardId, userId);
  if (!card) throw new EbaySellError("That card isn't in your ledger", 404);
  const input: DraftInput = { ...draft, hasPhoto: await hasCardPhoto(card.id) };
  if (!input.hasPhoto) {
    throw new EbayPublishNeedsError(
      "photo",
      "Add a photo of the actual card first — eBay requires your own photo of the item, not catalogue art",
    );
  }
  const problem = validateDraftInput(input);
  if (problem) throw new EbaySellError(problem, 400);
  // Without the scope the token simply cannot carry this permission, so fail
  // here rather than making the seller wait for eBay's 403.
  if (!draftScopeEnabled() || listingApiUnavailable) throw new EbayDraftUnavailableError();

  const token = await tokenFor(userId);
  const body = buildItemDraft(input);
  console.info(`eBay item draft POST for ${card.id} images: ${body.product.imageUrls.join(" ") || "(none)"}`);
  // Response per the Listing API spec: itemDraftId + sellFlowUrl (the web
  // URL that opens the draft in eBay's listing tool) + sellFlowNativeUri.
  let json: { itemDraftId?: string; sellFlowUrl?: string; itemWebUrl?: string } | null;
  try {
    json = (await ebayFetch(token, "POST", "/sell/listing/v1_beta/item_draft/", body)) as typeof json;
  } catch (err) {
    if (err instanceof EbaySellError && err.status === 403) {
      throw new EbayPublishNeedsError(
        "reconnect",
        "Your eBay link predates draft permission — reconnect eBay once (Settings › eBay) and send again",
      );
    }
    // The Listing API is limited-release (eBay enables it per keyset on
    // application). Until then eBay doesn't route the path at all: 404 with
    // an EMPTY body (seen 08-16, first real call). Tell the client to fall
    // back to the Inventory draft, and stop asking.
    if (err instanceof EbaySellError && err.status === 404 && err.errors.length === 0) {
      listingApiUnavailable = true;
      throw new EbayDraftUnavailableError();
    }
    throw err;
  }
  if (!json?.itemDraftId) throw new EbaySellError("eBay returned no draft id", 502);
  const draftUrl = json.sellFlowUrl ?? json.itemWebUrl ?? null;
  const saved = await setCardEbayDraft(card.id, userId, { draftId: json.itemDraftId, draftUrl });
  return { card: saved ?? card, draftId: json.itemDraftId, draftUrl };
}

export async function pushDraft(
  userId: string,
  draft: Omit<DraftInput, "hasPhoto">,
): Promise<PushResult> {
  const card = await getCardForUser(draft.cardId, userId);
  if (!card) throw new EbaySellError("That card isn't in your ledger", 404);

  // The listing photo is the seller's own, stored server-side; the client
  // never gets to claim one exists. Missing → the client shows the picker.
  const input: DraftInput = { ...draft, hasPhoto: await hasCardPhoto(card.id) };
  if (!input.hasPhoto) {
    throw new EbayPublishNeedsError(
      "photo",
      "Add a photo of the actual card first — eBay requires your own photo of the item, not catalogue art",
    );
  }
  const problem = validateDraftInput(input);
  if (problem) throw new EbaySellError(problem, 400);

  const token = await tokenFor(userId);
  const sku = skuForCard(card.id);
  const itemPath = `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;

  const item = buildInventoryItem(input);
  const degraded = await putInventoryItem(token, itemPath, item);

  const defaults = await sellerDefaults(token);
  const offer = buildOffer(input, defaults);

  let offerId = card.ebayOfferId;
  let updated = false;
  if (offerId) {
    try {
      await ebayFetch(token, "PUT", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, offerUpdateBody(offer));
      updated = true;
    } catch (err) {
      // The offer we remember may be gone (seller deleted it on eBay, or the
      // published listing ended). Fall through and create a fresh one.
      if (!(err instanceof EbaySellError && err.status === 404)) throw err;
      offerId = null;
    }
  }
  if (!offerId) {
    const created = (await ebayFetch(token, "POST", "/sell/inventory/v1/offer", offer)) as {
      offerId?: string;
    } | null;
    if (!created?.offerId) throw new EbaySellError("eBay created no offer id", 502);
    offerId = created.offerId;
  }

  const saved = await setCardEbayListing(card.id, userId, {
    sku,
    offerId,
    pushedAt: Date.now(),
    // A re-push after publishing is an update to a live listing; keep the id.
  });

  return {
    card: saved ?? card,
    offerId,
    sku,
    attached: {
      fulfillment: Boolean(defaults.policies.fulfillmentPolicyId),
      payment: Boolean(defaults.policies.paymentPolicyId),
      return: Boolean(defaults.policies.returnPolicyId),
      location: Boolean(defaults.merchantLocationKey),
    },
    updated,
    degraded,
  };
}

export interface PublishResult {
  card: CardRecord;
  listingId: string;
  listingUrl: string;
  warnings: string[];
}

/**
 * Publish can't proceed without seller-side setup. Thrown with a `needs`
 * code so the UI can ask for exactly the missing thing (a ship-from ZIP) or
 * point at the one eBay screen that fixes it (business policies).
 */
export class EbayPublishNeedsError extends Error {
  needs: "location" | "policies" | "photo" | "reconnect" | "push";
  constructor(needs: "location" | "policies" | "photo" | "reconnect" | "push", message: string) {
    super(message);
    this.name = "EbayPublishNeedsError";
    this.needs = needs;
  }
}

/**
 * The Listing API (My eBay › Drafts) isn't enabled for our keyset — it's a
 * limited-release API eBay switches on per application. The client falls
 * back to the Inventory draft (which has worked since 08-16 05:06).
 */
export class EbayDraftUnavailableError extends Error {
  constructor() {
    super(
      "eBay hasn't switched on My eBay Drafts for CardFlip yet (a limited-release eBay API we've applied for) — the draft is saved here instead and publishes from CardFlip",
    );
    this.name = "EbayDraftUnavailableError";
  }
}

// Once eBay tells us the Listing API isn't routed for this keyset, don't
// keep asking on every send — remember it for the life of the process.
let listingApiUnavailable = false;
export function isListingApiUnavailable(): boolean {
  return listingApiUnavailable;
}

export interface PublishOptions {
  /** Ship-from location, used (once) to create the seller's inventory location. */
  shipFrom?: { postalCode: string; country: string } | null;
}

/**
 * Change the asking price on this card's eBay offer — live listings update in
 * place. Same replace-the-whole-offer dance as publishDraft: GET the current
 * offer, PUT it back with only pricingSummary changed. Throws EbaySellError;
 * a 404/25713 (offer gone) surfaces as-is — the reprice caller treats any
 * failure as "ledger updated, eBay didn't" and says so.
 */
export async function updateOfferPrice(userId: string, cardId: string, price: number): Promise<void> {
  const card = await getCardForUser(cardId, userId);
  if (!card) throw new EbaySellError("That card isn't in your ledger", 404);
  if (!card.ebayOfferId) throw new EbaySellError("This card has no eBay offer to reprice", 409);
  const token = await tokenFor(userId);
  const offerPath = `/sell/inventory/v1/offer/${encodeURIComponent(card.ebayOfferId)}`;
  const current = (await ebayFetch(token, "GET", offerPath)) as Record<string, unknown> | null;
  if (!current) throw new EbaySellError("eBay returned no offer to update", 502);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { offerId, sku, marketplaceId, format, status, listing, ...rest } = current;
  await ebayFetch(token, "PUT", offerPath, {
    ...rest,
    pricingSummary: { price: { currency: "USD", value: price.toFixed(2) } },
  });
}

export async function publishDraft(
  userId: string,
  cardId: string,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const card = await getCardForUser(cardId, userId);
  if (!card) throw new EbaySellError("That card isn't in your ledger", 404);
  if (!card.ebayOfferId) throw new EbaySellError("Send the draft to eBay first", 409);

  const token = await tokenFor(userId);

  // The offer was created with whatever defaults existed at push time —
  // usually nothing for a first-time seller. Resolve them now (opting in and
  // creating the location as needed), write them onto the offer, then publish.
  let defaults = await sellerDefaults(token);
  let { fulfillmentPolicyId, paymentPolicyId, returnPolicyId } = defaults.policies;
  if (!fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId) {
    // An account with no policies is the normal first-publish state, not an
    // error: create plain defaults and look again (08-27 -- the Seller Hub
    // detour stopped Chris cold at the moment of first publish).
    await createDefaultPolicies(token, {
      f: !fulfillmentPolicyId,
      p: !paymentPolicyId,
      r: !returnPolicyId,
    });
    defaults = await sellerDefaults(token);
    ({ fulfillmentPolicyId, paymentPolicyId, returnPolicyId } = defaults.policies);
  }
  if (!fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId) {
    throw new EbayPublishNeedsError(
      "policies",
      "eBay needs a shipping, payment and return policy on your account before it will list. CardFlip tried to create default ones and eBay refused -- create them once in Seller Hub (Account → Business Policies), then publish again.",
    );
  }
  let merchantLocationKey = defaults.merchantLocationKey;
  if (!merchantLocationKey) {
    const ship = opts.shipFrom;
    if (!ship?.postalCode) {
      throw new EbayPublishNeedsError(
        "location",
        "eBay needs to know where you ship from. Enter your ZIP / postal code once and CardFlip saves it on your eBay account.",
      );
    }
    merchantLocationKey = await createLocation(token, ship.postalCode, ship.country || "US");
  }

  const offerPath = `/sell/inventory/v1/offer/${encodeURIComponent(card.ebayOfferId)}`;
  let current: Record<string, unknown> | null;
  try {
    current = (await ebayFetch(token, "GET", offerPath)) as Record<string, unknown> | null;
  } catch (err) {
    // 25713 "This Offer is not available": the stored offer id points at
    // nothing -- created under a broken link or expired since (08-27: offer
    // 247326078011 from an earlier failed session 404'd every publish).
    // Clear it so the next push mints a fresh offer, and tell the client,
    // which re-pushes and retries the publish on its own.
    if (err instanceof EbaySellError && err.errors.some((e) => e.errorId === 25713)) {
      await db
        .prepare("UPDATE cards SET ebay_offer_id = NULL, ebay_pushed_at = NULL WHERE id = ? AND user_id = ?")
        .run(card.id, userId);
      throw new EbayPublishNeedsError(
        "push",
        "That saved eBay draft no longer exists on eBay -- resending it now.",
      );
    }
    throw err;
  }
  if (current) {
    // updateOffer replaces the offer; send it back whole with the two things
    // filled in, minus the fields eBay forbids re-sending.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { offerId, sku, marketplaceId, format, status, listing, ...rest } = current;
    await ebayFetch(token, "PUT", offerPath, {
      ...rest,
      listingPolicies: {
        ...((rest.listingPolicies as Record<string, unknown>) ?? {}),
        fulfillmentPolicyId,
        paymentPolicyId,
        returnPolicyId,
      },
      merchantLocationKey,
    });
  }

  const json = (await ebayFetch(
    token,
    "POST",
    `/sell/inventory/v1/offer/${encodeURIComponent(card.ebayOfferId)}/publish`,
  )) as { listingId?: string; warnings?: EbayApiError[] } | null;
  if (!json?.listingId) throw new EbaySellError("eBay published no listing id", 502);

  const now = Date.now();
  await setCardEbayListing(card.id, userId, {
    sku: skuForCard(card.id),
    offerId: card.ebayOfferId,
    listingId: json.listingId,
    publishedAt: now,
  });
  const saved = await updateCard(card.id, userId, { status: "listed", listedAt: now });

  return {
    card: saved ?? card,
    listingId: json.listingId,
    listingUrl: ebayListingUrl(json.listingId),
    warnings: (json.warnings ?? [])
      .map((w) => w.longMessage || w.message || "")
      .filter(Boolean),
  };
}
