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

function toRef(r: JpCardRow): JpCardRef {
  return { id: r.id, name: r.name, setName: r.set_name, localId: r.local_id };
}

function levenshtein(a: string, b: string): number {
  const dp: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let prevDiag = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prevDiag
          : 1 + Math.min(prevDiag, dp[j], dp[j - 1]);
      prevDiag = temp;
    }
  }
  return dp[b.length];
}

// Reused across requests in the same server process — 8k+ short strings is
// cheap to hold in memory and avoids re-querying SQLite for every fuzzy scan.
let allNamesCache: JpCardRow[] | null = null;

function getAllNames(): JpCardRow[] {
  allNamesCache ??= db
    .prepare("SELECT id, name, set_id, set_name, local_id FROM jp_cards")
    .all() as unknown as JpCardRow[];
  return allNamesCache;
}

/**
 * Client-side Japanese OCR is meaningfully less accurate than English —
 * Tesseract's jpn model routinely swaps or drops individual kana (confirmed
 * directly: clean, large synthetic text for "ピカチュウ" came back as
 * "ピカ チュ ワウ") — so an exact-substring match on the OCR'd text misses
 * constantly. This ranks every card name by edit distance and accepts
 * anything close enough that a couple of misread characters won't matter.
 */
function fuzzySearch(name: string, limit: number): JpCardRef[] {
  const maxDistance = Math.max(1, Math.floor(name.length / 2));

  const scored = getAllNames()
    .map((row) => ({ row, distance: levenshtein(name, row.name) }))
    .filter((s) => s.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);

  return scored.slice(0, limit).map((s) => toRef(s.row));
}

/**
 * TCGdex's own name-search doesn't work for the "ja" locale (confirmed
 * directly — an exact, verbatim name still returns []), so matches come from
 * our local mirror (see scripts/sync-jp-cards.mjs) instead of a live call.
 */
export function searchJpCardsLocal(name: string, number?: string | null): JpCardRef[] {
  const needle = `%${name}%`;

  const exact = number
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
  if (number && exact.length === 0) {
    return searchJpCardsLocal(name, null);
  }

  if (exact.length > 0) return exact.map(toRef);

  return fuzzySearch(name, 8);
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
