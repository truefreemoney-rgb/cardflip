import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { apiFailure } from "@/lib/server/apiError";
import { addToWishlist, listWishlist } from "@/lib/server/wishlist";
import { WISHLIST_CAP_MESSAGE, wishlistFull } from "@/lib/server/rowCaps";
import type { PokemonCard, ScanLanguage } from "@/lib/types";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ items: await listWishlist(user.id) });
  } catch (err) {
    return apiFailure(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);

    const card = body?.card as PokemonCard | undefined;
    const language: ScanLanguage =
      body?.language === "ja" || body?.language === "zh" ? body.language : "en";
    // A card price, not any number: negative or absurd values save as "no price" (review 10-19 app #38).
    const price =
      typeof body?.price === "number" && Number.isFinite(body.price) && body.price >= 0 && body.price < 1e6 ? body.price : null;
    const variant = typeof body?.variant === "string" && body.variant ? body.variant.slice(0, 40) : null;

    if (typeof card?.name !== "string" || !card.name) {
      return NextResponse.json({ error: "Missing card" }, { status: 400 });
    }
    if (await wishlistFull(user.id)) {
      return NextResponse.json({ error: WISHLIST_CAP_MESSAGE }, { status: 409 });
    }

    const item = await addToWishlist(user.id, card, language, price, price == null ? null : variant);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return apiFailure(err);
  }
}
