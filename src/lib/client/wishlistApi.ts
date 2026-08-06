"use client";

import { apiPath } from "@/lib/client/basePath";
import type { PokemonCard, ScanLanguage } from "@/lib/types";

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

export async function removeFromWishlist(id: string): Promise<void> {
  try {
    await fetch(apiPath(`/api/wishlist/${id}`), { method: "DELETE" });
  } catch {
    // Best-effort — the caller already removed it optimistically.
  }
}
