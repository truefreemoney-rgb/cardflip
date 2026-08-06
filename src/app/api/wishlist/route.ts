import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { addToWishlist, listWishlist } from "@/lib/server/wishlist";
import type { PokemonCard, ScanLanguage } from "@/lib/types";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ items: listWishlist(user.id) });
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

    const card = body?.card as PokemonCard | undefined;
    const language: ScanLanguage =
      body?.language === "ja" || body?.language === "zh" ? body.language : "en";
    const price = typeof body?.price === "number" ? body.price : null;

    if (!card?.name) {
      return NextResponse.json({ error: "Missing card" }, { status: 400 });
    }

    const item = addToWishlist(user.id, card, language, price);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
