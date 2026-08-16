export type ScanLanguage = "en" | "ja" | "zh";

/**
 * Which trading-card game a card / scan / ledger row belongs to. Pokémon was
 * the only game for the first months, so it stays the default wherever the
 * field is optional; MTG rides the same pipeline behind this switch (its own
 * mirror table, vision prompt, listing words and eBay aspects — see
 * lib/games.ts).
 */
export type GameId = "pokemon" | "mtg";

export type PriceSource = "tcgplayer" | "cardmarket" | "ebay";

/**
 * Cardmarket quotes in euros while TCGplayer and eBay quote in dollars, and
 * the listing this app produces is priced in dollars — so the currency has to
 * travel with the number rather than being assumed.
 */
export type Currency = "USD" | "EUR";

export interface CardPrice {
  source: PriceSource;
  /** Raw variant key, e.g. "holofoil", "reverseHolofoil", "normal". */
  variant: string;
  /** Human label, e.g. "Holofoil". */
  label: string;
  currency: Currency;
  market: number | null;
  low: number | null;
  high: number | null;
  /**
   * Backward-looking averages the source publishes (Cardmarket via
   * pokemontcg.io: 1-, 7- and 30-day). Real history from day one, before our
   * own daily snapshots have accumulated — see PriceHistoryChart.
   */
  trend?: { avg1: number | null; avg7: number | null; avg30: number | null };
}

export interface PokemonCard {
  id: string;
  name: string;
  setName: string;
  setSeries: string;
  number: string;
  rarity: string | null;
  imageSmall: string;
  imageLarge: string;
  prices: CardPrice[];
  /** English species name, for non-English cards ("ピカチュウ" -> "Pikachu"). */
  englishName: string | null;
  /**
   * The denominator this card prints ("25/102" -> 102) — the base card count
   * of its set. Optional because only the English mirror carries it, and only
   * once re-synced.
   */
  setTotal?: number | null;
  /** Expansion code printed beside the number, e.g. "SVI". */
  setCode?: string | null;
  /** Numbered above its set's base count — an ultra-rare or special print. */
  isSecretRare?: boolean;
  /** Absent = Pokémon (the original game). MTG cards always carry "mtg". */
  game?: GameId;
  /** MTG: Scryfall type line ("Legendary Creature — Human Wizard"). */
  typeLine?: string | null;
  /** MTG: finishes this printing exists in ("nonfoil", "foil", "etched"). */
  finishes?: string[];
}

/** The game a card belongs to; Pokémon when the field was never set. */
export function gameOf(card: { game?: GameId } | null | undefined): GameId {
  return card?.game ?? "pokemon";
}

/** What Claude read off a card photo. */
export interface VisionCardRead {
  /** Name exactly as printed, in the card's own language. */
  name: string;
  /** English species name when the card isn't English, else null. */
  englishName: string | null;
  setName: string | null;
  /** Collector number as printed, e.g. "199/165" -> "199". */
  cardNumber: string | null;
  /**
   * The set total printed after the slash ("199/165" -> 165). Read separately
   * from the collector number because it identifies the *expansion*, which is
   * what tells two same-named, same-numbered reprints apart.
   */
  setTotal: number | null;
  /** The expansion code printed near the number, e.g. "SVI". */
  setCode: string | null;
  language: ScanLanguage;
  /** Condition judged from the photo, or null if the photo can't support a call. */
  condition: string | null;
  /** What drove the condition call — edge wear, centering, surface scratches. */
  conditionNotes: string | null;
  /** 0-1. Below ~0.5 the scanner should treat this as a guess. */
  confidence: number;
}

export type VisionStatus = "idle" | "unconfigured" | "done" | "error";

/** One live eBay listing that fed a comps average. */
export interface EbayListing {
  id: string;
  title: string;
  price: number;
  url: string;
  imageUrl: string;
  condition: string | null;
  /** ISO date the item sold, for sold comps. Null on active listings. */
  soldAt?: string | null;
}

/**
 * What similar cards are actually selling for on eBay right now, summarized.
 * `average` is trimmed — see buildComps — so a single mispriced listing can't
 * drag the number the seller ends up trusting.
 */
export interface EbayComps {
  average: number;
  median: number;
  low: number;
  high: number;
  /** Listings that survived filtering and fed the average. */
  count: number;
  /** Raw results eBay returned, before filtering. */
  sampled: number;
  /** The comparable listings themselves, cheapest first. */
  listings: EbayListing[];
  /** eBay search this card's comps came from, for the seller to eyeball. */
  searchUrl: string;
}

