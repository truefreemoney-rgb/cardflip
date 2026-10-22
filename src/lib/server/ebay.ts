import "server-only";
import { buildComps, isComparable } from "@/lib/ebayComps";
import type { AskSeller } from "@/lib/ebayReferee";
import { ebaySearchUrl, ebaySoldSearchUrl } from "@/lib/listing";
import { gameOf, type EbayComps, type EbayListing, type GradedInfo, type PokemonCard } from "@/lib/types";
import { GAMES } from "@/lib/games";

export { ebaySearchUrl, ebaySoldSearchUrl };

/**
 * Live eBay comps via the Browse API.
 *
 * The seller's real question is "what is this actually going for right now",
 * and eBay is where they're about to sell it — so eBay's own listings are a
 * better anchor than a third-party price guide. Browse exposes only *active*
 * listings (sold/completed data lives behind Marketplace Insights, which needs
 * separate eBay approval), so this is an asking-price average, not a
 * sold-price average. The filtering and statistics live in @/lib/ebayComps.
 */

const EBAY_API = "https://api.ebay.com";
/** Collectible Card Games > Pokémon TCG > Individual Cards. */
// eBay's single leaf for every CCG game (Pokémon and Magic alike); the game
// itself is an item specific, so the query carries the game word instead.
const CCG_SINGLES_CATEGORY = "183454";

/**
 * The comps search text: name + collector number, plus the set code for MTG
 * (a name is reprinted across dozens of sets; the code pins the printing) and
 * the game word so a Pokémon "Charizard 4" and an MTG "Charizard" never mix.
 * Every game carries its word (10-22; the referee queries already did): a bare
 * "Elsa 12" pulled other games' cards.
 */
