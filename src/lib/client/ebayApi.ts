"use client";

import { apiPath } from "@/lib/client/basePath";
import type { EbayComps, EbayCompsStatus, PokemonCard } from "@/lib/types";

export interface EbayCompsResult {
  status: EbayCompsStatus;
  comps: EbayComps | null;
  searchUrl: string | null;
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
      return {
        status: data?.status === "unconfigured" ? "unconfigured" : "error",
        comps: null,
        searchUrl: data?.searchUrl ?? null,
      };
    }

    return {
      status: (data?.status as EbayCompsStatus) ?? "error",
      comps: data?.comps ?? null,
      searchUrl: data?.searchUrl ?? null,
    };
  } catch {
    return { status: "error", comps: null, searchUrl: null };
  }
}
