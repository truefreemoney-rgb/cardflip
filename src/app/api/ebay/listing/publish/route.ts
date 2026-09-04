import { NextResponse } from "next/server";
import { requireUser, subscriptionGate } from "@/lib/server/auth";
import { publishDraft } from "@/lib/server/ebaySell";
import { sellErrorResponse } from "@/lib/server/ebaySellRoute";

/**
 * Publish a pushed draft — the listing goes live on eBay under the seller's
 * account. Separate from the push on purpose: this is the step with fees and
 * buyers, and the seller clicks it knowingly.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const wall = subscriptionGate(user);
    if (wall) return wall;
    const body = (await request.json().catch(() => null)) as {
      cardId?: unknown;
      shipFromPostalCode?: unknown;
      shipFromCountry?: unknown;
    } | null;
    if (!body || typeof body.cardId !== "string") {
      return NextResponse.json({ error: "invalid", message: "Missing card id" }, { status: 400 });
    }
    const postalCode =
      typeof body.shipFromPostalCode === "string" ? body.shipFromPostalCode.trim().slice(0, 16) : "";
    const country =
      typeof body.shipFromCountry === "string" && /^[A-Za-z]{2}$/.test(body.shipFromCountry.trim())
        ? body.shipFromCountry.trim().toUpperCase()
        : "US";
    const result = await publishDraft(user.id, body.cardId, {
      shipFrom: postalCode ? { postalCode, country } : null,
    });
    return NextResponse.json({
      listingId: result.listingId,
      listingUrl: result.listingUrl,
      warnings: result.warnings,
      listedAt: result.card.listedAt,
    });
  } catch (err) {
    return sellErrorResponse(err);
  }
}
