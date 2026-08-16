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

    const card = updateCard(id, user.id, {
      condition: typeof body?.condition === "string" ? body.condition : undefined,
      price: typeof body?.price === "number" ? body.price : undefined,
      status,
      listedAt: "listedAt" in (body ?? {}) ? body.listedAt : undefined,
      soldPrice: "soldPrice" in (body ?? {}) ? body.soldPrice : undefined,
      soldAt: "soldAt" in (body ?? {}) ? body.soldAt : undefined,
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
    if (getCardForUser(id, user.id)) deleteCardPhoto(id);
    deleteCard(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
