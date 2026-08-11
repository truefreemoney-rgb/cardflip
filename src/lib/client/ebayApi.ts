"use client";

import { apiPath } from "@/lib/client/basePath";
import type {
  EbayComps,
  EbayCompsStatus,
  EbaySoldStatus,
  PokemonCard,
} from "@/lib/types";

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
