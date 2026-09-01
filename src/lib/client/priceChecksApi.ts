"use client";

import { apiPath } from "@/lib/client/basePath";
import type { GameId, PokemonCard, ScanLanguage } from "@/lib/types";

export interface PriceCheckEntry {
  id: string;
  userId: string;
  cardName: string;
  setName: string;
  cardNumber: string;
  language: ScanLanguage;
  representativePrice: number | null;
  prices: PokemonCard["prices"];
  checkedAt: number;
  /** Catalog id + game so the history can reopen the card. Null on old rows. */
  cardId: string | null;
  game: GameId | null;
}

export async function fetchPriceCheckHistory(): Promise<PriceCheckEntry[]> {
  const res = await fetch(apiPath("/api/price-checks"));
  if (!res.ok) return [];
  const data = await res.json();
  return data.entries ?? [];
}

export async function deletePriceCheck(id: string): Promise<boolean> {
  try {
    const res = await fetch(apiPath(`/api/price-checks/${id}`), { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearPriceChecks(): Promise<boolean> {
  try {
    const res = await fetch(apiPath("/api/price-checks"), { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function logPriceCheck(
  card: PokemonCard,
  language: ScanLanguage,
): Promise<PriceCheckEntry | null> {
  try {
    const res = await fetch(apiPath("/api/price-checks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card, language }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.entry ?? null;
  } catch {
    return null;
  }
}
