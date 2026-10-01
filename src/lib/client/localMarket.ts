"use client";

import { useEffect, useState } from "react";
import { useOptionalSession } from "@/components/SessionProvider";
import { apiFetch } from "@/lib/client/basePath";
import { belowFloor, belowFloorFor, floorRefusal, floorRefusalFor, listingFloor, listingFloorFor } from "@/lib/fees";
import { localAsk, toLocal } from "@/lib/localPricing";
import {
  LOCAL_MARKET_COUNTRIES,
  MARKETPLACES,
  formatLocalAmount,
  type EbayAccountType,
  type Marketplace,
  type MarketplaceKey,
} from "@/lib/marketplaces";
import { strategyValueUsd } from "@/lib/listing";
import type { Condition, PriceStrategy } from "@/lib/types";

/**
 * A seller on a local eBay site (CA/GB/IE/AU with the switch on, the row live
 * and their eBay account registered there) sees what their listing will cost
 * in their own currency. US sellers (the default) never reach /api/ebay/market:
 * the session's home country is checked first, so nothing changes for them.
 */
export interface LocalMarketInfo {
  mp: Marketplace;
  account: EbayAccountType | null;
  /** Local units per 1 USD; null = the rate is too old for the server to price a listing. */
  rate: number | null;
  rateDate: string | null;
}

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

export interface LocalListingQuote {
  /** The asking price in the site's currency. */
  price: number;
  /** "£3.99" */
  text: string;
  /** The site's break-even in local currency. */
  floor: number;
}

/**
 * What the server will list this card at (mirrors lib/server/ebayMarket.ts
 * resolveLocalAsk): a price the seller typed converts at the rate; otherwise
 * the USD market value (condition + Quick Sale pick applied) goes through the
 * site's fee model and cheap-card taper. Null when there is no rate or
 * nothing to price from.
 */
export function quoteLocalListing(
  info: LocalMarketInfo,
  input: { typedUsd?: number | null; marketUsd?: number | null; condition: Condition | string; strategy?: PriceStrategy },
): LocalListingQuote | null {
  if (!info.rate) return null;
  let price: number | null = null;
  if (input.typedUsd != null && input.typedUsd > 0) price = toLocal(input.typedUsd, info.rate);
  else if (input.marketUsd != null && input.marketUsd > 0) {
    const value = strategyValueUsd(input.marketUsd, input.condition, input.strategy ?? "market");
    if (value > 0) price = localAsk(info.mp, info.account, value, info.rate);
  }
  if (price == null) return null;
  return { price, text: formatLocalAmount(info.mp, price), floor: listingFloorFor(info.mp, info.account) };
}
