import { effectiveVariant, marketFlagOf, tcgPriceOf } from "@/lib/listing";
import type { PokemonCard, ScanItem } from "@/lib/types";

/** The gap that is worth a warning: at least this many dollars AND this many times the matched price. */
export const VARIANT_WARN_MIN_USD = 5;
export const VARIANT_WARN_MIN_RATIO = 2;

export interface PricierSibling {
  card: PokemonCard;
  /** Dollars more than the matched card's market. */
  extra: number;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * A look-alike printing worth a lot more than the match (same name, same set,
 * different number or rarity: Special Illustration Rare, Alt Art, holo vs
 * reverse). Uses only what the scan already holds (item.candidates + prices),
 * never the network, and never switches anything: the caller shows the
 * warning and the seller taps. Null when nothing qualifies.
 */
export function pricierSibling(item: ScanItem): PricierSibling | null {
  const card = item.card;
  if (!card || item.kind === "sealed" || item.grading || item.candidates.length < 2) return null;
  // A price the guard flags is no base to compare against.
  const current = marketFlagOf(card, effectiveVariant(item), item.currentPoint) ? null : tcgPriceOf(card, effectiveVariant(item), item.currentPoint);
  if (current == null || current <= 0) return null;

  let best: PricierSibling | null = null;
  for (const c of item.candidates) {
    if (c.id === card.id || norm(c.name) !== norm(card.name) || norm(c.setName) !== norm(card.setName)) continue;
    if (c.number === card.number && norm(c.rarity) === norm(card.rarity)) continue;
    if (marketFlagOf(c)) continue;
    const price = tcgPriceOf(c);
    if (price == null) continue;
    const extra = price - current;
    if (extra < VARIANT_WARN_MIN_USD || price < current * VARIANT_WARN_MIN_RATIO) continue;
    if (!best || extra > best.extra) best = { card: c, extra };
  }
  return best;
}
