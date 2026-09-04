import { NextResponse } from "next/server";
import { getFeaturedCard, getShowcaseCards } from "@/lib/tcg";
import { plausiblePrices } from "@/lib/listing";
import { gameOf, type PokemonCard } from "@/lib/types";
import { getCurrentUser } from "@/lib/server/auth";
import { magicVisibleFor } from "@/lib/server/settings";

/**
 * The cards on the empty scanner's stage: the landing page's featured card
 * first, then live-priced showcase cards, ten in all, all real catalog rows
 * (Chris, 09-04: "the cards need to rotate, pick like 10"). Magic rows only
 * for viewers who can see Magic. Cached a day upstream.
 */
export const dynamic = "force-dynamic";

const STAGE_CARDS = 10;

function pick(card: PokemonCard) {
  const price = plausiblePrices(card.prices).find((p) => p.market)?.market ?? null;
  return { name: card.name, setName: card.setName, number: card.number, imageUrl: card.imageLarge, price };
}

export async function GET() {
  const user = await getCurrentUser();
  const magic = await magicVisibleFor(user);
  const [featured, showcase] = await Promise.all([getFeaturedCard(), getShowcaseCards()]);
  const seen = new Set<string>();
  const cards = [featured, ...showcase]
    .filter((c): c is PokemonCard => !!c && !!c.imageLarge)
    .filter((c) => magic || gameOf(c) !== "mtg")
    .filter((c) => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(pick)
    .filter((c) => c.price != null)
    .slice(0, STAGE_CARDS);
  return NextResponse.json({ cards });
}
