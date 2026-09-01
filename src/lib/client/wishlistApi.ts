"use client";

import { apiPath } from "@/lib/client/basePath";
import type { GameId, PokemonCard, ScanLanguage } from "@/lib/types";

export interface WishlistItem {
  id: string;
  userId: string;
  cardName: string;
  englishName: string | null;
  setName: string;
  cardNumber: string;
  language: ScanLanguage;
  imageUrl: string;
  price: number | null;
  addedAt: number;
  /** Catalog id — null on rows saved before it was stored (resolved lazily by the page). */
  cardId: string | null;
  game: GameId | null;
  /** Email when the market price dips to this; null = no alert set. */
  alertPrice: number | null;
  /** When the alert email went out — quiet until the target changes. */
  alertedAt: number | null;
}

export async function fetchWishlist(): Promise<WishlistItem[]> {
  const res = await fetch(apiPath("/api/wishlist"));
  if (!res.ok) return [];
  const data = await res.json();
  return data.items ?? [];
}

export async function addToWishlist(
  card: PokemonCard,
  language: ScanLanguage,
  price: number | null,
): Promise<WishlistItem | null> {
  try {
    const res = await fetch(apiPath("/api/wishlist"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card, language, price }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.item ?? null;
  } catch {
    return null;
  }
}

/** Set (positive number) or clear (null) the price-dip alert. */
export async function setWishlistAlert(id: string, alertPrice: number | null): Promise<WishlistItem | null> {
  try {
    const res = await fetch(apiPath(`/api/wishlist/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertPrice }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.item ?? null;
  } catch {
    return null;
  }
}

export async function removeFromWishlist(id: string): Promise<boolean> {
  // Resolves false (never throws) so the caller can put the item back.
  try {
    const res = await fetch(apiPath(`/api/wishlist/${id}`), { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
