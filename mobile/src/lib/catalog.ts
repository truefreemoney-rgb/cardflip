/**
 * The catalog as the app shows it: the website's own helpers (lib/cards.ts
 * for the API calls, lib/listing.ts for WHICH price a card shows, lib/money.ts
 * for how it prints) so the app and the site can never disagree on a number.
 */
import { fetchCardById, fetchSetCards, fetchSets, searchTyped } from "@/lib/cards";
import { GAMES, GAME_IDS } from "@/lib/games";
import { formatMoney } from "@/lib/money";
import { pickPrice, priceFlagOf } from "@/lib/listing";
import { PRICE_FLAG_NOTE } from "@/lib/priceFlag";
import type { SetInfo } from "@/lib/grading";
import type { GameId, PokemonCard } from "@/lib/types";
import { API_URL } from "./api";

export type { GameId, PokemonCard, SetInfo };
export { GAMES, GAME_IDS, fetchCardById, fetchSetCards, fetchSets, searchTyped, PRICE_FLAG_NOTE };

/** The games the public can use right now (admin-only ones stay hidden); the full list if the call fails. */
export async function publicGames(): Promise<GameId[]> {
  try {
    const res = await fetch(`${API_URL}/api/catalog/games`);
    const j = res.ok ? await res.json() : null;
    return Array.isArray(j?.games) && j.games.length ? (j.games as GameId[]) : [...GAME_IDS];
  } catch {
    return [...GAME_IDS];
  }
}

/** Pictures come as cardflip.io/pics/... paths or full URLs; the app needs a full URL either way. */
export function pictureUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

export interface ShownPrice {
  /** "$12.34", or null when the guard flags the price (then `note` is the sentence to show). */
  text: string | null;
  /** Which row the number came from ("Holofoil", "eBay sold"), for the detail screen. */
  label: string | null;
  note: string | null;
}

/** The one number a card shows, picked exactly as the website picks it. */
export function shownPrice(card: PokemonCard): ShownPrice {
  const flag = priceFlagOf(card);
  if (flag) {
    // The guard's own fallback (10-17: "we cant have unpriced cards") keeps a number on screen with the note under it.
    return typeof flag.fallback === "number" && flag.fallback > 0
      ? { text: formatMoney(flag.fallback, "USD"), label: null, note: PRICE_FLAG_NOTE }
      : { text: null, label: null, note: PRICE_FLAG_NOTE };
  }
  const p = pickPrice(card);
  if (!p || p.market == null) return { text: null, label: null, note: "No market price yet" };
  return { text: formatMoney(p.market, p.currency), label: p.label, note: null };
}

/** Pokémon has no set codes in the list; the others key sets by code when they have one. */
export function setKey(set: SetInfo): string {
  return set.code ?? set.name;
}
