import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { listPriceChecks, logPriceCheck } from "@/lib/server/priceChecks";
import type { PokemonCard, ScanLanguage } from "@/lib/types";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ entries: listPriceChecks(user.id, 100) });
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

    if (!card?.name || !Array.isArray(card.prices)) {
      return NextResponse.json({ error: "Missing card" }, { status: 400 });
    }

    const entry = logPriceCheck(user.id, card, language);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