function compsQuery(card: PokemonCard, firstEdition = false): string {
  const name = card.englishName || card.name;
  const game = GAMES[gameOf(card)];
  return [
    name,
    game.id === "mtg" && card.setCode ? card.setCode : "",
    card.number,
    firstEdition ? "1st edition" : "",
    game.searchToken,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}
const MARKETPLACE = "EBAY_US";

export class EbayNotConfiguredError extends Error {
  constructor() {
    super("eBay API credentials are not configured");
    this.name = "EbayNotConfiguredError";
  }
}

export function isEbayConfigured(): boolean {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new EbayNotConfiguredError();
  return { clientId, clientSecret };
}

const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";
const INSIGHTS_SCOPE =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

// eBay app tokens last ~2 hours. Cached in module scope so a batch of scans
// costs one token call rather than one per card. Keyed by scope: a Browse
// token can't read sold data, and reusing one for the other 403s.
const tokenCache = new Map<string, { value: string; expiresAt: number }>();

export async function getAppToken(scope: string = BROWSE_SCOPE): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const { clientId, clientSecret } = credentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    tokenCache.delete(scope);
    // A keyset without Marketplace Insights approval fails here, not at search.
    throw new Error(`eBay token request failed (${res.status})`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(scope, {
    value: json.access_token,
    // Retire it a minute early so we never race the expiry mid-request.
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  });
  return json.access_token;
}

interface ItemSummary {
  itemId?: string;
  title?: string;
  price?: { value?: string; currency?: string };
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: { imageUrl?: string }[];
  condition?: string;
  conditionId?: string;
  buyingOptions?: string[];
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
}

/** The seller's feedback as the summary gives it (strings from eBay; null when absent), for the referee's seller floor. */
export function sellerOf(item: { seller?: { feedbackPercentage?: string; feedbackScore?: number } }): AskSeller | null {
  const s = item.seller;
  if (!s) return null;
  const pct = s.feedbackPercentage == null || s.feedbackPercentage === "" ? NaN : Number(s.feedbackPercentage);
  const score = s.feedbackScore == null ? NaN : Number(s.feedbackScore);
  if (!Number.isFinite(pct) && !Number.isFinite(score)) return null;
  return { pct: Number.isFinite(pct) ? pct : null, score: Number.isFinite(score) ? score : null };
}

/** eBay's card conditions in 183454: 4000 = Ungraded, 2750 = Graded (a slab). */
const CONDITION_UNGRADED = "4000";
const CONDITION_GRADED = "2750";

/**
 * The Browse filter every price read uses (Chris 10-21: "STOP LOOKING AT SLABS",
 * "only Buy It Now"): fixed-price listings in the asked-for condition. A title
 * word filter lets slabs through (a seller who writes "PSA" nowhere), so the
 * condition is eBay's own item specific, not the title. Auctions show a bid.
 */
export function browsePriceFilter(graded = false): string {
  return `buyingOptions:{FIXED_PRICE},conditionIds:{${graded ? CONDITION_GRADED : CONDITION_UNGRADED}}`;
}

/**
 * Buy It Now at the shown price only. eBay's filter keeps any listing that
 * OFFERS fixed price, including ones that also take Best Offer; those sell
 * below the ask by an amount nobody can see, so the ask is not a price.
 */
export function isPlainFixedPrice(item: { buyingOptions?: string[] }): boolean {
  const opts = item.buyingOptions;
  if (!opts || opts.length === 0) return true; // older summaries omit it
  return opts.includes("FIXED_PRICE") && !opts.includes("BEST_OFFER") && !opts.includes("AUCTION");
}

/**
 * What this card is currently listed for on eBay.
 * Returns null when eBay had nothing comparable to say about it.
 */
export async function fetchEbayComps(
  card: PokemonCard,
  grading?: { company: string; grade: string } | null,
  /** See isComparable: true = stamped copies only, false = unstamped only. */
  firstEdition?: boolean | null,
): Promise<EbayComps | null> {
  const token = await getAppToken(BROWSE_SCOPE);
  const searchUrl = ebaySearchUrl(card, { firstEdition: firstEdition === true, grading: grading as GradedInfo | null });

  const url = new URL(`${EBAY_API}/buy/browse/v1/item_summary/search`);
  // For a slab, the company+grade go into the query and isComparable flips
  // from rejecting graded titles to requiring exactly this grade.
  const base = compsQuery(card, firstEdition === true);
  const query = grading
    ? `${base} ${grading.company} ${grading.grade.match(/\d+(?:\.\d+)?/)?.[0] ?? grading.grade}`
    : base;
  url.searchParams.set("q", query);
  url.searchParams.set("category_ids", CCG_SINGLES_CATEGORY);
  url.searchParams.set("limit", "100");
  // An auction mid-flight shows a current bid, not what the card is worth;
  // a raw card compared to slabs reads far too high (10-21).
  url.searchParams.set("filter", browsePriceFilter(Boolean(grading)));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 401) {
    // Token rejected — drop it so the next call re-authenticates cleanly.
    tokenCache.delete(BROWSE_SCOPE);
    throw new Error("eBay rejected the access token");
  }
  if (!res.ok) throw new Error(`eBay search failed (${res.status})`);

  const json = (await res.json()) as { itemSummaries?: ItemSummary[] };
  const raw = json.itemSummaries ?? [];

  const listings: EbayListing[] = [];
  for (const item of raw) {
    const title = item.title;
    const value = Number(item.price?.value);
    if (!title || !Number.isFinite(value) || value <= 0) continue;
    // Mixed currencies would silently corrupt a USD average.
    if (item.price?.currency && item.price.currency !== "USD") continue;
    if (!isPlainFixedPrice(item)) continue;
    if (!isComparable(title, card, grading, firstEdition)) continue;

    listings.push({
      id: item.itemId ?? `${title}-${value}`,
      title,
      price: value,
      url: item.itemWebUrl ?? searchUrl,
      imageUrl: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl ?? "",
      condition: item.condition ?? null,
    });
  }

  return buildComps(listings, searchUrl, raw.length);
}

/**
 * The raw asks for a search (the nightly eBay referee, lib/server/ebayReferee.ts): Ungraded, plain Buy It Now CCG
 * singles on ebay.com, USD only, up to 200, otherwise unfiltered (the referee's printing-aware matcher filters). One
 * Browse call.
 */
