import "server-only";
import { buildComps, isComparable } from "@/lib/ebayComps";
import { ebaySearchUrl, ebaySoldSearchUrl } from "@/lib/listing";
import type { EbayComps, EbayListing, PokemonCard } from "@/lib/types";

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
const POKEMON_SINGLES_CATEGORY = "183454";
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

async function getAppToken(scope: string): Promise<string> {
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
}

/**
 * What this card is currently listed for on eBay.
 * Returns null when eBay had nothing comparable to say about it.
 */
export async function fetchEbayComps(card: PokemonCard): Promise<EbayComps | null> {
  const token = await getAppToken(BROWSE_SCOPE);
  const name = card.englishName || card.name;
  const searchUrl = ebaySearchUrl(card);

  const url = new URL(`${EBAY_API}/buy/browse/v1/item_summary/search`);
  url.searchParams.set("q", `${name} ${card.number}`.trim());
  url.searchParams.set("category_ids", POKEMON_SINGLES_CATEGORY);
  url.searchParams.set("limit", "100");
  // An auction mid-flight shows a current bid, not what the card is worth.
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");

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
    if (!isComparable(title, card)) continue;

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

interface ItemSale {
  itemId?: string;
  title?: string;
  lastSoldPrice?: { value?: string; currency?: string };
  lastSoldDate?: string;
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: { imageUrl?: string }[];
  condition?: string;
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
  const name = card.englishName || card.name;
  const searchUrl = ebaySoldSearchUrl(card);

  const url = new URL(
    `${EBAY_API}/buy/marketplace_insights/v1_beta/item_sales/search`,
  );
  url.searchParams.set("q", `${name} ${card.number}`.trim());
  url.searchParams.set("category_ids", POKEMON_SINGLES_CATEGORY);
  url.searchParams.set("limit", "100");
  // 90 days is the window eBay exposes; anything staler misprices a moving card.
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  url.searchParams.set("filter", `lastSoldDate:[${since}..]`);

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
