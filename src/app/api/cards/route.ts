import { parseGame } from "@/lib/games";
import { NextResponse } from "next/server";
import { requireUser, AuthError, subscriptionGate } from "@/lib/server/auth";
import { createCard, deleteCards, listCardsForUser } from "@/lib/server/cards";
import { ownsPack } from "@/lib/server/packs";
import { ledgerFloorProblem } from "@/lib/server/ebayMarket";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ cards: await listCardsForUser(user.id) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

/** Bulk delete: { ids } → { removed }. Sold rows never go (they are the record). */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 64) : [];
    if (ids.length === 0 || ids.length > 500) {
      return NextResponse.json({ error: "ids must be 1–500 card ids" }, { status: 400 });
    }
    const removed = await deleteCards(ids, user.id);
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const wall = subscriptionGate(user);
    if (wall) return wall;
    const body = await req.json().catch(() => null);

    // Same caps as the PATCH in [id]/route.ts (10-01 sweep: this route stored any length).
    const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.slice(0, max) : fallback);
    const cardName = str(body?.cardName, 200);
    const setName = str(body?.setName, 200);
    const cardNumber = str(body?.cardNumber, 40);
    const imageUrl = str(body?.imageUrl, 500);
    const condition = str(body?.condition, 40, "Near Mint");
    // A missing price means "unpriced" ($0); a present one must be a real
    // non-negative number, and never under the fee floor (lib/fees.ts).
    const price = body?.price === undefined || body?.price === null ? 0 : body.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "price must be a non-negative number" }, { status: 400 });
    }
    // US sellers: the original floor sentence; a seller on another eBay site is checked in their currency.
    const floorProblem = await ledgerFloorProblem(user.id, price);
    if (floorProblem) {
      return NextResponse.json({ error: floorProblem }, { status: 400 });
    }
    // Anything unrecognized stays a plain card — the safe reading of a stale
    // or hand-rolled client.
    const kind = body?.kind === "sealed" ? ("sealed" as const) : ("card" as const);
    const productType =
      typeof body?.productType === "string" ? body.productType.slice(0, 60) : null;

    if (!cardName) {
      return NextResponse.json({ error: "cardName is required" }, { status: 400 });
    }

    // A pack id that is not this user's is dropped, not trusted: the card still saves, just unlinked.
    const packId = typeof body?.packId === "string" && body.packId.length <= 64 && (await ownsPack(user.id, body.packId)) ? body.packId : null;

    const card = await createCard(user.id, {
      kind,
      game: parseGame(body?.game),
      cardName,
      setName,
      cardNumber,
      imageUrl,
      condition,
      productType,
      price,
      scanPrice: typeof body?.scanPrice === "number" && Number.isFinite(body.scanPrice) && body.scanPrice > 0 ? body.scanPrice : null,
      catalogCardId: typeof body?.catalogCardId === "string" ? body.catalogCardId.slice(0, 80) : null,
      rarity: typeof body?.rarity === "string" ? body.rarity.slice(0, 60) : null,
      category: typeof body?.category === "string" && body.category.trim() ? body.category.trim().slice(0, 40) : null,
      packId,
      variant: typeof body?.variant === "string" && body.variant.trim() ? body.variant.trim().slice(0, 40) : null,
    });
    return NextResponse.json({ card }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
