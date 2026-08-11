import type {
  CardPrice,
  Condition,
  EbayComps,
  ListingDraft,
  PokemonCard,
  PriceQuote,
  PriceStrategy,
  ScanItem,
} from "@/lib/types";

const POKEMON_TCG_CARDS_CATEGORY_ID = "183454";

/** Variant key for the synthesized eBay asking-price average. */
export const EBAY_VARIANT = "ebayAverage";
/** Variant key for the synthesized eBay sold-price average. */
export const EBAY_SOLD_VARIANT = "ebaySoldAverage";

/**
 * Which printing to quote when a card has several.
 *
 * Averaging across variants (as an earlier version did) produces a number that
 * matches no real listing: a reverse-holo and a base normal can differ by 10x.
 * Instead we pick one variant deliberately and let the seller switch.
 */
const VARIANT_PRIORITY = [
  EBAY_SOLD_VARIANT,
  EBAY_VARIANT,
  "1stEditionHolofoil",
  "holofoil",
  "reverseHolofoil",
  "1stEditionNormal",
  "unlimitedHolofoil",
  "normal",
  "unlimited",
  "average",
];

/**
 * Rough multipliers for card condition. Real sold prices vary by card and
 * grader, so these are estimates to anchor a listing — not appraisals.
 */
const CONDITION_MULTIPLIER: Record<Condition, number> = {
  "Near Mint": 1,
  "Lightly Played": 0.85,
  "Moderately Played": 0.7,
  "Heavily Played": 0.55,
  Damaged: 0.4,
};

export const CONDITIONS = Object.keys(CONDITION_MULTIPLIER) as Condition[];

/** Undercut market to move stock quickly — the whole point of the product. */
const STRATEGY_MULTIPLIER: Record<PriceStrategy, number> = {
  quick: 0.88,
  market: 1,
};

export function formatVariantLabel(variant: string): string {
  if (variant === "average") return "Average";
  return variant
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/1st Edition/i, "1st Ed.")
    .trim();
}

/**
 * Folds eBay comps into a card as regular price sources, so every existing
 * consumer — the variant picker, the quote, the price table — treats them like
 * any other price rather than needing a parallel code path.
 *
 * Sold and asking averages are kept as separate rows rather than merged: they
 * answer different questions, and a seller deciding on a price wants to see
 * the gap between the two rather than an average that hides it.
 */
export function withEbayPrices(
  card: PokemonCard,
  comps: { sold?: EbayComps | null; active?: EbayComps | null },
): PokemonCard {
  const rows: CardPrice[] = [];

  if (comps.sold) {
    rows.push({
      source: "ebay",
      variant: EBAY_SOLD_VARIANT,
      label: `eBay sold (${comps.sold.count} sale${comps.sold.count === 1 ? "" : "s"}, 90d)`,
      market: comps.sold.average,
      low: comps.sold.low,
      high: comps.sold.high,
    });
  }
  if (comps.active) {
    rows.push({
      source: "ebay",
      variant: EBAY_VARIANT,
      label: `eBay asking (${comps.active.count} listing${comps.active.count === 1 ? "" : "s"})`,
      market: comps.active.average,
      low: comps.active.low,
      high: comps.active.high,
    });
  }

  return {
    ...card,
    prices: [...rows, ...card.prices.filter((p) => p.source !== "ebay")],
  };
}

/**
 * The variant we quote by default, or null when the card has no pricing.
 *
 * Source order is deliberate. Sold prices come first because they're the only
 * number here that reflects a completed transaction — an asking average says
 * what sellers hope for, including the ones whose cards never sell. Asking
 * comes next since it's still eBay, then TCGplayer, then Cardmarket last
 * (EUR, and a different regional market than the seller is listing into).
 */
export function pickPrice(card: PokemonCard): CardPrice | null {
  const priced = card.prices.filter(
    (p) => typeof p.market === "number" && p.market > 0,
  );
  if (priced.length === 0) return null;

  const byVariant = (variant: string) =>
    priced.filter((p) => p.variant === variant);

  const pool =
    byVariant(EBAY_SOLD_VARIANT).length > 0
      ? byVariant(EBAY_SOLD_VARIANT)
      : byVariant(EBAY_VARIANT).length > 0
        ? byVariant(EBAY_VARIANT)
        : priced.filter((p) => p.source === "tcgplayer").length > 0
          ? priced.filter((p) => p.source === "tcgplayer")
          : priced;

  for (const variant of VARIANT_PRIORITY) {
    const hit = pool.find((p) => p.variant === variant);
    if (hit) return hit;
  }
  return pool[0];
}

function roundPrice(value: number, strategy: PriceStrategy): number {
  if (value <= 0) return 0;
  // Quick-sale prices get a charm ending; they're meant to catch a browsing eye.
  if (strategy === "quick" && value >= 5) {
    return Math.max(0.99, Math.floor(value) - 0.01);
  }
  return Math.round(value * 100) / 100;
}

