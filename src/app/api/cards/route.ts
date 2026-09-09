import { NextResponse } from "next/server";
import { requireUser, AuthError, subscriptionGate } from "@/lib/server/auth";
import { createCard, deleteCards, listCardsForUser } from "@/lib/server/cards";
import { belowFloor, floorRefusal } from "@/lib/fees";

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

    const cardName = typeof body?.cardName === "string" ? body.cardName : "";
    const setName = typeof body?.setName === "string" ? body.setName : "";
    const cardNumber = typeof body?.cardNumber === "string" ? body.cardNumber : "";
    const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : "";
    const condition = typeof body?.condition === "string" ? body.condition : "Near Mint";
    // A missing price means "unpriced" ($0); a present one must be a real
    // non-negative number, and never under the fee floor (lib/fees.ts).
    const price = body?.price === undefined || body?.price === null ? 0 : body.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "price must be a non-negative number" }, { status: 400 });
    }
    if (belowFloor(price)) {
      return NextResponse.json({ error: floorRefusal() }, { status: 400 });
    }
    // Anything unrecognized stays a plain card — the safe reading of a stale
    // or hand-rolled client.
    const kind = body?.kind === "sealed" ? ("sealed" as const) : ("card" as const);
    const productType =
      typeof body?.productType === "string" ? body.productType : null;

    if (!cardName) {
      return NextResponse.json({ error: "cardName is required" }, { status: 400 });
    }

    const card = await createCard(user.id, {
      kind,
      game: body?.game === "mtg" ? "mtg" : "pokemon",
      cardName,
      setName,
      cardNumber,
      imageUrl,
      condition,
      productType,
      price,
      catalogCardId: typeof body?.catalogCardId === "string" ? body.catalogCardId : null,
      rarity: typeof body?.rarity === "string" ? body.rarity.slice(0, 60) : null,
      category: typeof body?.category === "string" && body.category.trim() ? body.category.trim().slice(0, 40) : null,
    });
    return NextResponse.json({ card }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
