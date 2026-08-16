import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import {
  EbayNotConfiguredError,
  ebaySearchUrl,
  ebaySoldSearchUrl,
  fetchEbayComps,
  fetchEbaySoldComps,
  isEbayConfigured,
} from "@/lib/server/ebay";
import type { PokemonCard } from "@/lib/types";
import {
  LIMITS,
  RateLimitError,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/server/rateLimit";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    enforceRateLimit(`comps:${user.id}`, ...LIMITS.ebayComps);
    const body = await req.json().catch(() => null);
    const card = body?.card as PokemonCard | undefined;

    if (!card?.name) {
      return NextResponse.json({ error: "Missing card" }, { status: 400 });
    }

    // Both links work without any API access, so the UI can always point the
    // seller at eBay even when we have no credentials to price against.
    const searchUrl = ebaySearchUrl(card);
    const soldSearchUrl = ebaySoldSearchUrl(card);

    if (!isEbayConfigured()) {
      return NextResponse.json({
        status: "unconfigured",
        comps: null,
        sold: null,
        soldStatus: "unconfigured",
        searchUrl,
        soldSearchUrl,
      });
    }

    // Sold data (Marketplace Insights) was DENIED by eBay on 2026-08-16 —
    // "highly limited, reserved for approved partners". The call stays behind
    // EBAY_INSIGHTS_ENABLED=1 in case that ever changes; by default we don't
    // spend a request on it per scan, and the UI shows the "View sold on
    // eBay" link instead. Settled independently so a sold failure never
    // sinks the active comps.
    const [activeResult, soldResult] = await Promise.allSettled([
      fetchEbayComps(card),
      process.env.EBAY_INSIGHTS_ENABLED === "1"
        ? fetchEbaySoldComps(card)
        : Promise.reject(new Error("Marketplace Insights not enabled")),
    ]);

    if (activeResult.status === "rejected") throw activeResult.reason;
    const comps = activeResult.value;

    let sold = null;
    let soldStatus: "done" | "empty" | "unavailable" = "empty";
    if (soldResult.status === "fulfilled") {
      sold = soldResult.value;
      soldStatus = sold ? "done" : "empty";
    } else {
      soldStatus = "unavailable";
      // Only worth a log line when we actually asked eBay and it refused.
      if (process.env.EBAY_INSIGHTS_ENABLED === "1") {
        console.error("eBay sold comps unavailable:", soldResult.reason);
      }
    }

    return NextResponse.json({
      status: comps ? "done" : "empty",
      comps,
      sold,
      soldStatus,
      searchUrl,
      soldSearchUrl,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    if (err instanceof EbayNotConfiguredError) {
      return NextResponse.json({ status: "unconfigured", comps: null, sold: null });
    }
    // An eBay outage shouldn't fail the scan — the card still prices off its
    // other sources, and the UI degrades to just the "view on eBay" links.
    console.error("eBay comps lookup failed:", err);
    return NextResponse.json(
      { status: "error", comps: null, sold: null },
      { status: 502 },
    );
  }
}
