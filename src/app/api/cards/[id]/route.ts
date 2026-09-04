import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { deleteCard, getCardForUser, updateCard, type CardStatus } from "@/lib/server/cards";
import { deleteCardPhoto } from "@/lib/server/cardPhotos";

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

    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
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
      listedAt: "listedAt" in (body ?? {}) ? body.listedAt : undefined,
      soldPrice: "soldPrice" in (body ?? {}) ? body.soldPrice : undefined,
      soldAt: "soldAt" in (body ?? {}) ? body.soldAt : undefined,
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
    if (await getCardForUser(id, user.id)) await deleteCardPhoto(id);
    await deleteCard(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
