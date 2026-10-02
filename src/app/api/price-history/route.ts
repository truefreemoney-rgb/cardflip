import { NextRequest, NextResponse } from "next/server";
import { getPriceHistory, summarize } from "@/lib/server/priceHistory";
import { siteTrustFull, trustKey } from "@/lib/server/priceTrustSite";
import type { PriceFlag, PriceStale } from "@/lib/priceFlag";
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
 * price on it. A series whose latest value has stood 45+ days carries `stale`
 * ({ days }) instead: shown, with a note. One trust read (2 queries, memoised),
 * no extra series scan.
 */
export async function GET(req: NextRequest) {
  const limited = limitOrRespond(`history:${clientIp(req)}`, LIMITS.searchCard);
  if (limited) return limited;
  const cardId = req.nextUrl.searchParams.get("cardId")?.trim() ?? "";
  if (!cardId) return NextResponse.json({ error: "Missing cardId" }, { status: 400 });
  try {
    const history = await getPriceHistory(cardId);
    const game = (history[0]?.game ?? "pokemon") as GameId;
    let flags = new Map<string, PriceFlag>();
    let stale = new Map<string, PriceStale>();
    try {
      ({ flags, stale } = await siteTrustFull(
        history.filter((s) => s.source === "tcgplayer" && s.currency === "USD").map((s) => ({ cardId, game, variant: s.variant, exact: true })),
      ));
    } catch (err) {
      console.warn("price history: price guard unavailable", err);
    }
    const series = history.map((s) => {
      const tcgUsd = s.source === "tcgplayer" && s.currency === "USD";
      const untrusted = tcgUsd ? flags.get(trustKey(cardId, s.variant)) : undefined;
      // `stale` (10-02): the latest point has stood 45+ days; the chart shows it with a note instead of hiding it.
      const staleNote = tcgUsd && !untrusted ? stale.get(trustKey(cardId, s.variant)) : undefined;
      return { ...s, stats: summarize(s.points), ...(untrusted ? { untrusted } : {}), ...(staleNote ? { stale: staleNote } : {}) };
    });
    return NextResponse.json({ cardId, series });
  } catch (err) {
    console.error("price history failed:", err);
    return NextResponse.json({ error: "Couldn't load price history" }, { status: 500 });
  }
}
