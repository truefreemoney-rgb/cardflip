"use client";

import { apiPath } from "@/lib/client/basePath";

export interface ServerCard {
  id: string;
  userId: string;
  kind: "card" | "sealed";
  /** "pokemon" | "mtg" — absent on rows written before games existed. */
  game?: "pokemon" | "mtg";
  cardName: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  condition: string;
  /** Sealed rows only: "Booster Box", "Elite Trainer Box", ... */
  productType: string | null;
  status: "ready" | "listed" | "sold";
  price: number;
  /** Identical copies this row sells (listing quantity, default 1). */
  quantity: number;
  /** Catalog id (pokemontcg.io / Scryfall); null on rows scanned before it was stored. */
  catalogCardId: string | null;
  listedAt: number | null;
  soldPrice: number | null;
  soldAt: number | null;
  /** Actual eBay fee for this sale (Finances API); null = the estimate applies. */
  soldFees: number | null;
  /** Last time a discount offer went to this listing's watchers. */
  watcherOfferAt: number | null;
  /** Seller confirmed the match ("Verify match"); null locks eBay publishing. */
  verifiedAt: number | null;
  /** Why the scan was doubtful ("low-confidence read", ...), null if clean. */
  matchDoubt: string | null;
  /** 1st Edition stamp — read by the scanner or ticked in the editor. */
  firstEdition: boolean;
  /** Server-issued once the draft was pushed to / published on the seller's eBay account. */
  ebayOfferId: string | null;
  ebayListingId: string | null;
  ebayListingUrl: string | null;
  ebayDraftUrl: string | null;
  ebayPushedAt: number | null;
  ebayPublishedAt: number | null;
  /** Set when the sync found the live listing ended on eBay without a sale. */
  ebayEndedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Set when the seller's own scan photo is stored — served by /api/card-image/[id]. */
  photoAt: number | null;
}

export interface CreateCardInput {
  kind?: "card" | "sealed";
  game?: "pokemon" | "mtg";
  cardName: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  condition: string;
  productType?: string | null;
  price: number;
  catalogCardId?: string | null;
}

export interface UpdateCardInput {
  condition?: string;
  price?: number;
  quantity?: number;
  status?: "ready" | "listed" | "sold";
  listedAt?: number | null;
  soldPrice?: number | null;
  soldAt?: number | null;
  verifiedAt?: number | null;
  matchDoubt?: string | null;
  firstEdition?: boolean;
}

export async function fetchServerCards(): Promise<ServerCard[]> {
  try {
    const res = await fetch(apiPath("/api/cards"));
    if (!res.ok) return [];
    const data = await res.json();
    return data.cards ?? [];
  } catch {
    return [];
  }
}

export interface RepriceNudge {
  cardId: string;
  market: number;
  listedPrice: number;
  /** (market - listed) / listed; negative = market fell below the ask. */
  drift: number;
}

/** Listed cards whose asking price the market has left behind (±15%, 7d+). */
export async function fetchRepriceNudges(): Promise<RepriceNudge[]> {
  try {
    const res = await fetch(apiPath("/api/cards/reprice-nudges"));
    if (!res.ok) return [];
    const data = await res.json();
    return data.nudges ?? [];
  } catch {
    return [];
  }
}

export interface RepriceResult {
  ok: boolean;
  /** True when the live eBay offer took the new price too. */
  ebayUpdated: boolean;
  /** eBay's words when it didn't (ledger price is still changed). */
  ebayError: string | null;
}

/** Apply a nudge: new ledger price + the live eBay offer where one exists. */
export async function repriceCard(cardId: string, price: number): Promise<RepriceResult> {
  try {
    const res = await fetch(apiPath("/api/ebay/reprice"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, price }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, ebayUpdated: false, ebayError: data?.error ?? null };
    return { ok: true, ebayUpdated: Boolean(data?.ebayUpdated), ebayError: data?.ebayError ?? null };
  } catch {
    return { ok: false, ebayUpdated: false, ebayError: null };
  }
}

export async function createServerCard(
  input: CreateCardInput,
): Promise<ServerCard | null> {
  try {
    const res = await fetch(apiPath("/api/cards"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.card ?? null;
  } catch {
    return null;
  }
}

export async function updateServerCard(
  id: string,
  patch: UpdateCardInput,
): Promise<boolean> {
  // Resolves false (never throws) so callers can keep the optimistic update
  // and only roll back / warn when the write actually didn't land.
  try {
    const res = await fetch(apiPath(`/api/cards/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteServerCard(id: string): Promise<boolean> {
  try {
    const res = await fetch(apiPath(`/api/cards/${id}`), { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
