import { NextRequest, NextResponse } from "next/server";
import { parseGame } from "@/lib/games";
import { englishCardsBySet } from "@/lib/server/enCards";
import { mtgCardsBySet } from "@/lib/server/mtgCards";
import { isTcgGame, tcgCardsBySet } from "@/lib/server/tcgCards";
import { heldPriceEntry } from "@/lib/server/priceHistory";
import { latestUsdWithTrust, withPriceFlags } from "@/lib/server/priceTrustSite";
import type { PokemonCard } from "@/lib/types";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";

/** Same for everyone: the CDN holds a set 5 min, serves stale for a day while it refreshes. */
const CDN_CACHE = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" };

/**
 * Every card in one set, with the latest price we hold — the set browser on
 * Search cards. Public catalogue data like /api/sets and /api/search-card.
 *   ?set=<set name>            Pokémon (the mirror keys sets by name)
 *   ?game=mtg&set=<set code>   Magic (Scryfall set code, e.g. ltr)
 * Pokémon prices ride in from price_series (one batch query) as a single
 * TCGplayer USD entry per card, so the grid and the detail modal both
 * have a number without an upstream call per card.
 *
 * The price guard (priceTrustSite): a card whose market the rule flags carries
 * `untrusted` on its price row, so the tile shows the note instead of the
 * number. Pokémon reads the series once for both the price and the verdict.
 */
/** Fails open, like search-card: a hiccup in the trust read must not empty the browser. */
async function flagged(cards: PokemonCard[]): Promise<PokemonCard[]> {
  try {
    return await withPriceFlags(cards);
  } catch (err) {
    console.warn("set-cards: price guard unavailable", err);
    return cards;
  }
}

export async function GET(req: NextRequest) {
  const limited = limitOrRespond(`catalog:${clientIp(req)}`, LIMITS.publicCatalog);
  if (limited) return limited;
  const set = (req.nextUrl.searchParams.get("set") ?? "").trim().slice(0, 120);
  if (!set) return NextResponse.json({ error: "Missing set" }, { status: 400 });
  try {
    const game = parseGame(req.nextUrl.searchParams.get("game"));
    if (game === "mtg") {
      return NextResponse.json({ cards: await flagged(await mtgCardsBySet(set)) }, { headers: CDN_CACHE });
    }
    // Lorcana / One Piece / Yu-Gi-Oh!: ?set=<code|name> from /api/sets.
    if (isTcgGame(game)) {
      return NextResponse.json({ cards: await flagged(await tcgCardsBySet(game, set)) }, { headers: CDN_CACHE });
    }
    const cards = await englishCardsBySet(set);
    const prices = await latestUsdWithTrust(cards.map((c) => c.id));
    for (const card of cards) {
      const p = prices.get(card.id);
      if (!p) continue;
      card.prices = [{ ...heldPriceEntry(p), ...(p.flag ? { untrusted: p.flag } : {}), ...(p.stale ? { stale: p.stale } : {}) }];
    }
    return NextResponse.json({ cards }, { headers: CDN_CACHE });
  } catch (err) {
    console.error("set-cards failed:", err);
    return NextResponse.json({ error: "Couldn't load that set" }, { status: 500 });
  }
}