/**
 * Sold data rides on a separately-approved eBay scope, so it can be
 * unavailable while active listings work fine.
 */
export type EbaySoldStatus = "done" | "empty" | "unconfigured" | "unavailable";

export type EbayCompsStatus =
  | "idle"
  | "loading"
  | "done"
  | "empty"
  | "unconfigured"
  | "error";

export type Condition =
  | "Near Mint"
  | "Lightly Played"
  | "Moderately Played"
  | "Heavily Played"
  | "Damaged";

export type PriceStrategy = "quick" | "market";

export interface PriceQuote {
  /** The variant the quote is based on. */
  price: CardPrice;
  /** Market value before condition and strategy adjustments. */
  base: number;
  /** Final suggested listing price. */
  suggested: number;
}

export interface ListingDraft {
  title: string;
  description: string;
  price: number;
  categoryId: string;
  categoryName: string;
}

export type ScanStatus =
  | "queued"
  | "scanning"
  | "review"
  | "ready"
  | "listed"
  | "sold"
  | "error";

/**
 * What a queue item physically is. "card" is a single (raw or slabbed);
 * "sealed" is unopened product — a pack, box, or boxed set — carried through
 * the same pipeline with a synthesized card object (see lib/grading.ts).
 */
export type ItemKind = "card" | "sealed";

export type GradingCompany = "PSA" | "CGC";

/** A slab's grade as the seller declared it in the editor. */
export interface GradedInfo {
  company: GradingCompany;
  /** One of gradesFor(company) in lib/grading.ts — "10", "8.5", "10 Pristine". */
  grade: string;
}

/** One card moving through the scan → price → listing → sale pipeline. */
export interface ScanItem {
  id: string;
  kind: ItemKind;
  /** Game the scanner was set to when this item entered the queue. */
  game: GameId;
  /** Id of the backing row once this card has been synced to the server. */
  serverId: string | null;
  /** Null when the card was added by typed search rather than a photo. */
  file: File | null;
  /** Object URL of the uploaded photo; empty for search-added cards. */
  previewUrl: string;
  /** Language selected when this photo was added, for OCR + lookup. */
  language: ScanLanguage;
  status: ScanStatus;
  /** Possible matches returned by the lookup, best first. */
  candidates: PokemonCard[];
  card: PokemonCard | null;
  condition: Condition;
  strategy: PriceStrategy;
  /** Explicit variant choice, or null to use the default pick. */
  variant: string | null;
  /**
   * Seller says this is a 1st Edition printing (WotC-era sets only — see
   * canBeFirstEdition). Prefers the 1st Edition market price when the source
   * has one, and marks the listing title/description either way.
   */
  firstEdition: boolean;
  /**
   * Set when the card is in a graded slab (PSA/CGC + grade). Replaces the
   * condition flow: a slab's condition IS its grade, so the raw-card
   * multipliers must not touch a graded price.
   */
  grading: GradedInfo | null;
  /** Sealed items only: which product this is ("Booster Box", ...). */
  productType: string | null;
  /** Manual price entry, or null to use the computed quote. */
  priceOverride: number | null;
  /** What Claude read off the photo, when vision is configured. */
  vision: VisionCardRead | null;
  visionStatus: VisionStatus;
  /** What similar cards are being asked for on eBay, once looked up. */
  ebay: EbayComps | null;
  ebayStatus: EbayCompsStatus;
  /** What similar cards actually sold for in the last 90 days. */
  ebaySold: EbayComps | null;
  ebaySoldStatus: EbaySoldStatus;
  /** eBay's sold-listings search, which works without API access. */
  ebaySoldUrl: string | null;
  error: string | null;
  /**
   * Set once the draft has been pushed to the seller's own eBay account via
   * the Sell Inventory API (offer id), and once that offer is published (the
   * live item URL). Both are server-issued; the client only mirrors them.
   */
  ebayOfferId: string | null;
  ebayListingUrl: string | null;
  /** Listing API draft in the seller's My eBay › Drafts — opens in eBay's listing tool. */
  ebayDraftUrl: string | null;
  /**
   * When the seller's own photo of this copy was stored on the server — the
   * only image eBay is sent (picture policy: the actual item, never stock
   * art). Scanned items upload their photo on the first "Send to eBay";
   * search-added and sealed items need one picked.
   */
  photoAt: number | null;
  /** Price the listing went live at, locked in once posted. */
  listedPrice: number | null;
  listedAt: number | null;
  /** Final sale price — may differ from listedPrice via an offer/best-offer. */
  soldPrice: number | null;
  soldAt: number | null;
}
