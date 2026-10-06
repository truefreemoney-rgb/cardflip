import "server-only";
import { draftScopeEnabled, EbayNotConnectedError, getUserAccessToken } from "@/lib/server/ebayAuth";
import {
  getCardForUser,
  setCardEbayDraft,
  setCardEbayListing,
  setCardListingMarket,
  updateCard,
  type CardRecord,
} from "@/lib/server/cards";
import { hasCardPhoto } from "@/lib/server/cardPhotos";
import { db } from "@/lib/db";
import { ebayHosts } from "@/lib/ebayHosts";
import { toUsd } from "@/lib/localPricing";
import {
  US_MARKETPLACE,
  isLocalMarketplace,
  marketplaceByEbayId,
  marketplaceLabel,
  merchantLocationKeyFor,
  type Marketplace,
} from "@/lib/marketplaces";
import {
  buildInventoryItem,
  buildItemDraft,
  buildOffer,
  ebayListingUrl,
  ebayRequestHeaders,
  fulfillmentAttempts,
  fulfillmentPolicyBody,
  locationBody,
  offerUpdateBody,
  paymentPolicyBody,
  pickMerchantLocation,
  repriceListingPolicies,
  returnPolicyBody,
  skuForCard,
  validateDraftInput,
  type DraftInput,
  type InventoryItemPayload,
  type InventoryLocationRow,
  type ListingPolicies,
  type SellerListingPrefs,
} from "@/lib/ebayInventory";
import { findUserById } from "@/lib/server/users";
import { FxUnavailableError, getFxRates } from "@/lib/server/fx";
import { LocalPriceError, marketFor, resolveLocalAsk, sellerAccountType, sellerMarket, type LocalAsk, type SellerMarket } from "@/lib/server/ebayMarket";

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

// EbayNotConnectedError lives in ebayAuth.ts (getUserAccessToken throws it when
// eBay rejects a refresh); re-exported so the routes keep one import.
export { EbayNotConnectedError } from "@/lib/server/ebayAuth";

