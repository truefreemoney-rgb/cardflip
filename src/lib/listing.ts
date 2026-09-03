import type {
  CardPrice,
  Condition,
  Currency,
  EbayComps,
  GradedInfo,
  ListingDraft,
  PokemonCard,
  PriceQuote,
  PriceStrategy,
  ScanItem,
} from "@/lib/types";
// Relative, with the extension: the "@/" alias only exists under the bundler,
// and the plain-Node test runner (test-pricing.mjs) imports this module
// directly — Node's ESM loader needs the real filename.
import { gradeLabel } from "./grading.ts";
import { descriptionHtml } from "./ebayInventory.ts";
import { SITE_URL } from "./siteUrl.ts";
import { GAMES, MTG_FINISH_LABEL } from "./games.ts";
import { gameOf } from "./types.ts";

// eBay's CCG leaf categories are shared by every game since the 2020
// restructure — Pokémon and Magic singles both list in "CCG Individual Cards"
// and the game is an item specific (see lib/games.ts).
const CCG_CARDS_CATEGORY_ID = "183454";
// Sealed product lives in different eBay categories than singles: loose packs
// in one, boxes and boxed sets in another.
const CCG_SEALED_PACKS_CATEGORY_ID = "183456";
const CCG_SEALED_BOXES_CATEGORY_ID = "261044";

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
  "holofoil",
  "reverseHolofoil",
  "unlimitedHolofoil",
  "normal",
  "unlimited",
  // MTG finishes (Scryfall): the nonfoil is what a seller is almost always
  // holding; foil/etched sit behind it and are picked explicitly.
  "nonfoil",
  "foil",
  "etched",
  // 1st Edition prints last: they carry a large premium, so quoting one by
  // default would overprice the unlimited copy a seller is almost always
  // holding. They only drive the price via the explicit 1st Edition toggle.
  "1stEditionHolofoil",
  "1stEdition",
  "1stEditionNormal",
  "average",
];

/**
 * WotC-era expansions that had a genuine 1st Edition print run, worth a
 * multiple of the unlimited printing. Set names as the TCGdex mirror spells
 * them — this is matched against `card.setName`.
 */
const FIRST_EDITION_SETS = new Set([
  "Base Set",
  "Jungle",
  "Fossil",
  "Team Rocket",
  "Gym Heroes",
  "Gym Challenge",
  "Neo Genesis",
  "Neo Discovery",
  "Neo Revelation",
  "Neo Destiny",
]);

/** TCGplayer's 1st Edition variant keys, most specific first. */
const FIRST_EDITION_VARIANTS = ["1stEditionHolofoil", "1stEdition", "1stEditionNormal"];

/**
 * Whether the 1st Edition toggle applies to this card. Base Set Machamp is
 * carved out: it shipped 1st-edition-stamped in every 2-Player Starter Set, so
 * the stamp carries no premium there and offering the toggle would mislead.
 */
export function canBeFirstEdition(card: PokemonCard): boolean {
  // MTG's collectible printings (Alpha/Beta, foil, etched) are separate
  // Scryfall printings / finishes, not a stamp on the same card.
  if (gameOf(card) !== "pokemon") return false;
  if (!FIRST_EDITION_SETS.has(card.setName)) return false;
  return !(card.setName === "Base Set" && card.name === "Machamp");
}

/**
 * The card's real 1st Edition market price, when the price source tracks one.
 * TCGplayer carries these for Jungle through Neo Destiny; Base Set 1st Edition
 * is a separate product line pokemontcg.io doesn't expose, so this returns
 * null there — better no number than a made-up multiplier on a four-figure
 * card.
 */
export function firstEditionPrice(card: PokemonCard): CardPrice | null {
  for (const variant of FIRST_EDITION_VARIANTS) {
    const hit = card.prices.find(
      (p) =>
        p.variant === variant &&
        typeof p.market === "number" &&
        p.market > 0 &&
        canPriceListing(p),
    );
    if (hit) return hit;
  }
  return null;
}

/** Whether a variant key is one of TCGplayer's 1st Edition printings. */
export function isFirstEditionVariant(variant: string): boolean {
  return FIRST_EDITION_VARIANTS.includes(variant);
}

/**
 * The variant that should drive an item's quote: an explicit dropdown pick
 * wins, otherwise the 1st Edition toggle selects the 1st Edition price when
 * one exists. Shared by the editor, the queue rows, and the CSV export so a
 * toggled card can't show different prices in different places.
 */