export async function searchEbayAsks(query: string): Promise<{ title: string; price: number; seller: AskSeller | null }[]> {
  const token = await getAppToken(BROWSE_SCOPE);
  const url = new URL(`${EBAY_API}/buy/browse/v1/item_summary/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("category_ids", CCG_SINGLES_CATEGORY);
  url.searchParams.set("limit", "200");
  url.searchParams.set("filter", browsePriceFilter(false));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 401) {
    tokenCache.delete(BROWSE_SCOPE);
    throw new Error("eBay rejected the access token");
  }
  if (!res.ok) throw new Error(`eBay search failed (${res.status})`);
  const json = (await res.json()) as { itemSummaries?: ItemSummary[] };
  const out: { title: string; price: number; seller: AskSeller | null }[] = [];
  for (const item of json.itemSummaries ?? []) {
    const price = Number(item.price?.value);
    if (!item.title || !(price > 0) || (item.price?.currency && item.price.currency !== "USD")) continue;
    if (!isPlainFixedPrice(item)) continue;
    out.push({ title: item.title, price, seller: sellerOf(item) });
  }
  return out;
}

interface ItemSale {
  itemId?: string;
  title?: string;
  lastSoldPrice?: { value?: string; currency?: string };
  lastSoldDate?: string;
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: { imageUrl?: string }[];
  condition?: string;
  buyingOptions?: string[];
}

/**
 * What this card has actually **sold** for on eBay in the last 90 days.
 *
 * This is the number that should drive pricing: an asking-price average says
 * what sellers hope for, a sold average says what buyers paid. It needs the
 * Marketplace Insights API, which eBay grants separately from the standard
 * Browse access — without that approval the token request fails and the caller
 * falls back to active listings.
 */
export async function fetchEbaySoldComps(
  card: PokemonCard,
): Promise<EbayComps | null> {
  const token = await getAppToken(INSIGHTS_SCOPE);
  const searchUrl = ebaySoldSearchUrl(card);

  const url = new URL(
    `${EBAY_API}/buy/marketplace_insights/v1_beta/item_sales/search`,
  );
  url.searchParams.set("q", compsQuery(card));
  url.searchParams.set("category_ids", CCG_SINGLES_CATEGORY);
  url.searchParams.set("limit", "100");
  // 90 days is the window eBay exposes; anything staler misprices a moving card.
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  // Same rules as the live reads: ungraded, plain Buy It Now (an accepted Best
  // Offer reports the ask, not the paid price).
  url.searchParams.set("filter", `lastSoldDate:[${since}..],${browsePriceFilter(false)}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 401) {
    tokenCache.delete(INSIGHTS_SCOPE);
    throw new Error("eBay rejected the access token");
  }
  if (res.status === 403) {
    throw new Error("eBay keyset lacks Marketplace Insights access");
  }
  if (!res.ok) throw new Error(`eBay sold search failed (${res.status})`);

  const json = (await res.json()) as { itemSales?: ItemSale[] };
  const raw = json.itemSales ?? [];

  const listings: EbayListing[] = [];
  for (const item of raw) {
    const title = item.title;
    const value = Number(item.lastSoldPrice?.value);
    if (!title || !Number.isFinite(value) || value <= 0) continue;
    if (item.lastSoldPrice?.currency && item.lastSoldPrice.currency !== "USD") continue;
    if (!isPlainFixedPrice(item)) continue;
    // Same filter as active listings — a sold bulk lot is just as misleading.
    if (!isComparable(title, card)) continue;

    listings.push({
      id: item.itemId ?? `${title}-${value}-${item.lastSoldDate ?? ""}`,
      title,
      price: value,
      url: item.itemWebUrl ?? searchUrl,
      imageUrl: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl ?? "",
      condition: item.condition ?? null,
      soldAt: item.lastSoldDate ?? null,
    });
  }

  return buildComps(listings, searchUrl, raw.length);
}
