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
import { canBeFirstEdition } from "@/lib/listing";
import { recordPoint } from "@/lib/server/priceHistory";
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

    // Optional slab pricing: with a company+grade, the comps become
    // "what are copies at exactly this grade listed for".
    const grading =
      typeof body?.grading?.company === "string" && typeof body?.grading?.grade === "string"
        ? { company: String(body.grading.company).slice(0, 10), grade: String(body.grading.grade).slice(0, 20) }
        : null;

    // Both links work without any API access, so the UI can always point the
    // seller at eBay even when we have no credentials to price against.
    // 1st Edition is a separate market (Chris, 09-04): only meaningful for
    // sets that had a 1st Edition run; elsewhere the flag is ignored.
    const firstEdition =
      typeof body?.firstEdition === "boolean" && canBeFirstEdition(card) ? (body.firstEdition as boolean) : null;

    const searchUrl = ebaySearchUrl(card, { firstEdition: firstEdition === true });
    const soldSearchUrl = ebaySoldSearchUrl(card, { firstEdition: firstEdition === true });

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
      fetchEbayComps(card, grading, firstEdition),
      process.env.EBAY_INSIGHTS_ENABLED === "1"
        ? fetchEbaySoldComps(card)
        : Promise.reject(new Error("Marketplace Insights not enabled")),
    ]);

    if (activeResult.status === "rejected") throw activeResult.reason;
    const comps = activeResult.value;

    // Graded lookups are the only graded price signal anywhere — bank each
    // one as a history point (variant "graded-psa-10" style) so cards people
    // actually price grow a REAL graded curve over time, replacing the
    // chart's rescaled estimate. Fire-and-forget: recording must never sink
    // the lookup.
    if (grading && comps && comps.count >= 2 && card.id) {
      const gradeNum = grading.grade.match(/\d+(?:\.\d+)?/)?.[0] ?? grading.grade;
      const variant = `graded-${grading.company.toLowerCase()}-${gradeNum}`;
      void recordPoint(card.id, card.game ?? "pokemon", variant, "ebay", "USD", comps.average).catch((err) =>
        console.error("graded history point failed:", err),
      );
    }

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
