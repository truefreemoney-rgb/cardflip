import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { apiFailure } from "@/lib/server/apiError";
import { clearPriceChecks, listPriceChecks, logPriceCheck } from "@/lib/server/priceChecks";
import type { PokemonCard, ScanLanguage } from "@/lib/types";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ entries: await listPriceChecks(user.id, 100) });
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

    if (typeof card?.name !== "string" || !card.name || !Array.isArray(card.prices)) {
      return NextResponse.json({ error: "Missing card" }, { status: 400 });
    }

    const entry = await logPriceCheck(user.id, card, language);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return apiFailure(err);
  }
}

/** Clear the whole lookup history. */
export async function DELETE() {
  try {
    const user = await requireUser();
    await clearPriceChecks(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiFailure(err);
  }
}
