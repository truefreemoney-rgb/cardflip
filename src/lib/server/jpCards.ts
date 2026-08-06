import "server-only";
import { db } from "@/lib/db";
import type { CardPrice, PokemonCard } from "@/lib/types";

const TCGDEX_JA = "https://api.tcgdex.net/v2/ja";

interface JpCardRow {
  id: string;
  name: string;
  set_id: string;
  set_name: string;
  local_id: string;
}

export interface JpCardRef {
  id: string;
  name: string;
  setName: string;
  localId: string;
}

/**
 * TCGdex's own name-search doesn't work for the "ja" locale (confirmed
 * directly — an exact, verbatim name still returns []), so matches come from
 * our local mirror (see scripts/sync-jp-cards.mjs) instead of a live call.
 */
export function searchJpCardsLocal(name: string, number?: string | null): JpCardRef[] {
  const needle = `%${name}%`;

  const rows = number
    ? (db
        .prepare(
          "SELECT id, name, set_id, set_name, local_id FROM jp_cards WHERE name LIKE ? AND local_id = ? LIMIT 12",
        )
        .all(needle, number.padStart(3, "0")) as unknown as JpCardRow[])
    : (db
        .prepare(
          "SELECT id, name, set_id, set_name, local_id FROM jp_cards WHERE name LIKE ? LIMIT 12",
        )
        .all(needle) as unknown as JpCardRow[]);

  // A number filter that matches nothing (misread by OCR) shouldn't hide an
  // otherwise-good name match — fall back to name-only rather than empty.
  if (number && rows.length === 0) {
    return searchJpCardsLocal(name, null);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    setName: r.set_name,
    localId: r.local_id,
  }));
}

interface TcgdexPriceBlock {
  cardmarket?: { avg?: number | null; trend?: number | null; low?: number | null } | null;
}

interface TcgdexCardDetail {
  id: string;
  name: string;
  localId: string;
  rarity?: string;
  set?: { name?: string };
  pricing?: TcgdexPriceBlock;
}

function mapJpPricing(pricing?: TcgdexPriceBlock): CardPrice[] {
  const cm = pricing?.cardmarket;
  if (!cm) return [];

  const market = cm.trend ?? cm.avg ?? null;
  if (market === null) return [];

  return [
    {
      source: "cardmarket",
      variant: "average",
      // Cardmarket is a EU marketplace; this is cross-market pricing for a
      // Japanese card, not a Japanese-market price — labeled so it isn't
      // mistaken for one.
      label: "Average (EUR, cross-market)",
      market,
      low: cm.low ?? null,
      high: null,
    },
  ];
}

/**
 * The local index only has name/set/number (that's all the per-set listing
 * endpoint returns) — rarity and pricing require one extra call per card, so
 * this is only called for the handful of candidates a user is actually
 * looking at, never for the whole search result set.
 */
export async function fetchJpCardDetail(id: string): Promise<PokemonCard | null> {
  try {
    const res = await fetch(`${TCGDEX_JA}/cards/${id}`);
    if (!res.ok) return null;
    const card: TcgdexCardDetail = await res.json();

    return {
      id: card.id,
      name: card.name,
      setName: card.set?.name ?? "Unknown set",
      setSeries: "",
      number: card.localId,
      rarity: card.rarity ?? null,
      // TCGdex has no image data at all for the "ja" locale (confirmed
      // directly — the field is simply absent from the response).
      imageSmall: "",
      imageLarge: "",
      prices: mapJpPricing(card.pricing),
    };
  } catch {
    return null;
  }
}
