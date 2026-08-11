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

export async function POST(req: Request) {
  try {
    await requireUser();
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

    // Sold data needs a separately-approved eBay scope, so it can fail on its
    // own while active listings still work — settle them independently.
    const [activeResult, soldResult] = await Promise.allSettled([
      fetchEbayComps(card),
      fetchEbaySoldComps(card),
    ]);

    if (activeResult.status === "rejected") throw activeResult.reason;
    const comps = activeResult.value;

    let sold = null;
    let soldStatus: "done" | "empty" | "unavailable" = "empty";
    if (soldResult.status === "fulfilled") {
      sold = soldResult.value;
      soldStatus = sold ? "done" : "empty";
    } else {
      // Almost always "keyset not approved for Marketplace Insights" — worth
      // distinguishing from an outage so the UI can say what to do about it.
      console.error("eBay sold comps unavailable:", soldResult.reason);
      soldStatus = "unavailable";
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