export function effectiveVariant(item: ScanItem): string | undefined {
  if (item.variant) return item.variant;
  if (item.firstEdition && item.card) {
    return firstEditionPrice(item.card)?.variant;
  }
  return undefined;
}

/**
 * MTG: the finish the item is being sold as — the seller's explicit variant
 * pick, else whichever finish the default quote came from. Null for Pokémon.
 */
export function mtgFinishOf(item: ScanItem): string | null {
  if (!item.card || gameOf(item.card) !== "mtg") return null;
  const variant = item.variant ?? pickPrice(item.card)?.variant ?? null;
  return variant && MTG_FINISH_LABEL[variant] ? variant : null;
}

/**
 * Rough multipliers for card condition. Real sold prices vary by card and
 * grader, so these are estimates to anchor a listing — not appraisals.
 */
export const CONDITION_MULTIPLIER: Record<Condition, number> = {
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

const CURRENCY_SYMBOL: Record<Currency, string> = { USD: "$", EUR: "€" };

/**
 * Renders a price in its own currency. Cardmarket quotes euros, and showing
 * €4,184 as "$4,184" isn't a cosmetic slip — it invites a seller to list at a
 * number that was never dollars.
 */
export function formatMoney(
  value: number | null | undefined,
  currency: Currency = "USD",
): string {
  if (value == null) return "—";
  // Grouped thousands: "$1,499.00" reads as a price, "$1499.00" as a typo.
  const digits = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${CURRENCY_SYMBOL[currency]}${digits}`;
}

/**
 * Whether a price can drive the listing. The listing is denominated in USD on
 * eBay's US marketplace, so a euro figure can be shown for reference but must
 * never become the asking price — and there's no FX rate in this app to
 * convert it honestly.
 */
export function canPriceListing(price: CardPrice): boolean {
  return price.currency === "USD";
}

export function formatVariantLabel(variant: string): string {
  if (variant === "average") return "Average";
  if (MTG_FINISH_LABEL[variant]) return MTG_FINISH_LABEL[variant];
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
      currency: "USD",
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
      currency: "USD",
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
    // Euro prices are reference only — see canPriceListing. A card with
    // nothing but a Cardmarket figure gets no suggested price, which is the
    // honest outcome: better the seller sets one than we convert at a rate
    // we don't have.
    (p) => typeof p.market === "number" && p.market > 0 && canPriceListing(p),
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

/**
 * The latest daily point from the card's price-history series (the number the
 * chart's right edge shows) — see useLastRecordedPrice in PriceHistoryChart.
 */
export interface CurrentSeriesPoint {
  price: number;
  /** yyyy-mm-dd of the point. */
  day: string;
  variant: string;
  source: string;
  currency: Currency;
}

/** A series point older than this is history, not "the current price". */
const CURRENT_POINT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A catalogue point below this share of the eBay basis is a different market, not a fresher number. */
const CROSS_SOURCE_REBASE_FLOOR = 0.5;

/**
 * Whether the chart's point may replace the resolved snapshot price (Chris,
 * 09-01: "the market price should reflect the current price from that current
 * day" — the tile was quoting a scan-time eBay-asking average while the chart
 * showed today's real market). Rules: the point must be fresh USD; real eBay
 * SALES still outrank it; and an explicit Printing pick (or the 1st Edition
 * toggle, which routes through variantOverride) is only refreshed by a point
 * from that same series — never silently swapped to a different printing.
 */
function pointCanRebase(
  point: CurrentSeriesPoint | null | undefined,
  resolved: CardPrice | null,
  explicit: CardPrice | undefined,
): point is CurrentSeriesPoint {
  if (!point || point.currency !== "USD" || point.price <= 0) return false;
  if (Date.now() - Date.parse(`${point.day}T00:00:00Z`) > CURRENT_POINT_MAX_AGE_MS) return false;
  if (explicit) return explicit.source === point.source && explicit.variant === point.variant;
  // Across sources (eBay-asking basis, TCGplayer point) the point only takes
  // over when the two describe the same market: a $520 asking average and a
  // $472 point on a Charizard are one price moving (09-01 rule). A $1.45
  // asking average over a $0.34 point is the shipping-floor regime — cheap
  // cards list on eBay for what shipping costs, and the catalogue number is
  // not a price anyone can sell at — so the eBay basis stays and the tiles
  // agree with the eBay line (Chris, 09-03 Hoothoot: "pricing makes no
  // sense" — tiles $0.34, eBay $1.45, saved price $1.29).
  if (resolved && resolved.source !== point.source) {
    const basis = resolved.market ?? 0;
    if (basis > 0 && point.price < basis * CROSS_SOURCE_REBASE_FLOOR) return false;
  }
  return resolved?.variant !== EBAY_SOLD_VARIANT;
}

export function quotePrice(
  card: PokemonCard,
  condition: Condition,
  strategy: PriceStrategy,
  variantOverride?: string,
  currentPoint?: CurrentSeriesPoint | null,
): PriceQuote | null {
  const override = variantOverride
    ? card.prices.find((p) => p.variant === variantOverride)
    : undefined;

  // An override in another currency can't set a dollar asking price, so fall
  // back to the normal pick rather than quietly treating euros as dollars.
  const usable = override && canPriceListing(override) ? override : undefined;
  let price = usable ?? pickPrice(card);

  if (pointCanRebase(currentPoint, price, usable)) {
    const row = card.prices.find(
      (p) => p.source === currentPoint.source && p.variant === currentPoint.variant,
    );
    price = {
      source: (row?.source ?? currentPoint.source) as CardPrice["source"],
      variant: currentPoint.variant,
      label: row?.label ?? formatVariantLabel(currentPoint.variant),
      currency: "USD",
      market: currentPoint.price,
      low: row?.low ?? null,
      high: row?.high ?? null,
    };
  }

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

  const quote = quoteForItem(item);
  return item.priceOverride ?? quote?.suggested ?? 0;
}

/**
 * The quote for a queue item, with the item's own facts applied.
 *
 * Graded slabs bypass the condition and strategy multipliers: the grade IS
 * the condition, and no free source prices slabs — so the raw ungraded
 * market is quoted as a reference floor and the seller prices the slab
 * against eBay comps. Multiplying a PSA 10 by a "Lightly Played" discount
 * would be flatly wrong in both directions.
 *
 * Sealed items have no catalogue prices at all (empty prices array), so this
 * returns null and the price is whatever the seller enters.
 */
export function quoteForItem(
  item: ScanItem,
  currentPoint?: CurrentSeriesPoint | null,
): PriceQuote | null {
  if (!item.card) return null;
  if (item.grading) {
    return quotePrice(item.card, "Near Mint", "market", effectiveVariant(item), currentPoint);
  }
  return quotePrice(item.card, item.condition, item.strategy, effectiveVariant(item), currentPoint);
}

/**
 * The condition string the ledger stores and My Cards displays. For a slab
 * that's the grade ("PSA 10") and for sealed product it's "Factory Sealed" —
 * "Near Mint" on either would misdescribe what's actually for sale.
 */
export function describeItemCondition(item: ScanItem): string {
  if (item.kind === "sealed") return "Factory Sealed";
  if (item.grading) return gradeLabel(item.grading);
  return item.condition;
}

/** Facts about the specific copy being listed, beyond the catalogue card. */
export interface ListingFacts {
  firstEdition?: boolean;
  grading?: GradedInfo | null;
  /**
   * Sealed product: eBay comp searches drop the Individual Cards category
   * filter, which would exclude every sealed listing from the results.
   */
  sealed?: boolean;
  /** MTG finish of the copy being sold ("nonfoil" | "foil" | "etched"); the priced variant when unset. */
  finish?: string | null;
}

/** eBay caps listing titles at 80 characters. */
/**
 * Which non-English printing this card is, judged from its printed name:
 * kana means Japanese, Han ideographs without kana mean Chinese. Drives the
 * translate-before-posting rule (Chris, 08-28): a CJK card lists under its
 * English name with the language named -- that is both what US buyers
 * search ("Sylveon V Chinese") and honest disclosure of what ships.
 */
function cjkLanguage(card: PokemonCard): "Japanese" | "Chinese" | null {
  if (/[぀-ヿ]/.test(card.name)) return "Japanese";
  if (/[一-鿿]/.test(card.name)) return "Chinese";
  return null;
}

function buildTitle(
  card: PokemonCard,
  condition: Condition,
  facts: ListingFacts = {},
): string {
  // "1st Edition" goes right after the name — it's the term buyers search,
  // and it must survive even when the tail gets trimmed for length.
  const lang = cjkLanguage(card);
  const baseName = lang && card.englishName ? card.englishName : card.name;
  const name = facts.firstEdition ? `${baseName} 1st Edition` : baseName;
  // A slab's grade replaces the condition outright: "PSA 10 Near Mint" reads
  // as noise to a buyer, and the grade is the term they search.
  const tail = facts.grading ? gradeLabel(facts.grading) : condition;
  const game = GAMES[gameOf(card)];
  // MTG buyers search by set code + number ("LTR 187") and care whether it's
  // a foil; those words go before the game token so they survive trimming.
  const isMtg = game.id === "mtg";
  const number = isMtg && card.setCode ? `${card.setCode} ${card.number}` : card.number;
  const finish = isMtg && facts.finish && facts.finish !== "nonfoil" ? MTG_FINISH_LABEL[facts.finish] ?? facts.finish : "";
  const token = [finish, lang ?? "", game.titleToken].filter(Boolean).join(" ");

  // A CJK set name is dead weight in an English-market title; the English
  // name + number + language identify the card.
  const setForTitle = lang ? "" : card.setName;
  const full = `${name} ${setForTitle} ${number} ${token} ${tail}`.replace(/\s+/g, " ");
  if (full.length <= 80) return full;

  // When trimming, drop what buyers search for least: for a slab the grade is
  // the search term so the set name goes; for a raw card the set matters more
  // than the condition.
  const trimmed = (
    facts.grading
      ? `${name} ${number} ${token} ${tail}`
      : `${name} ${setForTitle} ${number} ${token}`
  ).replace(/\s+/g, " ");
  if (trimmed.length <= 80) return trimmed;

  return trimmed.slice(0, 80).trim();
}

export function buildListing(
  card: PokemonCard,
  price: number,
  condition: Condition,
  variantLabel?: string,
  facts: ListingFacts = {},
): ListingDraft {
  // The synthesized eBay comps rows carry labels like "eBay asking (54
  // listings)" — a price basis, not a printing. When one of those drives the
  // quote there is no printing to name, so the line is dropped rather than
  // telling buyers the card's printing is "eBay asking".
  const printingLabel =
    variantLabel && !/^eBay\b/i.test(variantLabel) ? variantLabel : undefined;

  const conditionLine = facts.grading
    ? `Professionally graded ${gradeLabel(facts.grading)}. The slab in the photos is the exact one you will receive — please verify the cert number.`
    : `Condition: ${condition}. Graded by eye — please review the photos, which show the exact card you will receive.`;

  const shippingLine = facts.grading
    ? "Slab shipped between cardboard in a bubble mailer, sent within 1 business day."
    : "Shipped in a penny sleeve and top loader inside a rigid mailer, sent within 1 business day.";

  const game = GAMES[gameOf(card)];
  const isMtg = game.id === "mtg";
  // The finish of an MTG copy is whatever printing drives the quote unless
  // the caller says otherwise ("Foil" label → foil).
  if (isMtg && !facts.finish && printingLabel) {
    const key = Object.entries(MTG_FINISH_LABEL).find(([, label]) => label === printingLabel)?.[0];
    if (key) facts = { ...facts, finish: key };
  }
  const descLang = cjkLanguage(card);
  const descName = descLang && card.englishName ? `${card.englishName} (${card.name})` : card.name;
  const numberLine = isMtg && card.setCode
    ? `${descName} — ${card.setName} (${card.setCode}), collector number ${card.number}.`
    : `${descName} — ${card.setName}, card ${card.number}.`;
  const languageLine = descLang ? `${descLang}-language printing.` : null;
  const finishLine = isMtg && (facts.finish || printingLabel)
    ? `Finish: ${MTG_FINISH_LABEL[facts.finish ?? ""] ?? printingLabel ?? "Nonfoil"}.`
    : null;

  const description = [
    numberLine,
    languageLine,
    [
      card.rarity ? `Rarity: ${card.rarity}.` : null,
      isMtg && card.typeLine ? `${card.typeLine}.` : null,
      // The variant label already names 1st Edition when it drives the price;
      // the explicit line covers cards priced off another printing.
      facts.firstEdition && !/1st/i.test(printingLabel ?? "")
        ? "1st Edition printing."
        : null,
      isMtg ? finishLine : printingLabel ? `Printing: ${printingLabel}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    conditionLine,
    shippingLine,
    "Happy to combine shipping on multiple cards — message before paying and I'll send an updated invoice.",
  ]
    .filter((line) => line && line.length > 0)
    .join("\n\n");

  return {
    title: buildTitle(card, condition, facts),
    description,
    price,
    categoryId: CCG_CARDS_CATEGORY_ID,
    categoryName: game.singlesCategoryName,
  };
}

