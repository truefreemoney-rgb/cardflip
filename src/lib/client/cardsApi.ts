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
  listedAt: number | null;
  soldPrice: number | null;
  soldAt: number | null;
  /** Server-issued once the draft was pushed to / published on the seller's eBay account. */
  ebayOfferId: string | null;
  ebayListingId: string | null;
  ebayListingUrl: string | null;
  ebayDraftUrl: string | null;
  ebayPushedAt: number | null;
  ebayPublishedAt: number | null;
  createdAt: number;
  updatedAt: number;
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
}

export interface UpdateCardInput {
  condition?: string;
  price?: number;
  status?: "ready" | "listed" | "sold";
  listedAt?: number | null;
  soldPrice?: number | null;
  soldAt?: number | null;
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
): Promise<void> {
  try {
    await fetch(apiPath(`/api/cards/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    // Best-effort sync — the local queue stays the source of truth for the UI.
  }
}

export async function deleteServerCard(id: string): Promise<void> {
  try {
    await fetch(apiPath(`/api/cards/${id}`), { method: "DELETE" });
  } catch {
    // Best-effort — local removal already happened.
  }
}