export function quotePrice(
  card: PokemonCard,
  condition: Condition,
  strategy: PriceStrategy,
  variantOverride?: string,
): PriceQuote | null {
  const price = variantOverride
    ? (card.prices.find((p) => p.variant === variantOverride) ?? pickPrice(card))
    : pickPrice(card);

  if (!price?.market) return null;

  const adjusted =
    price.market *
    CONDITION_MULTIPLIER[condition] *
    STRATEGY_MULTIPLIER[strategy];

  return {
    price,
    base: price.market,
    suggested: roundPrice(adjusted, strategy),
  };
}

/**
 * The single price to show for an item, wherever it sits in the pipeline:
 * locked in once listed or sold, otherwise the live quote (or a manual
 * override). Centralized so the queue, editor, and summary bar can't drift.
 */
export function currentPrice(item: ScanItem): number {
  if (item.status === "sold") return item.soldPrice ?? 0;
  if (item.status === "listed") return item.listedPrice ?? 0;
  if (!item.card) return 0;

  const quote = quotePrice(
    item.card,
    item.condition,
    item.strategy,
    item.variant ?? undefined,
  );
  return item.priceOverride ?? quote?.suggested ?? 0;
}

/** eBay caps listing titles at 80 characters. */
function buildTitle(card: PokemonCard, condition: Condition): string {
  const full = `${card.name} ${card.setName} ${card.number} Pokemon TCG ${condition}`;
  if (full.length <= 80) return full;

  const withoutCondition = `${card.name} ${card.setName} ${card.number} Pokemon TCG`;
  if (withoutCondition.length <= 80) return withoutCondition;

  return withoutCondition.slice(0, 80).trim();
}

export function buildListing(
  card: PokemonCard,
  price: number,
  condition: Condition,
  variantLabel?: string,
): ListingDraft {
  const description = [
    `${card.name} — ${card.setName}, card ${card.number}.`,
    [
      card.rarity ? `Rarity: ${card.rarity}.` : null,
      variantLabel ? `Printing: ${variantLabel}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    `Condition: ${condition}. Graded by eye — please review the photos, which show the exact card you will receive.`,
    "Shipped in a penny sleeve and top loader inside a rigid mailer, sent within 1 business day.",
    "Happy to combine shipping on multiple cards — message before paying and I'll send an updated invoice.",
  ]
    .filter((line) => line && line.length > 0)
    .join("\n\n");

  return {
    title: buildTitle(card, condition),
    description,
    price,
    categoryId: POKEMON_TCG_CARDS_CATEGORY_ID,
    categoryName: "Collectible Card Games > Pokémon TCG > Individual Cards",
  };
}

/**
 * The eBay search a human would run for this card — same query the comps
 * average is built from, so the seller can click through and check our work.
 * Lives here rather than in the server eBay client because the UI links to it
 * even when there are no comps (or no eBay credentials) to show.
 */
export function ebaySearchUrl(card: PokemonCard): string {
  const name = card.englishName || card.name;
  const params = new URLSearchParams({
    _nkw: `${name} ${card.number} pokemon`.trim(),
    _sacat: POKEMON_TCG_CARDS_CATEGORY_ID,
    // Price + shipping, lowest first — how a seller actually checks comps.
    _sop: "15",
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

/**
 * eBay's *sold* listings for this card — what buyers actually paid, rather
 * than what sellers are asking.
 *
 * Needs no API access, so it's useful even when the Marketplace Insights
 * average isn't available. Note eBay gates sold search harder than active
 * search: unauthenticated or automated requests get bounced to sign-in, so a
 * seller may have to be logged into eBay for this to open directly.
 */
export function ebaySoldSearchUrl(card: PokemonCard): string {
  const name = card.englishName || card.name;
  const params = new URLSearchParams({
    _nkw: `${name} ${card.number} pokemon`.trim(),
    _sacat: POKEMON_TCG_CARDS_CATEGORY_ID,
    LH_Sold: "1",
    LH_Complete: "1",
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

/**
 * Opens eBay's sell flow with the title pre-filled. Creating the listing
 * outright needs the eBay Sell API (developer account + OAuth), which isn't
 * wired up yet — see README.
 */
export function ebaySellUrl(listing: ListingDraft): string {
  const params = new URLSearchParams({ sr: "sell", title: listing.title });
  return `https://www.ebay.com/sl/list?${params.toString()}`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Draft spreadsheet of the queue, for sellers who list in bulk. */
export function toCsv(
  rows: { listing: ListingDraft; card: PokemonCard; condition: Condition }[],
): string {
  const header = ["Title", "Price", "Condition", "Set", "Number", "Category"];
  const lines = rows.map(({ listing, card, condition }) =>
    [
      listing.title,
      listing.price.toFixed(2),
      condition,
      card.setName,
      card.number,
      listing.categoryName,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
