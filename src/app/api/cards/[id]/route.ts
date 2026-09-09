import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { deleteCard, getCardForUser, updateCard, type CardStatus } from "@/lib/server/cards";
import { deleteCardPhoto } from "@/lib/server/cardPhotos";
import { belowFloor, floorRefusal } from "@/lib/fees";

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
    if (status !== undefined && status !== "sold") {
      const existing = await getCardForUser(id, user.id);
      if (existing?.status === "sold") {
        return NextResponse.json({ error: "Sold cards stay on the record — they can't be relisted or turned back into drafts." }, { status: 409 });
      }
    }
    // Never under the fee floor (lib/fees.ts) — the server is the truth here.
    if (body?.price !== undefined) {
      if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price < 0) {
        return NextResponse.json({ error: "price must be a non-negative number" }, { status: 400 });
      }
      if (belowFloor(body.price)) {
        return NextResponse.json({ error: floorRefusal() }, { status: 400 });
      }
    }
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
    // Nullable numeric columns: a finite number lands, anything else clears.
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
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
      condition: typeof body?.condition === "string" ? body.condition : undefined,
      price: typeof body?.price === "number" ? body.price : undefined,
      quantity:
        typeof body?.quantity === "number" && Number.isFinite(body.quantity)
          ? Math.min(99, Math.max(1, Math.floor(body.quantity)))
          : undefined,
      status,
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
      priceLocked: typeof body?.priceLocked === "boolean" ? body.priceLocked : undefined,
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
    if (existing) await deleteCardPhoto(id);
    await deleteCard(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
