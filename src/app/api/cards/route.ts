import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { createCard, listCardsForUser } from "@/lib/server/cards";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ cards: listCardsForUser(user.id) });
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
    const body = await req.json().catch(() => null);

    const cardName = typeof body?.cardName === "string" ? body.cardName : "";
    const setName = typeof body?.setName === "string" ? body.setName : "";
    const cardNumber = typeof body?.cardNumber === "string" ? body.cardNumber : "";
    const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : "";
    const condition = typeof body?.condition === "string" ? body.condition : "Near Mint";
    const price = typeof body?.price === "number" ? body.price : 0;
    // Anything unrecognized stays a plain card — the safe reading of a stale
    // or hand-rolled client.
    const kind = body?.kind === "sealed" ? ("sealed" as const) : ("card" as const);
    const productType =
      typeof body?.productType === "string" ? body.productType : null;

    if (!cardName) {
      return NextResponse.json({ error: "cardName is required" }, { status: 400 });
    }

    const card = createCard(user.id, {
      kind,
      game: body?.game === "mtg" ? "mtg" : "pokemon",
      cardName,
      setName,
      cardNumber,
      imageUrl,
      condition,
      productType,
      price,
    });
    return NextResponse.json({ card }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
