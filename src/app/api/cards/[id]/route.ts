import { NextResponse } from "next/server";
import { doubtedCardsAmong, giveBackDoubtedDeletes } from "@/lib/server/scanGiveback";
import { requireUser, AuthError } from "@/lib/server/auth";
import { deleteCard, getCardForUser, updateCard, type CardStatus } from "@/lib/server/cards";
import { deleteCardPhoto } from "@/lib/server/cardPhotos";
import { ledgerFloorProblem, listedFloorProblem } from "@/lib/server/ebayMarket";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => null);

    const status: CardStatus | undefined =
      body?.status === "ready" || body?.status === "listed" || body?.status === "sold"
        ? body.status
        : undefined;

    // Sold rows are the record (Chris, 09-08): the sale price can be corrected,
    // but a sold card never goes back to a draft or a listing.
    if (status !== undefined && status !== "listed") {
      const existing = await getCardForUser(id, user.id);
      if (status !== "sold" && existing?.status === "sold") {
        return NextResponse.json({ error: "Sold cards stay on the record — they can't be relisted or turned back into drafts." }, { status: 409 });
      }
      // A LIVE eBay listing is ended through /api/ebay/end (which moves the row itself); a bare status flip
      // would leave the listing live on eBay with no row behind it (review 10-19 #11). eBay's own sales land
      // through the sync, not this route.
      if (existing?.status === "listed" && existing.ebayListingId && !existing.ebayEndedAt) {
        return NextResponse.json({ error: "This card is live on eBay — end the listing first." }, { status: 409 });
      }
      // No sale off an unverified match (Chris 10-20): the Sold record would carry a card nobody checked.
      // Same test as the Verify Match button; a PATCH that verifies in the same breath passes.
      if (
        status === "sold" &&
        existing?.status === "ready" &&
        existing.kind !== "sealed" &&
        !existing.verifiedAt &&
        typeof body?.verifiedAt !== "number"
      ) {
        return NextResponse.json({ error: "Verify the match first, then mark it sold." }, { status: 409 });
      }
    }
    // Never under the fee floor (lib/fees.ts) — the server is the truth here.
    if (body?.price !== undefined) {
      if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price < 0) {
        return NextResponse.json({ error: "price must be a non-negative number" }, { status: 400 });
      }
      // Offer already on another eBay site: THAT site's floor (the card carries it); else the seller's current site.
      const existingForFloor = await getCardForUser(id, user.id);
      const problem =
        existingForFloor?.ebayOfferId
          ? await listedFloorProblem(user.id, existingForFloor, body.price)
          : await ledgerFloorProblem(user.id, body.price);
      if (problem) {
        return NextResponse.json({ error: problem }, { status: 400 });
      }
    }
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
    // Nullable numeric columns (dates, a sale price): a finite number >= 0 lands, anything else clears (review 10-19 pricing #14).
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
    const card = await updateCard(id, user.id, {
      cardName: str(body?.cardName, 200),
      setName: str(body?.setName, 200),
      cardNumber: str(body?.cardNumber, 40),
      imageUrl: str(body?.imageUrl, 500),
      catalogCardId:
        "catalogCardId" in (body ?? {}) ? (typeof body.catalogCardId === "string" ? body.catalogCardId.slice(0, 80) : null) : undefined,
      rarity: "rarity" in (body ?? {}) ? (typeof body.rarity === "string" ? body.rarity.slice(0, 60) : null) : undefined,
      category:
        "category" in (body ?? {}) ? (typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 40) : null) : undefined,
      condition: str(body?.condition, 40),
      price: typeof body?.price === "number" ? body.price : undefined,
      quantity:
        typeof body?.quantity === "number" && Number.isFinite(body.quantity)
          ? Math.min(99, Math.max(1, Math.floor(body.quantity)))
          : undefined,
      status,
      // A seller's own "sold" is a hand-marked sale (updateCard only stamps it on the move INTO sold).
      soldByHand: status === "sold" ? true : undefined,
      listedAt: "listedAt" in (body ?? {}) ? num(body.listedAt) : undefined,
      soldPrice: "soldPrice" in (body ?? {}) ? num(body.soldPrice) : undefined,
      soldAt: "soldAt" in (body ?? {}) ? num(body.soldAt) : undefined,
      verifiedAt:
        "verifiedAt" in (body ?? {})
          ? typeof body.verifiedAt === "number"
            ? body.verifiedAt
            : null
          : undefined,
      matchDoubt:
        "matchDoubt" in (body ?? {})
          ? typeof body.matchDoubt === "string"
            ? body.matchDoubt.slice(0, 80)
            : null
          : undefined,
      firstEdition: typeof body?.firstEdition === "boolean" ? body.firstEdition : undefined,
      // Variant / Magic finish: a non-empty string lands, anything else clears it.
      variant:
        "variant" in (body ?? {})
          ? typeof body.variant === "string" && body.variant.trim()
            ? body.variant.trim().slice(0, 40)
            : null
          : undefined,
      priceLocked: typeof body?.priceLocked === "boolean" ? body.priceLocked : undefined,
      // The market the scanner shows for a swapped card / printing (packs sum it): a finite number > 0 lands, anything else clears it.
      scanMarket:
        "scanMarket" in (body ?? {})
          ? typeof body.scanMarket === "number" && Number.isFinite(body.scanMarket) && body.scanMarket > 0
            ? body.scanMarket
            : null
          : undefined,
      // Shipping pick (10-08): "envelope" | "tracked" lands, anything else clears it.
      shippingMethod:
        "shippingMethod" in (body ?? {})
          ? body.shippingMethod === "envelope" || body.shippingMethod === "tracked"
            ? body.shippingMethod
            : null
          : undefined,
      // What they paid (09-27): a finite number >= 0 lands (to the cent), anything else clears it.
      costBasis:
        "costBasis" in (body ?? {})
          ? typeof body.costBasis === "number" && Number.isFinite(body.costBasis) && body.costBasis >= 0
            ? Math.round(body.costBasis * 100) / 100
            : null
          : undefined,
      // Price alert (09-27): a finite number > 0 lands (to the cent), anything else clears it.
      alertPrice:
        "alertPrice" in (body ?? {})
          ? typeof body.alertPrice === "number" && Number.isFinite(body.alertPrice) && body.alertPrice > 0
            ? Math.round(body.alertPrice * 100) / 100
            : null
          : undefined,
    });

    if (!card) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }
    return NextResponse.json({ card });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const existing = await getCardForUser(id, user.id);
    // Sold rows are the record (Chris, 09-08): never deleted.
    if (existing?.status === "sold") {
      return NextResponse.json({ error: "Sold cards stay on the record and can't be deleted." }, { status: 409 });
    }
    // Review 10-19 #11: deleting the row would leave the eBay listing live with nothing behind it.
    if (existing?.status === "listed" && existing.ebayListingId && !existing.ebayEndedAt) {
      return NextResponse.json({ error: "This card is live on eBay — end the listing first." }, { status: 409 });
    }
    if (existing) await deleteCardPhoto(id);
    // A card the scanner itself doubted gives its scan back (10-21); read before the row goes.
    const doubted = await doubtedCardsAmong(user.id, [id]);
    await deleteCard(id, user.id);
    const scansBack = await giveBackDoubtedDeletes(user, doubted);
    return NextResponse.json({ ok: true, scansBack });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
