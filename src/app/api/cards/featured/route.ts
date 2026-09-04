import { NextResponse } from "next/server";
import { getFeaturedCard } from "@/lib/tcg";
import { plausiblePrices } from "@/lib/listing";

/**
 * The card on the empty scanner's stage: the same real, live-priced
 * featured card the landing page leads with (Chris, 09-04: the ghost
 * outline "I hate this image"). Cached a day upstream; no auth — nothing
 * here is per-seller.
 */
export const revalidate = 3600;

export async function GET() {
  const card = await getFeaturedCard();
  if (!card) return NextResponse.json({ card: null });
  const price = plausiblePrices(card.prices).find((p) => p.market)?.market ?? null;
  return NextResponse.json({
    card: { name: card.name, setName: card.setName, number: card.number, imageUrl: card.imageLarge, price },
  });
}
