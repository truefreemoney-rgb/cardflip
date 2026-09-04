import { NextRequest, NextResponse } from "next/server";
import { parseGame } from "@/lib/games";
import { englishCardsBySet } from "@/lib/server/enCards";
import { mtgCardsBySet } from "@/lib/server/mtgCards";
import { latestUsdPrices } from "@/lib/server/priceHistory";
import type { CardPrice } from "@/lib/types";

/**
 * Every card in one set, with the latest price we hold — the set browser on
 * Search cards. Public catalogue data like /api/sets and /api/search-card.
 *   ?set=<set name>            Pokémon (the mirror keys sets by name)
 *   ?game=mtg&set=<set code>   Magic (Scryfall set code, e.g. ltr)
 * Pokémon prices ride in from price_series (one batch query) as a single
 * TCGplayer USD entry per card, so the grid and the detail modal both
 * have a number without an upstream call per card.
 */
export async function GET(req: NextRequest) {
  const set = (req.nextUrl.searchParams.get("set") ?? "").trim().slice(0, 120);
  if (!set) return NextResponse.json({ error: "Missing set" }, { status: 400 });
  try {
    if (parseGame(req.nextUrl.searchParams.get("game")) === "mtg") {
      return NextResponse.json({ cards: await mtgCardsBySet(set) });
    }
    const cards = await englishCardsBySet(set);
    const prices = await latestUsdPrices(cards.map((c) => c.id));
    for (const card of cards) {
      const p = prices.get(card.id);
      if (!p) continue;
      const entry: CardPrice = {
        source: "tcgplayer",
        variant: p.variant,
        label: p.variant === "normal" ? "Normal" : p.variant === "holofoil" ? "Holofoil" : p.variant === "reverseHolofoil" ? "Reverse Holofoil" : p.variant,
        currency: "USD",
        market: p.price,
        low: null,
        high: null,
      };
      card.prices = [entry];
    }
    return NextResponse.json({ cards });
  } catch (err) {
    console.error("set-cards failed:", err);
    return NextResponse.json({ error: "Couldn't load that set" }, { status: 500 });
  }
}
