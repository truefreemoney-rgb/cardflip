import type { PokemonCard, CardPrice } from "@/lib/types";
import { formatVariantLabel } from "@/lib/listing";

/** Server-side client for the public Pokémon TCG API. */

const API_BASE = "https://api.pokemontcg.io/v2/cards";

export interface RawTcgCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set?: { name?: string; series?: string };
  images?: { small?: string; large?: string };
  tcgplayer?: {
    prices?: Record<
      string,
      { low?: number; mid?: number; high?: number; market?: number }
    >;
  };
  cardmarket?: {
    prices?: {
      averageSellPrice?: number;
      lowPrice?: number;
      trendPrice?: number;
    };
  };
}

function extractPrices(card: RawTcgCard): CardPrice[] {
  const prices: CardPrice[] = [];

  for (const [variant, p] of Object.entries(card.tcgplayer?.prices ?? {})) {
    prices.push({
      source: "tcgplayer",
      variant,
      label: formatVariantLabel(variant),
      market: p.market ?? p.mid ?? null,
      low: p.low ?? null,
      high: p.high ?? null,
    });
  }

  const cm = card.cardmarket?.prices;
  if (cm) {
    prices.push({
      source: "cardmarket",
      variant: "average",
      label: "Average (EUR)",
      market: cm.trendPrice ?? cm.averageSellPrice ?? null,
      low: cm.lowPrice ?? null,
      high: null,
    });
  }

  return prices;
}

export function mapCard(card: RawTcgCard): PokemonCard {
  return {
    id: card.id,
    name: card.name,
    setName: card.set?.name ?? "Unknown set",
    setSeries: card.set?.series ?? "",
    number: card.number,
    rarity: card.rarity ?? null,
    imageSmall: card.images?.small ?? "",
    imageLarge: card.images?.large ?? "",
    prices: extractPrices(card),
    // Already English — no overlay needed.
    englishName: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * pokemontcg.io is flaky in practice — confirmed directly by hammering it
 * with back-to-back requests: 500s came back on 2 of 3 attempts, with a
 * plain retry succeeding immediately after. A single failed request
 * shouldn't read as "no cards found" when the very next attempt would have
 * worked, so this retries transient failures before giving up.
 */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  revalidate: number,
): Promise<Response> {
  const attempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
        next: { revalidate },
      });
      clearTimeout(timeout);
      if (res.ok) return res;
      // 4xx won't succeed on retry (bad query) — only 5xx/upstream hiccups are worth retrying.
      if (res.status < 500) return res;
      lastError = new Error(`Upstream ${res.status}`);
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
    }

    if (attempt < attempts) await sleep(300 * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error("Upstream request failed");
}

export async function queryCards(
  q: string,
  pageSize: number,
  revalidate = 3600,
): Promise<RawTcgCard[]> {
  const url = `${API_BASE}?q=${encodeURIComponent(q)}&pageSize=${pageSize}&orderBy=-set.releaseDate`;

  const headers: Record<string, string> = {};
  if (process.env.POKEMONTCG_API_KEY) {
    headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;
  }

  const res = await fetchWithRetry(url, headers, revalidate);
  if (!res.ok) throw new Error(`Upstream ${res.status}`);

  const data = await res.json();
  return data.data ?? [];
}

/**
 * A real, currently-priced card for the landing page hero.
 *
 * Fetching this rather than hardcoding an image URL means the marketing page
 * can never show a card image that 404s, and the price shown is genuine.
 * Returns null on any failure so the page can fall back to static markup.
 */
export async function getFeaturedCard(): Promise<PokemonCard | null> {
  try {
    const raw = await queryCards('name:charizard rarity:"Rare Holo"', 20, 86400);
    const cards = raw.map(mapCard);

    const priced = cards.filter(
      (c) =>
        c.imageLarge &&
        c.prices.some((p) => p.source === "tcgplayer" && (p.market ?? 0) > 20),
    );

    return priced[0] ?? cards.find((c) => c.imageLarge) ?? null;
  } catch {
    return null;
  }
}
