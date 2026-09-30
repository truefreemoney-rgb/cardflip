import { NextRequest, NextResponse } from "next/server";
import { getPriceHistory, summarize } from "@/lib/server/priceHistory";
import { siteTrust, trustKey } from "@/lib/server/priceTrustSite";
import type { GameId } from "@/lib/types";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";

/**
 * Every price series we hold for one card, with 30/90-day stats per series.
 * Public like /api/search-card (the landing peek modal can show it); the
 * data is our own aggregate, nothing per-user.
 *
 * Each TCGplayer USD series the price guard (priceTrustSite) flags carries
 * `untrusted`: the chart keeps drawing the history but does not present the
 * latest point as the card's price, and the editor will not rebase a listing
 * price on it. One trust read (2 queries, memoised), no extra series scan.
 */
export async function GET(req: NextRequest) {
  const limited = limitOrRespond(`history:${clientIp(req)}`, LIMITS.searchCard);
  if (limited) return limited;
  const cardId = req.nextUrl.searchParams.get("cardId")?.trim() ?? "";
  if (!cardId) return NextResponse.json({ error: "Missing cardId" }, { status: 400 });
  try {
    const history = await getPriceHistory(cardId);
    const game = (history[0]?.game ?? "pokemon") as GameId;
    let flags = new Map<string, { hard: boolean; reason: string }>();
    try {
      flags = await siteTrust(
        history.filter((s) => s.source === "tcgplayer" && s.currency === "USD").map((s) => ({ cardId, game, variant: s.variant, exact: true })),
      );
    } catch (err) {
      console.warn("price history: price guard unavailable", err);
    }
    const series = history.map((s) => {
      const untrusted = s.source === "tcgplayer" && s.currency === "USD" ? flags.get(trustKey(cardId, s.variant)) : undefined;
      return { ...s, stats: summarize(s.points), ...(untrusted ? { untrusted } : {}) };
    });
    return NextResponse.json({ cardId, series });
  } catch (err) {
    console.error("price history failed:", err);
    return NextResponse.json({ error: "Couldn't load price history" }, { status: 500 });
  }
}
