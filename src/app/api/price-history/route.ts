import { NextRequest, NextResponse } from "next/server";
import { getPriceHistory, summarize } from "@/lib/server/priceHistory";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";

/**
 * Every price series we hold for one card, with 30/90-day stats per series.
 * Public like /api/search-card (the landing peek modal can show it); the
 * data is our own aggregate, nothing per-user.
 */
export async function GET(req: NextRequest) {
  const limited = limitOrRespond(`history:${clientIp(req)}`, LIMITS.searchCard);
  if (limited) return limited;
  const cardId = req.nextUrl.searchParams.get("cardId")?.trim() ?? "";
  if (!cardId) return NextResponse.json({ error: "Missing cardId" }, { status: 400 });
  try {
    const series = (await getPriceHistory(cardId)).map((s) => ({ ...s, stats: summarize(s.points) }));
    return NextResponse.json({ cardId, series });
  } catch (err) {
    console.error("price history failed:", err);
    return NextResponse.json({ error: "Couldn't load price history" }, { status: 500 });
  }
}
