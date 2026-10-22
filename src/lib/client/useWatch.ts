"use client";

import { useRef } from "react";
import { useOptionalSession } from "@/components/SessionProvider";
import { addToWishlist, type WishlistItem } from "@/lib/client/wishlistApi";
import type { PokemonCard, ScanLanguage } from "@/lib/types";

/**
 * "added" = saved (item is the row; the server hands back the existing row on a duplicate).
 * "duplicate" = the caller already has it watched, or the same card is mid-save: nothing sent.
 * "signed-out" = no user, nothing sent. "failed" = the save did not land.
 */
export type WatchResult =
  | { status: "added"; item: WishlistItem }
  | { status: "duplicate" | "signed-out" | "failed" };

/**
 * One way to put a card on the watchlist (10-22: the Sets page, Search, the Watchlist and the card sheet each had
 * their own guard and duplicate handling). The caller keeps its own toast wording; this does the POST.
 */
export function useWatch() {
  const user = useOptionalSession()?.user;
  const inFlight = useRef<Set<string>>(new Set());

  return async function watch(
    card: PokemonCard,
    language: ScanLanguage,
    price: number | null,
    variant?: string | null,
    alreadyWatched = false,
  ): Promise<WatchResult> {
    if (!user) return { status: "signed-out" };
    if (alreadyWatched || inFlight.current.has(card.id)) return { status: "duplicate" };
    inFlight.current.add(card.id);
    try {
      const item = await addToWishlist(card, language, price, variant);
      return item ? { status: "added", item } : { status: "failed" };
    } finally {
      inFlight.current.delete(card.id);
    }
  };
}