/**
 * A sealed product's listing. Separate from buildListing because almost none
 * of a card's description applies: there's no collector number, rarity,
 * printing, or condition scale — the one fact that sells sealed product is
 * that it's factory sealed, so the copy leads with that.
 */
export function buildSealedListing(
  product: PokemonCard,
  price: number,
  productType?: string | null,
): ListingDraft {
  const game = GAMES[gameOf(product)];
  const full = `${product.name} ${game.titleToken} Factory Sealed`;
  const title = full.length <= 80 ? full : full.slice(0, 80).trim();

  const description = [
    `${product.name} (${game.fullName}) — factory sealed and unopened.`,
    "Please review the photos, which show the exact item you will receive.",
    "Shipped boxed with padding, sent within 1 business day.",
    "Happy to combine shipping on multiple items — message before paying and I'll send an updated invoice.",
  ].join("\n\n");

  const isLoosePack = /pack$/i.test(productType ?? "");

  return {
    title,
    description,
    price,
    categoryId: isLoosePack
      ? CCG_SEALED_PACKS_CATEGORY_ID
      : CCG_SEALED_BOXES_CATEGORY_ID,
    categoryName: `${game.sealedCategoryName} > ${isLoosePack ? "Sealed Packs" : "Sealed Boxes"}`,
  };
}

