import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import {
  EbayNotConfiguredError,
  ebaySearchUrl,
  fetchEbayComps,
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

    // Answered before the lookup so the UI can point the seller at eBay even
    // when we have no credentials to price against.
    const searchUrl = ebaySearchUrl(card);

    if (!isEbayConfigured()) {
      return NextResponse.json({ status: "unconfigured", comps: null, searchUrl });
    }

    const comps = await fetchEbayComps(card);
    return NextResponse.json({
      status: comps ? "done" : "empty",
      comps,
      searchUrl,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof EbayNotConfiguredError) {
      return NextResponse.json({ status: "unconfigured", comps: null });
    }
    // An eBay outage shouldn't fail the scan — the card still prices off its
    // other sources, and the UI degrades to just the "view on eBay" link.
    console.error("eBay comps lookup failed:", err);
    return NextResponse.json({ status: "error", comps: null }, { status: 502 });
  }
}
