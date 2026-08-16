import type { PokemonCard, CardPrice } from "@/lib/types";
import { formatVariantLabel } from "@/lib/listing";

/** Server-side client for the public Pokémon TCG API. */

const API_BASE = "https://api.pokemontcg.io/v2/cards";

export interface RawTcgCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set?: { name?: string; series?: string; releaseDate?: string };
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
      avg1?: number;
      avg7?: number;
      avg30?: number;
      reverseHoloAvg1?: number;
      reverseHoloAvg7?: number;
      reverseHoloAvg30?: number;
    };
  };
}

function extractPrices(card: RawTcgCard): CardPrice[] {
  const prices: CardPrice[] = [];

  for (const [variant, p] of Object.entries(card.tcgplayer?.prices ?? {})) {
    prices.push({
      source: "tcgplayer",
        currency: "USD",
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
      currency: "EUR",
      variant: "average",
      label: "Average (EUR)",
      market: cm.trendPrice ?? cm.averageSellPrice ?? null,
      low: cm.lowPrice ?? null,
      high: null,
      trend: { avg1: cm.avg1 ?? null, avg7: cm.avg7 ?? null, avg30: cm.avg30 ?? null },
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
  timeoutMs: number,
): Promise<Response> {
  // Measured at ~50% failure during an outage, so 3 attempts still left about
  // one lookup in eight failing; 5 takes that to roughly one in thirty, and
  // the cache catches what's left.
  const attempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

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

  // A full 250-card page is ~200KB and takes noticeably longer than a small
  // one; the old flat 6s abort killed those requests before they landed.
  const timeoutMs = pageSize > 50 ? 20000 : 8000;

  const res = await fetchWithRetry(url, headers, revalidate, timeoutMs);
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
/**
 * A shelf of iconic, genuinely-priced cards for the landing page ticker and
 * card wall. Same contract as getFeaturedCard: real cards, real prices,
 * day-long cache, empty array on any failure so the sections just skip.
 */
export async function getShowcaseCards(): Promise<PokemonCard[]> {
  const pokemon = await pokemonShowcase();
  // Magic joins the ticker from its own mirror (prices come with it) —
  // interleaved so the strip reads as one market, not two lists.
  const magic = await mtgShowcaseSafe();
  if (magic.length === 0) return pokemon;
  const mixed: PokemonCard[] = [];
  const max = Math.max(pokemon.length, magic.length);
  for (let i = 0; i < max; i++) {
    if (pokemon[i]) mixed.push(pokemon[i]);
    if (magic[i]) mixed.push(magic[i]);
  }
  return mixed.slice(0, 24);
}

async function pokemonShowcase(): Promise<PokemonCard[]> {
  try {
    const raw = await queryCards(
      "(name:charizard OR name:pikachu OR name:mewtwo OR name:gengar OR name:umbreon OR name:blastoise OR name:gyarados OR name:dragonite OR name:rayquaza OR name:eevee)",
      60,
      86400,
    );
    const priced = raw
      .map(mapCard)
      .filter(
        (c) =>
          c.imageSmall &&
          c.prices.some((p) => p.source === "tcgplayer" && (p.market ?? 0) > 5),
      )
      .sort((a, b) => {
        const price = (c: PokemonCard) =>
          Math.max(
            ...c.prices
              .filter((p) => p.source === "tcgplayer")
              .map((p) => p.market ?? 0),
          );
        return price(b) - price(a);
      })
      .slice(0, 18);
    if (priced.length >= 6) return priced;
    return await showcaseFromMirror();
  } catch {
    return showcaseFromMirror();
  }
}

/** Iconic Magic cards from the Scryfall mirror; empty until `npm run sync:mtg` has run. */
async function mtgShowcaseSafe(): Promise<PokemonCard[]> {
  try {
    const { hasMtgMirror, mtgShowcase } = await import("@/lib/server/mtgCards");
    if (!hasMtgMirror()) return [];
    return mtgShowcase(9);
  } catch {
    return [];
  }
}

/**
 * Priceless fallback for when pokemontcg.io is down (it fails ~half its
 * requests): iconic cards straight from the local mirror. Real cards, real
 * art, no prices — the ticker hides the price and softens its caption
 * rather than vanishing. Dynamic import keeps the SQLite dependency out of
 * any non-server bundle that touches this module.
 */
async function showcaseFromMirror(): Promise<PokemonCard[]> {
  try {
    const { hasEnglishMirror, searchEnglishCardsLocal } = await import(
      "@/lib/server/enCards"
    );
    if (!hasEnglishMirror()) return [];
    const icons = [
      "Charizard",
      "Pikachu",
      "Mewtwo",
      "Gengar",
      "Umbreon",
      "Blastoise",
      "Gyarados",
      "Dragonite",
      "Rayquaza",
    ];
    return icons
      .flatMap((name) => searchEnglishCardsLocal(name, null, 2).cards)
      .filter((c) => c.imageSmall)
      .slice(0, 18);
  } catch {
    return [];
  }
}

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