/**
 * Price rows fit to show a seller. Cardmarket's product averages sometimes
 * blend 1st Edition / graded sales into one figure (Base Set Charizard:
 * "Average (EUR)" €4,184 next to an $855 TCGplayer market) — a row that far
 * off the best USD market discredits the whole table, so it's dropped at
 * display time (cached rows predate the fetch-time guard in lib/tcg.ts).
 */
export function plausiblePrices(prices: CardPrice[]): CardPrice[] {
  const usdMarket = prices.reduce<number | null>(
    (best, p) =>
      p.currency === "USD" && p.market != null && (best == null || p.market > best)
        ? p.market
        : best,
    null,
  );
  if (usdMarket == null) return prices;
  return prices.filter(
    (p) => p.currency === "USD" || p.market == null || p.market <= usdMarket * 4,
  );
}

/**
 * The seller's own words win over the generated copy. Overrides live on the
 * queue item so every posting road — the editor's buttons, "Send all", and
 * the CSV export — ships the same text the editor showed.
 */
export function withListingOverrides(
  listing: ListingDraft,
  item: { titleOverride: string | null; descriptionOverride: string | null },
): ListingDraft {
  const title = item.titleOverride?.trim() ? item.titleOverride.slice(0, 80) : listing.title;
  const description = item.descriptionOverride?.trim() ? item.descriptionOverride : listing.description;
  if (title === listing.title && description === listing.description) return listing;
  return { ...listing, title, description };
}

