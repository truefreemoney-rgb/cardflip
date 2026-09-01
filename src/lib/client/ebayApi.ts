"use client";

import { apiPath } from "@/lib/client/basePath";
import type {
  EbayComps,
  EbayCompsStatus,
  EbaySoldStatus,
  PokemonCard,
} from "@/lib/types";
import type { DraftInput } from "@/lib/ebayInventory";
import { uploadCardPhoto } from "@/lib/client/cardPhotoApi";

export interface EbayCompsResult {
  status: EbayCompsStatus;
  comps: EbayComps | null;
  /** What the card has actually sold for, when Marketplace Insights is available. */
  sold: EbayComps | null;
  soldStatus: EbaySoldStatus;
  searchUrl: string | null;
  soldSearchUrl: string | null;
}

/**
 * Never throws — a failed comps lookup degrades the card's pricing, it
 * doesn't break the scan that produced the card.
 */
export async function fetchEbayComps(card: PokemonCard): Promise<EbayCompsResult> {
  try {
    const res = await fetch(apiPath("/api/ebay/comps"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const unconfigured = data?.status === "unconfigured";
      return {
        status: unconfigured ? "unconfigured" : "error",
        comps: null,
        sold: null,
        soldStatus: unconfigured ? "unconfigured" : "unavailable",
        searchUrl: data?.searchUrl ?? null,
        soldSearchUrl: data?.soldSearchUrl ?? null,
      };
    }

    return {
      status: (data?.status as EbayCompsStatus) ?? "error",
      comps: data?.comps ?? null,
      sold: data?.sold ?? null,
      soldStatus: (data?.soldStatus as EbaySoldStatus) ?? "unavailable",
      searchUrl: data?.searchUrl ?? null,
      soldSearchUrl: data?.soldSearchUrl ?? null,
    };
  } catch {
    return {
      status: "error",
      comps: null,
      sold: null,
      soldStatus: "unavailable",
      searchUrl: null,
      soldSearchUrl: null,
    };
  }
}

export interface EbayLinkStatus {
  /** Server has a keyset + RuName, so "Connect with eBay" can actually start. */
  available: boolean;
  /** The shared demo account — never allowed to link a real eBay account. */
  demo: boolean;
  connected: boolean;
  ebayUsername: string | null;
  connectedAt: number | null;
  refreshExpiresAt: number | null;
}

export async function fetchEbayStatus(): Promise<EbayLinkStatus | null> {
  try {
    const res = await fetch(apiPath("/api/ebay/status"));
    if (!res.ok) return null;
    return (await res.json()) as EbayLinkStatus;
  } catch {
    return null;
  }
}

export async function disconnectEbay(): Promise<boolean> {
  try {
    const res = await fetch(apiPath("/api/ebay/disconnect"), { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

export interface SalesSyncResponse {
  sold: import("@/lib/client/cardsApi").ServerCard[];
  /** Listed cards whose eBay listing ended without a sale — chip, don't flip. */
  ended?: import("@/lib/client/cardsApi").ServerCard[];
  skipped?: "not_connected" | "no_scope" | "no_listings" | "throttled" | "error";
}

/**
 * Ask the server to pull recent eBay orders and flip sold cards. Safe to call
 * on every ledger load — the server throttles the real eBay work.
 */
export async function syncEbaySales(): Promise<SalesSyncResponse | null> {
  try {
    const res = await fetch(apiPath("/api/ebay/sync-sales"), { method: "POST" });
    if (!res.ok) return null;
    return (await res.json()) as SalesSyncResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Offers to watchers (Negotiation API)

export interface WatcherEligibleResponse {
  eligibleCardIds: string[];
  /** Why the list is empty when it is: reconnect needed, or eBay was down. */
  skipped?: "not_connected" | "no_scope" | "error";
}

export async function fetchWatcherEligible(): Promise<WatcherEligibleResponse | null> {
  try {
    const res = await fetch(apiPath("/api/ebay/offers"));
    if (!res.ok) return null;
    return (await res.json()) as WatcherEligibleResponse;
  } catch {
    return null;
  }
}

/** Sends a REAL discount offer to everyone watching this card's listing. */
export async function sendWatcherOffer(
  cardId: string,
  discountPercent: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(apiPath("/api/ebay/offers"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, discountPercent }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: data?.error ?? "Couldn't send the offer." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't reach the server — try again." };
  }
}

/** The seller's My eBay › Drafts page — where Listing API drafts land. */
export const EBAY_DRAFTS_URL = "https://www.ebay.com/mye/myebay/drafts";

/** Where the "Connect with eBay" button points — a full-page redirect to eBay. */
export const EBAY_CONNECT_PATH = apiPath("/api/ebay/connect");

// ---------------------------------------------------------------------------
// Posting to the seller's eBay account (Sell Inventory API)

export type EbayPostErrorCode =
  | "auth"
  | "demo"
  | "not_connected"
  | "needs_push"
  | "needs_location"
  | "needs_policies"
  | "needs_photo"
  | "needs_reconnect"
  | "photo"
  | "draft_unavailable"
  | "unconfigured"
  | "invalid"
  | "ebay"
  | "network";

export interface EbayPostFailure {
  ok: false;
  code: EbayPostErrorCode;
  message: string;
  details: string[];
}

export interface EbayPushSuccess {
  ok: true;
  offerId: string;
  updated: boolean;
  attached: { fulfillment: boolean; payment: boolean; return: boolean; location: boolean };
  /** Parts eBay refused and the draft was created without (empty on a clean push). */
  degraded: string[];
  listingUrl: string | null;
  /** Set when this call uploaded the seller's photo first. */
  photoAt: number | null;
}

export interface EbayDraftSuccess {
  ok: true;
  draftId: string;
  /** Opens the draft in eBay's listing tool; also under My eBay › Drafts. */
  draftUrl: string | null;
  photoAt: number | null;
}

export interface EbayPublishSuccess {
  ok: true;
  listingId: string;
  listingUrl: string;
  warnings: string[];
  listedAt: number | null;
}

async function postJson<T>(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | EbayPostFailure> {
  try {
    const res = await fetch(apiPath(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as
      | (T & { error?: EbayPostErrorCode; message?: string; details?: string[] })
      | null;
    if (!res.ok || !json) {
      return {
        ok: false,
        code: json?.error ?? "ebay",
        message: json?.message ?? `eBay request failed (${res.status})`,
        details: json?.details ?? [],
      };
    }
    return { ok: true, data: json };
  } catch {
    return { ok: false, code: "network", message: "Couldn't reach CardFlip — check your connection", details: [] };
  }
}

/**
 * Create or update the draft in the seller's eBay account. `draft` is exactly
 * what the editor shows plus the facts about the copy; see DraftInput. The
 * server decides whether a listing photo exists (`hasPhoto`), so it isn't
 * sent — pass `photo` (the seller's scan, not yet uploaded) and it goes up
 * first; without one the server answers `needs_photo` and the UI asks for it.
 */
export async function pushEbayDraft(
  draft: Omit<DraftInput, "hasPhoto">,
  photo: File | null = null,
): Promise<EbayPushSuccess | EbayPostFailure> {
  let photoAt: number | null = null;
  if (photo) {
    const uploaded = await uploadCardPhoto(draft.cardId, photo);
    if (!uploaded.ok) return { ok: false, code: "photo", message: uploaded.message, details: [] };
    photoAt = uploaded.photoAt;
  }
  const result = await postJson<Omit<EbayPushSuccess, "ok" | "photoAt">>("/api/ebay/listing", draft);
  return result.ok ? { ok: true, ...result.data, photoAt } : result;
}

/**
 * "Send draft to eBay": a Listing API draft in the seller's account — shows
 * in My eBay › Drafts, opens pre-filled in eBay's listing tool. Same photo
 * rule as the push: `photo` uploads first when given.
 */
export async function createEbayDraft(
  draft: Omit<DraftInput, "hasPhoto">,
  photo: File | null = null,
): Promise<EbayDraftSuccess | EbayPostFailure> {
  let photoAt: number | null = null;
  if (photo) {
    const uploaded = await uploadCardPhoto(draft.cardId, photo);
    if (!uploaded.ok) return { ok: false, code: "photo", message: uploaded.message, details: [] };
    photoAt = uploaded.photoAt;
  }
  const result = await postJson<{ draftId: string; draftUrl: string | null }>("/api/ebay/draft", draft);
  return result.ok ? { ok: true, ...result.data, photoAt } : result;
}

export type EbaySendResult =
  | ({ via: "listing" } & EbayDraftSuccess)
  | ({ via: "inventory" } & EbayPushSuccess)
  | EbayPostFailure;

// Remembered per page load: once the server says the Listing API isn't
// enabled for CardFlip's keyset, go straight to the Inventory draft.
let listingDraftsUnavailable = false;

/**
 * "Send draft to eBay", whichever road eBay lets us take: the Listing API
 * draft (My eBay › Drafts) when it's enabled, else the Inventory draft that
 * has worked since the first live listing (saved on eBay, published from
 * CardFlip). The photo uploads once, before whichever call runs.
 */
export async function sendEbayDraft(
  draft: Omit<DraftInput, "hasPhoto">,
  photo: File | null = null,
): Promise<EbaySendResult> {
  let photoAt: number | null = null;
  if (photo) {
    const uploaded = await uploadCardPhoto(draft.cardId, photo);
    if (!uploaded.ok) return { ok: false, code: "photo", message: uploaded.message, details: [] };
    photoAt = uploaded.photoAt;
  }
  if (!listingDraftsUnavailable) {
    const viaListing = await createEbayDraft(draft);
    if (viaListing.ok) return { via: "listing", ...viaListing, photoAt };
    if (viaListing.code !== "draft_unavailable") return viaListing;
    listingDraftsUnavailable = true;
  }
  const viaInventory = await pushEbayDraft(draft);
  return viaInventory.ok ? { via: "inventory", ...viaInventory, photoAt } : viaInventory;
}

/**
 * Publish the pushed draft — goes live on eBay, fees apply. `shipFrom` is
 * only needed the first time, when eBay has no item location for the seller
 * yet (the server answers `needs_location` until it's given).
 */
export async function publishEbayDraft(
  cardId: string,
  shipFrom?: { postalCode: string; country?: string },
): Promise<EbayPublishSuccess | EbayPostFailure> {
  const result = await postJson<Omit<EbayPublishSuccess, "ok">>("/api/ebay/listing/publish", {
    cardId,
    shipFromPostalCode: shipFrom?.postalCode,
    shipFromCountry: shipFrom?.country ?? "US",
  });
  return result.ok ? { ok: true, ...result.data } : result;
}
