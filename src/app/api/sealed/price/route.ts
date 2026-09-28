import { NextRequest, NextResponse } from "next/server";
import { parseGame } from "@/lib/games";
import { sealedProductTypesFor } from "@/lib/grading";
import { sealedQuote } from "@/lib/server/sealedPrices";

/**
 * GET /api/sealed/price?set=<set name>&type=<product type>[&game=pokemon]
 *
 * The TCGplayer market for a sealed product (Tier 2 #13): the median across
 * the set's products of that kind plus each product's own price, for the
 * sealed editor's price strip. Public catalog data like /api/sets — no
 * auth, nothing per user.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const game = parseGame(req.nextUrl.searchParams.get("game"));
  const setName = (req.nextUrl.searchParams.get("set") ?? "").trim().slice(0, 120);
  const type = (req.nextUrl.searchParams.get("type") ?? "").trim();
  if (!setName || !sealedProductTypesFor(game).includes(type)) {
    return NextResponse.json({ error: "set and a known product type are required" }, { status: 400 });
  }
  try {
    const quote = await sealedQuote(game, setName, type);
    return NextResponse.json(quote, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    console.error("Sealed price lookup failed:", err);
    return NextResponse.json({ error: "Couldn't look up the sealed price" }, { status: 500 });
  }
}