/** The buyer-facing search terms for what's actually being sold. */
function ebayQuery(card: PokemonCard, facts: ListingFacts = {}): string {
  const name = card.englishName || card.name;
  const game = GAMES[gameOf(card)];
  // MTG: the set code is how buyers narrow a reprinted name to one printing;
  // "foil" only when the copy is one (a nonfoil search would drag foils in).
  const isMtg = game.id === "mtg";
  return [
    name,
    isMtg && card.setCode ? card.setCode : "",
    card.number,
    isMtg && facts.finish && facts.finish !== "nonfoil" ? "foil" : "",
    facts.firstEdition ? "1st edition" : "",
    facts.grading ? gradeLabel(facts.grading) : "",
    game.searchToken,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The eBay search a human would run for this card — same query the comps
 * average is built from, so the seller can click through and check our work.
 * Lives here rather than in the server eBay client because the UI links to it
 * even when there are no comps (or no eBay credentials) to show.
 */
export function ebaySearchUrl(card: PokemonCard, facts: ListingFacts = {}): string {
  const params = new URLSearchParams({
    _nkw: ebayQuery(card, facts),
    // Best Match (Chris, 09-01 — was price+shipping lowest first): the
    // cheapest-first view led with junk/damaged outliers; eBay's own
    // relevance puts the listings the average is really made of up top.
    _sop: "12",
  });
  if (!facts.sealed) params.set("_sacat", CCG_CARDS_CATEGORY_ID);
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
export function ebaySoldSearchUrl(
  card: PokemonCard,
  facts: ListingFacts = {},
): string {
  const params = new URLSearchParams({
    _nkw: ebayQuery(card, facts),
    LH_Sold: "1",
    LH_Complete: "1",
  });
  if (!facts.sealed) params.set("_sacat", CCG_CARDS_CATEGORY_ID);
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

/**
 * eBay's own listing flow, pre-filled with our title. eBay auto-saves what
 * this opens under My eBay › Drafts — which is the only way to land there
 * without the limited-release Listing API (eBay routes it 404 for keysets
 * it hasn't approved; see createDraft in server/ebaySell.ts).
 *
 * URL history (08-16): the old `/sl/list?sr=sell&title=` deep link now dies
 * in eBay's new listing tool with `MISSING_DRAFT_ID_MODE` (the form wants a
 * mode or a draft id). eBay's prelist flow still takes `title`:
 * `/sl/prelist/suggest` shows the box pre-filled (one more tap on the
 * magnifier), `/sl/prelist/identify` runs the catalog search itself and
 * lands on the matches — verified 08-16 (page carries the matched catalog
 * titles + "Continue without match"). With an exact match eBay creates the
 * draft right there (Chris's Mewtwo ex landed in My eBay › Drafts under
 * eBay's catalog title) and drops the seller in Seller Hub › Drafts.
 */
export function ebayDraftFormUrl(listing: ListingDraft): string {
  const params = new URLSearchParams({ title: listing.title.slice(0, 80) });
  return `https://www.ebay.com/sl/prelist/identify?${params.toString()}`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface EbayDraftsCsvRow {
  listing: ListingDraft;
  /** Ledger id → our SKU and the public photo URL eBay's importer fetches. */
  ledgerId: string | null;
  /** True when the seller's own photo is stored for this card (never send catalogue art — eBay's picture policy). */
  hasPhoto: boolean;
  sealed: boolean;
  /** Identical copies on the one draft row (eBay's Quantity column). */
  quantity: number;
}

/**
 * eBay's Seller Hub "Create new drafts" upload file — the bulk road into the
 * seller's Drafts folder (Seller Hub › Listings › Drafts) that needs no API
 * approval: CardFlip writes one file for the whole stack, the seller uploads
 * it once at Seller Hub › Reports › Uploads, and every row lands as a draft
 * they finish + list from there. Column names, order, the `Draft` action and
 * the NEW/USED-only Condition ID are eBay's spec (pages.ebay.com/sh/reports/
 * help/uploadable-file-feeds, "Draft template field definitions"); the #INFO
 * rows mirror eBay's own template and are ignored by the importer. Card
 * condition (NM/LP…) doesn't fit their two-value column, so it stays in the
 * title + description, as on the API road.
 */
export function toEbayDraftsCsv(rows: EbayDraftsCsvRow[]): string {
  const info = [
    "#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,",
    "#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,",
    '"#INFO After you\'ve successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts",,,,,,,,,,',
    "#INFO,,,,,,,,,,",
  ];
  const header = [
    "Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)",
    "Custom label (SKU)",
    "Category ID",
    "Title",
    "UPC",
    "Price",
    "Quantity",
    "Item photo URL",
    "Condition ID",
    "Description",
    "Format",
  ];
  const lines = rows.map(({ listing, ledgerId, hasPhoto, sealed, quantity }) =>
    [
      "Draft",
      ledgerId ? `cardflip-${ledgerId}` : "",
      listing.categoryId,
      listing.title.slice(0, 80),
      "",
      listing.price.toFixed(2),
      Math.min(99, Math.max(1, Math.floor(quantity || 1))),
      ledgerId && hasPhoto ? `${SITE_URL}/api/card-image/${ledgerId}` : "",
      sealed ? "NEW" : "USED",
      descriptionHtml(listing.description),
      "FixedPrice",
    ]
      .map(csvCell)
      .join(","),
  );
  return [...info, header.join(","), ...lines].join("\r\n") + "\r\n";
}
