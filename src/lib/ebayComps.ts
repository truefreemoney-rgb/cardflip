import type { EbayComps, EbayListing, PokemonCard } from "@/lib/types";

/**
 * Turning raw eBay search results into a price a seller can trust.
 *
 * Kept free of network and server-only imports so the filtering and the
 * statistics can be exercised directly — see scripts/test-ebay-comps.mjs.
 * This is the part of the eBay feature most likely to be quietly wrong:
 * a search for a card name returns bulk lots, graded slabs, proxies, and
 * sealed product alongside the actual card, and averaging that blind gives
 * a number that describes nothing real.
 */

/** Titles that aren't a single raw copy of the card being priced. */
const REJECT_PATTERNS: RegExp[] = [
  // Bulk: one 50-card lot averaged against singles wrecks the number.
  /\b(lot|lots|bundle|joblot|job lot|playset|collection|binder|bulk)\b/i,
  /\bset of\b/i,
  /\b\d{2,}\s*(cards?|pcs|pieces)\b/i,
  /\bx\s*\d{2,}\b/i,
  // Graded slabs are a different product with a different market.
  /\b(psa|bgs|cgc|sgc|ace|tag)\s*\.?\s*(10|9\.5|9|8\.5|8|7|6|5|graded)\b/i,
  /\bgem\s*mint\b/i,
  /\bgraded\b/i,
  // Not the real card.
  /\b(proxy|proxies|custom|orica|fake|replica|reprint|reproduction)\b/i,
  /\bmetal\s*card\b/i,
  // Adjacent products that share the card's name.
  /\b(booster|pack|box|tin|etb|elite trainer|blister|sleeve|playmat|toy|figure|plush|sticker|coin|jumbo|oversized)\b/i,
  /\bempty\b/i,
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Is this listing the same product we're pricing? */
export function isComparable(title: string, card: PokemonCard): boolean {
  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(title)) return false;
  }

  const lower = title.toLowerCase();

  // The card's name has to actually appear. eBay's relevance ranking happily
  // keeps returning loosely-related cards once exact matches run out.
  const nameToMatch = (card.englishName || card.name).toLowerCase();
  const nameWords = nameToMatch.split(/\s+/).filter((w) => w.length > 2);
  if (nameWords.length > 0 && !nameWords.some((w) => lower.includes(w))) {
    return false;
  }

  // The collector number is the strongest same-card signal available, so
  // require it when we have one. Matched loosely: sellers write "199/165",
  // "#199", or bare "199", and may or may not zero-pad.
  const num = card.number ? card.number.replace(/^0+/, "") : "";
  const numberMatches = num
    ? new RegExp(`(^|[^0-9])0*${escapeRegex(num)}([^0-9]|$)`).test(title)
    : true;

  if (card.game === "mtg") {
    // MTG sellers rarely put the collector number in a title ("Lightning
    // Bolt LTR Foil NM" is typical), so the set code or set name stands in
    // for it — a reprinted name without any of the three is another set.
    if (/\b(deck|precon|commander|secret lair|prerelease|starter kit)\b/i.test(title)) return false;
    const code = card.setCode?.toLowerCase();
    const codeMatches = code ? new RegExp(`\\b${escapeRegex(code)}\\b`, "i").test(title) : false;
    const setWords = card.setName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const setMatches = setWords.length > 0 && setWords.every((w) => lower.includes(w));
    return (num ? numberMatches : false) || codeMatches || setMatches;
  }

  if (num && !numberMatches) return false;
  return true;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

/**
 * Drop statistical outliers with a Tukey fence before averaging. Even after
 * keyword filtering a few listings sit far off the real market — a misgraded
 * bargain, or someone asking 10x hoping for a bite — and a plain mean follows
 * them. The fence keeps the average anchored to the bulk of the market.
 */
export function trimOutliers(prices: number[]): number[] {
  const sorted = [...prices].sort((a, b) => a - b);
  // Under four points a quartile fence is noise, not signal.
  if (sorted.length < 4) return sorted;

  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  if (iqr === 0) return sorted;

  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const kept = sorted.filter((p) => p >= lower && p <= upper);
  return kept.length > 0 ? kept : sorted;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Summarize comparable listings into the number shown to the seller.
 * `sampled` is the pre-filter count, so the UI can be honest about how much
 * of eBay's noise was discarded. Returns null when nothing comparable
 * survived — better to show no price than a fabricated one.
 */
export function buildComps(
  listings: EbayListing[],
  searchUrl: string,
  sampled: number,
): EbayComps | null {
  if (listings.length === 0) return null;

  const kept = trimOutliers(listings.map((l) => l.price));
  const average = kept.reduce((sum, p) => sum + p, 0) / kept.length;

  return {
    average: round(average),
    median: round(median(kept)),
    low: round(kept[0]),
    high: round(kept[kept.length - 1]),
    count: kept.length,
    sampled,
    listings: [...listings].sort((a, b) => a.price - b.price).slice(0, 20),
    searchUrl,
  };
}