export async function ebayFetch(
  token: string,
  method: "GET" | "PUT" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  /** The Finances API lives on apiz.ebay.com; everything else on api.ebay.com (the sandbox hosts under EBAY_ENV=sandbox). */
  base: string = ebayHosts().api,
  /** Which eBay site the call is for; the US row reproduces the original headers exactly. */
  marketplace: Marketplace = US_MARKETPLACE,
): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method,
    // Content-Language AND Accept-Language per site (the Inventory API rejects
    // writes without both, errorId 25709), X-EBAY-C-MARKETPLACE-ID: see
    // ebayRequestHeaders in lib/ebayInventory.ts.
    headers: ebayRequestHeaders(token, marketplace, body !== undefined),
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
  mp: Marketplace = US_MARKETPLACE,
): Promise<string | undefined | typeof NOT_OPTED_IN> {
  try {
    const json = (await ebayFetch(token, "GET", path, undefined, undefined, mp)) as Record<string, T[]> | null;
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
async function optIntoBusinessPolicies(token: string, mp: Marketplace = US_MARKETPLACE): Promise<boolean> {
  try {
    await ebayFetch(token, "POST", "/sell/account/v1/program/opt_in", {
      programType: "SELLING_POLICY_MANAGEMENT",
    }, undefined, mp);
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
async function createDefaultPolicies(token: string, missing: { f: boolean; p: boolean; r: boolean }, mp: Marketplace = US_MARKETPLACE): Promise<void> {
  const post = (path: string, body: unknown) => ebayFetch(token, "POST", path, body, undefined, mp);
  const jobs: Promise<unknown>[] = [];
  if (missing.f) {
    // eBay's LSAS validator rejected the first shape of this (08-27:
    // LOGISTICS_INFO_IS_MISSING -- buyerResponsibleForShipping is a
    // freight/pickup flag, not "buyer pays", and its presence sank the
    // whole option). Buyer-pays is simply a non-zero flat cost. Some
    // accounts also refuse specific service codes, so walk the site's
    // attempts in order (US: Ground Advantage then Priority; other sites: the
    // letter code with the carrier, without it, then the alternate code).
    // The last failure is the one that surfaces.
    jobs.push(
      (async () => {
        const attempts = fulfillmentAttempts(mp);
        let last: unknown;
        for (const a of attempts) {
          try {
            return await post("/sell/account/v1/fulfillment_policy", fulfillmentPolicyBody(mp, a.serviceCode, a.carrierCode));
          } catch (err) {
            last = err;
          }
        }
        throw last;
      })(),
    );
  }
  if (missing.p) jobs.push(post("/sell/account/v1/payment_policy", paymentPolicyBody(mp)));
  if (missing.r) jobs.push(post("/sell/account/v1/return_policy", returnPolicyBody(mp)));
  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "rejected") {
      console.warn("eBay default policy creation failed:", r.reason instanceof Error ? r.reason.message : r.reason);
    }
  }
}
async function policyIds(token: string, mp: Marketplace = US_MARKETPLACE): Promise<ListingPolicies | typeof NOT_OPTED_IN> {
  const q = `marketplace_id=${mp.marketplaceId}`;
  const [f, p, r] = await Promise.all([
    firstId(token, `/sell/account/v1/fulfillment_policy?${q}`, "fulfillmentPolicies", "fulfillmentPolicyId", mp),
    firstId(token, `/sell/account/v1/payment_policy?${q}`, "paymentPolicies", "paymentPolicyId", mp),
    firstId(token, `/sell/account/v1/return_policy?${q}`, "returnPolicies", "returnPolicyId", mp),
  ]);
  if (f === NOT_OPTED_IN || p === NOT_OPTED_IN || r === NOT_OPTED_IN) return NOT_OPTED_IN;
  return { fulfillmentPolicyId: f, paymentPolicyId: p, returnPolicyId: r };
}

async function sellerDefaults(token: string, mp: Marketplace = US_MARKETPLACE): Promise<SellerDefaults> {
  let policies = await policyIds(token, mp);
  if (policies === NOT_OPTED_IN) {
    policies = (await optIntoBusinessPolicies(token, mp)) ? await policyIds(token, mp) : NOT_OPTED_IN;
  }
  let loc: string | undefined | typeof NOT_OPTED_IN | null;
  if (mp.key === "US") {
    // Unchanged for US sellers: their first location, whatever it is.
    loc = await firstId(token, `/sell/inventory/v1/location?limit=1`, "locations", "merchantLocationKey");
  } else {
    // Another site: our cardflip-<cc> location, or one of theirs in that country, never a location in another country.
    try {
      const json = (await ebayFetch(token, "GET", `/sell/inventory/v1/location?limit=100`, undefined, undefined, mp)) as { locations?: InventoryLocationRow[] } | null;
      loc = pickMerchantLocation(json?.locations ?? [], mp);
    } catch (err) {
      console.warn(`eBay location lookup failed for ${mp.key}:`, err instanceof Error ? err.message : err);
      loc = null;
    }
  }
  return {
    policies: policies === NOT_OPTED_IN ? {} : policies,
    merchantLocationKey: typeof loc === "string" ? loc : null,
  };
}

/**
 * Inventory locations are API-only objects (Seller Hub has no screen for
 * them), so CardFlip has to make one. A ship-from postal code + country is
 * all eBay needs for a WAREHOUSE-type location. The key is per site
 * (cardflip-default for the US, cardflip-gb ... elsewhere).
 */
async function createLocation(
  token: string,
  postalCode: string,
  country: string,
  mp: Marketplace = US_MARKETPLACE,
  city?: string,
): Promise<string> {
  const key = merchantLocationKeyFor(mp);
  await ebayFetch(token, "POST", `/sell/inventory/v1/location/${key}`, locationBody(postalCode, country, mp.locationNeedsCity ? city : undefined), undefined, mp);
  return key;
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
  mp: Marketplace = US_MARKETPLACE,
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
    await ebayFetch(token, "PUT", path, payload, undefined, mp);
    return dropped;
  } catch (err) {
    if (!isOpaque500(err)) throw err;
  }
  for (const step of ladder) {
    payload = step.strip(payload);
    dropped.push(step.note);
    console.warn(`eBay inventory PUT 500 for ${path}; retrying without ${step.note}`);
    try {
      await ebayFetch(token, "PUT", path, payload, undefined, mp);
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
/**
 * The match gate, enforced where it matters (Chris, 09-03): no draft, push
 * or publish for a card the seller hasn't verified, whatever the client
 * says. A card that's already on eBay (listed/sold) is past the gate.
 */
function requireVerified(card: { verifiedAt: number | null; status: string; ebayOfferId: string | null }) {
  if (card.verifiedAt || card.status !== "ready" || card.ebayOfferId) return;
  throw new EbaySellError("Verify the card match first — open the card and tap Verify match", 409);
}

export async function createDraft(
  userId: string,
  draft: Omit<DraftInput, "hasPhoto">,
): Promise<DraftResult> {
  const card = await getCardForUser(draft.cardId, userId);
  if (!card) throw new EbaySellError("That card isn't in your ledger", 404);
  requireVerified(card);
  // My eBay Drafts (the Listing API) is a US-site road for now: a seller on another site gets a clean refusal.
  const here = await sellerMarket(userId);
  if (isLocalMarketplace(here.mp)) {
    throw new EbaySellError(
      `Sending a draft to My eBay isn't available for ${marketplaceLabel(here.mp)} yet — save the draft here and publish it from CardFlip.`,
      400,
    );
  }
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

/**
 * The seller's opt-in listing terms as the payload builders take them: Best
 * Offer floors (Account > Accept Offers) and tracked postage over a price.
 * Both are null for a seller who hasn't turned them on, which leaves every
 * payload exactly as it was. Tracked postage ALSO needs the owner's
 * EBAY_VALUE_SHIPPING=1 on the server: it rewrites the shipping charge on
 * the seller's live eBay listings, so nothing happens until the owner flips it.
 */
export async function sellerListingPrefs(userId: string): Promise<SellerListingPrefs | null> {
  const user = await findUserById(userId);
  if (!user) return null;
  const offers = user.acceptOffers && user.offerAcceptPercent != null && user.offerDeclinePercent != null
    ? { acceptPercent: user.offerAcceptPercent, declinePercent: user.offerDeclinePercent }
    : null;
  const trackedShipping = process.env.EBAY_VALUE_SHIPPING === "1" && user.trackedShipOver != null && user.trackedShipCost != null
    ? { over: user.trackedShipOver, cost: user.trackedShipCost }
    : null;
  return offers || trackedShipping ? { offers, trackedShipping } : null;
}

/** The asking price on a local site, or a seller-readable EbaySellError (no usable FX rate, no trusted market). */
async function priceOnSite(card: CardRecord, here: SellerMarket, strategy: DraftInput["strategy"]): Promise<LocalAsk> {
  try {
    return await resolveLocalAsk(card, here.mp, here.account, strategy);
  } catch (err) {
    if (err instanceof FxUnavailableError || err instanceof LocalPriceError) throw new EbaySellError(err.message, 409);
    throw err;
  }
}

export async function pushDraft(
  userId: string,
  draft: Omit<DraftInput, "hasPhoto">,
): Promise<PushResult> {
  const card = await getCardForUser(draft.cardId, userId);
  if (!card) throw new EbaySellError("That card isn't in your ledger", 404);
  requireVerified(card);

  // The listing photo is the seller's own, stored server-side; the client
  // never gets to claim one exists. Missing → the client shows the picker.
  let input: DraftInput = { ...draft, hasPhoto: await hasCardPhoto(card.id) };
  if (!input.hasPhoto) {
    throw new EbayPublishNeedsError(
      "photo",
      "Add a photo of the actual card first — eBay requires your own photo of the item, not catalogue art",
    );
  }
  const here = await marketFor(userId, card);
  const mp = here.mp;
  // A local site is priced HERE, in its own currency, from the USD market
  // value at today's rate and that site's fee model: whatever price the
  // client sent is a USD figure and is ignored.
  let priced: LocalAsk | null = null;
  if (isLocalMarketplace(mp)) {
    priced = await priceOnSite(card, here, input.strategy);
    input = { ...input, listing: { ...input.listing, price: priced.price } };
  }
  const problem = validateDraftInput(input, mp, here.account);
  if (problem) throw new EbaySellError(problem, 400);

  const token = await tokenFor(userId);
  const sku = skuForCard(card.id);
  const itemPath = `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;

  // An offer that was never published and sits on another site than the seller's current one (a US offer
  // pushed before their site went live) is removed and made again on the right site: an unpublished offer is
  // invisible to buyers and costs nothing, and an offer cannot change site. A published listing is never
  // touched here (marketFor pins it to its own site). If eBay refuses the delete, nothing has changed and the
  // seller hears why.
  let existingOfferId = card.ebayOfferId;
  if (here.staleOffer && existingOfferId) {
    try {
      await ebayFetch(token, "DELETE", `/sell/inventory/v1/offer/${encodeURIComponent(existingOfferId)}`, undefined, undefined, here.staleOffer);
    } catch (err) {
      const gone = err instanceof EbaySellError && (err.status === 404 || err.errors.some((e) => e.errorId === 25713 || e.errorId === 25002));
      if (!gone) throw err;
    }
    await db
      .prepare(
        `UPDATE cards SET ebay_offer_id = NULL, ebay_pushed_at = NULL, ebay_marketplace = NULL, list_currency = NULL,
                list_price_local = NULL WHERE id = ? AND user_id = ?`,
      )
      .run(card.id, userId);
    existingOfferId = null;
  }

  const item = buildInventoryItem(input);
  const degraded = await putInventoryItem(token, itemPath, item, mp);

  const defaults = await sellerDefaults(token, mp);
  const offer = buildOffer(input, { ...defaults, prefs: await sellerListingPrefs(userId), account: here.account }, mp);

  let offerId = existingOfferId;
  let updated = false;
  if (offerId) {
    try {
      await ebayFetch(token, "PUT", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, offerUpdateBody(offer), undefined, mp);
      updated = true;
    } catch (err) {
      // The offer we remember may be gone (seller deleted it on eBay, or the
      // published listing ended). Fall through and create a fresh one.
      if (!(err instanceof EbaySellError && err.status === 404)) throw err;
      offerId = null;
    }
  }
  if (!offerId) {
    const created = (await ebayFetch(token, "POST", "/sell/inventory/v1/offer", offer, undefined, mp)) as {
      offerId?: string;
    } | null;
    if (!created?.offerId) throw new EbaySellError("eBay created no offer id", 502);
    offerId = created.offerId;
  }

  // The offer id and the site it lives on are written in ONE transaction, so a failure between them can never
  // leave a GB offer recorded as a US one. list_price_local is the authority for the listing and cards.price
  // becomes its USD equivalent. A card that had a local site on record but got a US offer drops the stale site.
  const saved = await setCardEbayListing(card.id, userId, {
    sku,
    offerId,
    pushedAt: Date.now(),
    // A re-push after publishing is an update to a live listing; keep the id.
    market: priced
      ? { marketplace: mp.marketplaceId, currency: mp.currency, priceLocal: priced.price, priceUsd: toUsd(priced.price, priced.rate) }
      : card.ebayMarketplace
        ? null
        : undefined,
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
  shipFrom?: { postalCode: string; country: string; city?: string } | null;
}

/**
 * Change the asking price on this card's eBay offer — live listings update in
 * place. Same replace-the-whole-offer dance as publishDraft: GET the current
 * offer, PUT it back with only pricingSummary changed. Throws EbaySellError;
 * a 404/25713 (offer gone) surfaces as-is — the reprice caller treats any
 * failure as "ledger updated, eBay didn't" and says so.
 */
export async function updateOfferPrice(
  userId: string,
  cardId: string,
  price: number,
  /** For a local site: the USD equivalent the ledger totals should carry (the caller's rate). */
  opts: { priceUsd?: number | null } = {},
): Promise<void> {
  const card = await getCardForUser(cardId, userId);
  if (!card) throw new EbaySellError("That card isn't in your ledger", 404);
  if (!card.ebayOfferId) throw new EbaySellError("This card has no eBay offer to reprice", 409);
  // `price` is in the currency of the site the offer lives on (stored on the card), never the seller's current home.
  const mp = marketplaceByEbayId(card.ebayMarketplace);
  const token = await tokenFor(userId);
  const offerPath = `/sell/inventory/v1/offer/${encodeURIComponent(card.ebayOfferId)}`;
  const current = (await ebayFetch(token, "GET", offerPath, undefined, undefined, mp)) as Record<string, unknown> | null;
  if (!current) throw new EbaySellError("eBay returned no offer to update", 502);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { offerId, sku, marketplaceId, format, status, listing, ...rest } = current;
  // Best Offer floors and the tracked-postage override are computed from the price, so they move with it
  // (untouched, and byte-identical to before, for a seller with neither on).
  const prefs = await sellerListingPrefs(userId);
  const policies = prefs
    ? repriceListingPolicies(rest.listingPolicies, price, prefs, mp, isLocalMarketplace(mp) ? await sellerAccountType(userId) : null)
    : rest.listingPolicies;
  await ebayFetch(token, "PUT", offerPath, {
    ...rest,
    ...(policies !== undefined ? { listingPolicies: policies } : {}),
    pricingSummary: { price: { currency: mp.currency, value: price.toFixed(2) } },
  }, undefined, mp);
  if (isLocalMarketplace(mp)) {
    await setCardListingMarket(card.id, userId, {
      marketplace: mp.marketplaceId,
      currency: mp.currency,
      priceLocal: price,
      priceUsd: opts.priceUsd ?? null,
    });
  }
}

/**
 * End this card's live eBay listing early ("Auction ended", Chris 09-03).
 * withdraw keeps the offer (status UNPUBLISHED) so a Relist can publish it
 * again from the editor. A listing that eBay already ended (404 / 25713)
 * is treated as ended, not as a failure — the seller's intent is met.
 */
export async function withdrawOffer(userId: string, cardId: string): Promise<void> {
  const card = await getCardForUser(cardId, userId);
  if (!card) throw new EbaySellError("That card isn't in your ledger", 404);
  if (!card.ebayOfferId) throw new EbaySellError("This card has no eBay listing to end", 409);
  const token = await tokenFor(userId);
  try {
    await ebayFetch(token, "POST", `/sell/inventory/v1/offer/${encodeURIComponent(card.ebayOfferId)}/withdraw`, undefined, undefined, marketplaceByEbayId(card.ebayMarketplace));
  } catch (err) {
    const gone =
      err instanceof EbaySellError &&
      (err.status === 404 || err.errors.some((e) => e.errorId === 25713 || e.errorId === 25002));
    if (!gone) throw err;
  }
}

/**
 * eBay 25604 "Seller Inventory Service can not publish the data. Availability
 * not found. Please try again" — their inventory service has not caught up
 * with an inventory item PUT seconds earlier (09-06: The Soul Stone, item PUT
 * at :47, offer update at :59, rejected). The item and offer are correct;
 * eBay itself says try again. So: retry with a short pause, then explain.
 */
const isAvailabilityLag = (err: unknown) =>
  err instanceof EbaySellError && err.errors.some((e) => e.errorId === 25604);

async function retryingAvailabilityLag<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const waitsMs = [2000, 4000, 6000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isAvailabilityLag(err)) throw err;
      if (attempt >= waitsMs.length) {
        throw new EbaySellError(
          "eBay's inventory service hasn't caught up with this item yet (their error 25604). Nothing is wrong with the listing — wait a minute and tap Publish again.",
          503,
        );
      }
      console.warn(`eBay 25604 on ${step}; retrying in ${waitsMs[attempt]}ms (attempt ${attempt + 1})`);
      await new Promise((r) => setTimeout(r, waitsMs[attempt]));
    }
  }
}

/** The live listing id of an offer per eBay, or null if it isn't published (or can't be read). */
async function liveListingId(token: string, offerPath: string, mp: Marketplace): Promise<string | null> {
  try {
    const o = (await ebayFetch(token, "GET", offerPath, undefined, undefined, mp)) as
      | { status?: string; listing?: { listingId?: string } }
      | null;
    return String(o?.status ?? "").toUpperCase() === "PUBLISHED" ? (o?.listing?.listingId ?? null) : null;
  } catch {
    return null;
  }
}

const PUBLISH_CLAIM_STALE_MS = 2 * 60 * 1000;

/** Two simultaneous publishes of one card must not both run: claim a short-lived in-DB lock (price_history_meta). */
async function claimPublish(cardId: string): Promise<boolean> {
  const key = `ebay_publishing:${cardId}`;
  const now = Date.now();
  const ins = await db
    .prepare("INSERT OR IGNORE INTO price_history_meta (key, value) VALUES (?, ?)")
    .run(key, String(now));
  if (ins.changes) return true;
  // Held by someone else: take it over only if that holder died (stale claim).
  const take = await db
    .prepare("UPDATE price_history_meta SET value = ? WHERE key = ? AND CAST(value AS INTEGER) < ?")
    .run(String(now), key, now - PUBLISH_CLAIM_STALE_MS);
  return Boolean(take.changes);
}

export async function publishDraft(
  userId: string,
  cardId: string,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  if (!(await claimPublish(cardId))) {
    throw new EbaySellError("This card is already being published -- give it a moment.", 409);
  }
  try {
    return await publishDraftLocked(userId, cardId, opts);
  } finally {
    await db
      .prepare("DELETE FROM price_history_meta WHERE key = ?")
      .run(`ebay_publishing:${cardId}`)
      .catch(() => {});
  }
}

async function publishDraftLocked(
  userId: string,
  cardId: string,
  opts: PublishOptions,
): Promise<PublishResult> {
  const card = await getCardForUser(cardId, userId);
  if (!card) throw new EbaySellError("That card isn't in your ledger", 404);
  requireVerified(card);
  if (!card.ebayOfferId) throw new EbaySellError("Send the draft to eBay first", 409);
  // The site the OFFER was created on (stored at push), never the seller's current home.
  const mp = marketplaceByEbayId(card.ebayMarketplace);
  // A never-published offer on a different site than the seller's current one (made before their site went live)
  // must not be published as is: send the push again, which replaces it on the right site (pushDraft).
  if (!card.ebayListingId && (await sellerMarket(userId)).mp.marketplaceId !== mp.marketplaceId) {
    throw new EbayPublishNeedsError("push", "Your eBay site changed since this draft was saved -- resending it now.");
  }

  const token = await tokenFor(userId);

  // The offer was created with whatever defaults existed at push time —
  // usually nothing for a first-time seller. Resolve them now (opting in and
  // creating the location as needed), write them onto the offer, then publish.
  let defaults = await sellerDefaults(token, mp);
  let { fulfillmentPolicyId, paymentPolicyId, returnPolicyId } = defaults.policies;
  if (!fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId) {
    // An account with no policies is the normal first-publish state, not an
    // error: create plain defaults and look again (08-27 -- the Seller Hub
    // detour stopped Chris cold at the moment of first publish).
    await createDefaultPolicies(token, {
      f: !fulfillmentPolicyId,
      p: !paymentPolicyId,
      r: !returnPolicyId,
    }, mp);
    defaults = await sellerDefaults(token, mp);
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
        mp.key === "US"
          ? "eBay needs to know where you ship from. Enter your ZIP / postal code once and CardFlip saves it on your eBay account."
          : "eBay needs to know where you ship from. Enter your postcode once and CardFlip saves it on your eBay account.",
      );
    }
    // A site whose eBay rejects a postcode-only location (IE) also needs a town; never send one eBay will refuse.
    const city = ship.city?.trim();
    if (mp.locationNeedsCity && !city) {
      throw new EbayPublishNeedsError(
        "location",
        "eBay needs to know where you ship from. Enter your Eircode and your town once and CardFlip saves it on your eBay account.",
      );
    }
    // Another site's location is always in that site's country (the seller's home), whatever the client sent.
    merchantLocationKey = await createLocation(token, ship.postalCode, mp.key === "US" ? ship.country || "US" : mp.locationCountry, mp, city);
  }

  const offerPath = `/sell/inventory/v1/offer/${encodeURIComponent(card.ebayOfferId)}`;
  let current: Record<string, unknown> | null;
  try {
    current = (await ebayFetch(token, "GET", offerPath, undefined, undefined, mp)) as Record<string, unknown> | null;
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
  // A retry after a publish that went live on eBay but never reached our row: adopt eBay's listing id.
  const alreadyLive = current && String(current.status ?? "").toUpperCase() === "PUBLISHED"
    ? ((current.listing as { listingId?: string } | undefined)?.listingId ?? null)
    : null;
  if (current && !alreadyLive) {
    // updateOffer replaces the offer; send it back whole with the two things
    // filled in, minus the fields eBay forbids re-sending.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { offerId, sku, marketplaceId, format, status, listing, ...rest } = current;
    await retryingAvailabilityLag("offer update", () =>
      ebayFetch(token, "PUT", offerPath, {
        ...rest,
        listingPolicies: {
          ...((rest.listingPolicies as Record<string, unknown>) ?? {}),
          fulfillmentPolicyId,
          paymentPolicyId,
          returnPolicyId,
        },
        merchantLocationKey,
      }, undefined, mp),
    );
  }

  const publishPath = `/sell/inventory/v1/offer/${encodeURIComponent(card.ebayOfferId)}/publish`;
  let json: { listingId?: string; warnings?: EbayApiError[] } | null;
  if (alreadyLive) {
    json = { listingId: alreadyLive };
  } else {
    try {
      json = (await retryingAvailabilityLag("publish", () => ebayFetch(token, "POST", publishPath, undefined, undefined, mp))) as { listingId?: string; warnings?: EbayApiError[] } | null;
    } catch (err) {
      // The offer may already be live (an earlier publish whose reply or DB write was lost): ask eBay
      // and adopt its listing id rather than leaving the row unmarked and every retry erroring.
      const live = err instanceof EbaySellError ? await liveListingId(token, offerPath, mp) : null;
      if (!live) throw err;
      json = { listingId: live };
    }
  }
  if (!json?.listingId) throw new EbaySellError("eBay published no listing id", 502);

  const now = Date.now();
  const listingFields = {
    sku: skuForCard(card.id),
    offerId: card.ebayOfferId,
    listingId: json.listingId,
    publishedAt: now,
  };
  try {
    await setCardEbayListing(card.id, userId, listingFields);
  } catch (err) {
    // Live on eBay but the write failed: one retry with the id eBay itself reports, so the row isn't left unmarked.
    console.error("eBay publish: DB write after publish failed, retrying:", err);
    const live = (await liveListingId(token, offerPath, mp)) ?? json.listingId;
    json = { ...json, listingId: live };
    await setCardEbayListing(card.id, userId, { ...listingFields, listingId: live });
  }
  // The ledger figure for a local listing follows list_price_local at today's rate (a push-time figure can have
  // been rewritten by the live refresh while the draft sat there); list_price_local itself is never touched here.
  if (isLocalMarketplace(mp) && card.listPriceLocal != null) {
    try {
      const rate = (await getFxRates())?.rates[mp.currency];
      if (typeof rate === "number" && rate > 0) {
        await setCardListingMarket(card.id, userId, {
          marketplace: mp.marketplaceId,
          currency: card.listCurrency ?? mp.currency,
          priceLocal: card.listPriceLocal,
          priceUsd: toUsd(card.listPriceLocal, rate),
        });
      }
    } catch (err) {
      console.warn("eBay publish: could not refresh the USD ledger price:", err instanceof Error ? err.message : err);
    }
  }
  const listingId = json.listingId as string;
  const saved = await updateCard(card.id, userId, { status: "listed", listedAt: now });

  return {
    card: saved ?? card,
    listingId,
    listingUrl: ebayListingUrl(listingId, mp),
    warnings: (json.warnings ?? [])
      .map((w) => w.longMessage || w.message || "")
      .filter(Boolean),
  };
}
