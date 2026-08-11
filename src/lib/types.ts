export type ScanLanguage = "en" | "ja" | "zh";

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

/** One card photo moving through the scan → price → listing → sale pipeline. */
export interface ScanItem {
  id: string;
  /** Id of the backing row once this card has been synced to the server. */
  serverId: string | null;
  file: File;
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
  /** Price the listing went live at, locked in once posted. */
  listedPrice: number | null;
  listedAt: number | null;
  /** Final sale price — may differ from listedPrice via an offer/best-offer. */
  soldPrice: number | null;
  soldAt: number | null;
}
