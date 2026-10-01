"use client";

import { useEffect, useState } from "react";
import { useOptionalSession } from "@/components/SessionProvider";
import { apiFetch } from "@/lib/client/basePath";
import { belowFloor, belowFloorFor, floorRefusal, floorRefusalFor, listingFloor, listingFloorFor } from "@/lib/fees";
import { toLocal } from "@/lib/localPricing";
import { quoteLocalListing, type LocalListingQuote, type LocalMarketInfo } from "@/lib/localQuote";
import {
  LOCAL_MARKET_COUNTRIES,
  MARKETPLACES,
  type MarketplaceKey,
} from "@/lib/marketplaces";
import type { PriceStrategy } from "@/lib/types";

export { quoteLocalListing };
export type { LocalListingQuote, LocalMarketInfo };

let cached: Promise<LocalMarketInfo | null> | null = null;

function loadLocalMarket(): Promise<LocalMarketInfo | null> {
  cached ??= apiFetch("/api/ebay/market", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((b): LocalMarketInfo | null => {
      if (!b?.local || !(b.key in MARKETPLACES)) return null;
      return { mp: MARKETPLACES[b.key as MarketplaceKey], account: b.account ?? null, rate: typeof b.rate === "number" ? b.rate : null, rateDate: b.rateDate ?? null };
    })
    .catch(() => {
      cached = null; // try again next mount
      return null;
    });
  return cached;
}

/** The seller's local site, or null (eBay US, still loading, signed out, or the lookup failed). */
export function useLocalMarket(): LocalMarketInfo | null {
  const session = useOptionalSession();
  const home = session?.status === "ready" ? (session.user?.homeCountry ?? "").toUpperCase() : "";
  const maybeLocal = (LOCAL_MARKET_COUNTRIES as readonly string[]).includes(home);
  const [info, setInfo] = useState<LocalMarketInfo | null>(null);
  useEffect(() => {
    if (!maybeLocal) return;
    let alive = true;
    void loadLocalMarket().then((v) => alive && setInfo(v));
    return () => {
      alive = false;
    };
  }, [maybeLocal]);
  return maybeLocal ? info : null;
}

export interface PriceFloor {
  /** The lowest USD price a seller may save (US: the original floor; local: the site's break-even at today's rate). */
  floor: number;
  below: (usd: number) => boolean;
  /** The sentence the server would refuse with. */
  refusal: () => string;
}

/**
 * The floor the editors clamp to. US sellers (and anyone without a usable
 * rate) get exactly the original lib/fees.ts floor; a seller on another site
 * is held to that site's break-even in their currency, converted at the rate.
 */
export function priceFloorFor(info: LocalMarketInfo | null): PriceFloor {
  if (!info || !info.rate) return { floor: listingFloor(), below: belowFloor, refusal: floorRefusal };
  const { mp, account, rate } = info;
  return {
    floor: Math.ceil((listingFloorFor(mp, account) / rate) * 100) / 100,
    below: (usd) => belowFloorFor(mp, toLocal(usd, rate), account),
    refusal: () => floorRefusalFor(mp, account),
  };
}

export function usePriceFloor(): PriceFloor {
  return priceFloorFor(useLocalMarket());
}

/** The server's own answer for one card (ebayMarket.ts quoteCardForSite): the number that will be listed, or why it will be refused. */
export type ServerLocalAsk =
  | { price: number; text: string; basis: "typed" | "market"; floor: number; label: string; error?: undefined }
  | { error: string; label: string };

/**
 * Ask the server what pushing this card would list at, by the code the push
 * itself runs. null = not a local seller / the lookup failed (callers show
 * nothing rather than a guess).
 */
export async function fetchLocalAsk(cardId: string, strategy: PriceStrategy = "market"): Promise<ServerLocalAsk | null> {
  try {
    const res = await apiFetch(`/api/ebay/market?cardId=${encodeURIComponent(cardId)}&strategy=${strategy}`, { cache: "no-store" });
    if (!res.ok) return null;
    const b = await res.json();
    const a = b?.ask;
    if (!b?.local || !a) return null;
    if (typeof a.error === "string") return { error: a.error, label: a.label };
    return { price: a.price, text: a.text, basis: a.basis, floor: a.floor, label: a.label };
  } catch {
    return null;
  }
}
