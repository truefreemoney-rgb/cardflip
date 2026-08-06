export type ScanLanguage = "en" | "ja";

export type PriceSource = "tcgplayer" | "cardmarket";

export interface CardPrice {
  source: PriceSource;
  /** Raw variant key, e.g. "holofoil", "reverseHolofoil", "normal". */
  variant: string;
  /** Human label, e.g. "Holofoil". */
  label: string;
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
}

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
  error: string | null;
  /** Price the listing went live at, locked in once posted. */
  listedPrice: number | null;
  listedAt: number | null;
  /** Final sale price — may differ from listedPrice via an offer/best-offer. */
  soldPrice: number | null;
  soldAt: number | null;
}
