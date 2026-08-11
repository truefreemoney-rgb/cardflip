import "server-only";
import { db } from "@/lib/db";
import { queryCards, mapCard, type RawTcgCard } from "@/lib/tcg";
import type { PokemonCard } from "@/lib/types";

/**
 * English card identification, served from our own mirror of TCGdex.
 *
 * pokemontcg.io is the only English source with prices, and it was measured
 * failing 5 of 10 requests during a scanning session — which surfaced to the
 * seller as a failed scan on a perfectly good photo. Identification is the
 * part that must never fail, so it reads from a local table (see
 * scripts/sync-cards.mjs) and prices are layered on afterwards as best-effort.
 *
 * The mirror also carries set release dates and image URLs, so a scan can rank
 * printings and show thumbnails without a single network call.
 */

interface EnCardRow {
  id: string;
  name: string;
  set_name: string;
  local_id: string;
  set_release_date: string;
  image_url: string;
}

function toCard(row: EnCardRow): PokemonCard {
  return {
    id: row.id,
    name: row.name,
    setName: row.set_name,
    setSeries: "",
    number: row.local_id,
    rarity: null,
    imageSmall: row.image_url,
    imageLarge: row.image_url.replace("/low.webp", "/high.webp"),
    prices: [],
    englishName: null,
  };
}

/** Normalizes "004" and "4" to the same thing for comparison. */
function normalizeNumber(value: string): string {
  return value.replace(/^0+/, "").trim().toLowerCase();
}

/** TCGdex writes "1999-01-09", pokemontcg.io writes "1999/01/09". */
function normalizeDate(value: string | undefined): string {
  return (value ?? "").replace(/\//g, "-").slice(0, 10);
}

/**
 * Find the cards a scan could plausibly be, best first.
 *
 * Ordering runs exact name + number, then exact name, then a name substring.
 * Within a tier the oldest printing wins: collector numbers were assigned by
 * the original set, so an exact number match on a 1999 card is stronger
 * evidence than the same number landing on a later reprint. Anything genuinely
 * ambiguous comes back as several matches, and the scanner puts those in front
 * of the seller with thumbnails rather than silently committing to one.
 */
export interface LocalSearchResult {
  cards: PokemonCard[];
  /** Card id -> set release date, the join key for live pricing. */
  releaseDates: Map<string, string>;
}

export function searchEnglishCardsLocal(
  name: string,
  number: string | null,
  limit = 24,
): LocalSearchResult {
  const needle = name.trim().toLowerCase();
  if (!needle) return { cards: [], releaseDates: new Map() };

  const rows = db
    .prepare(
      `SELECT id, name, set_name, local_id, set_release_date, image_url
         FROM en_cards
        WHERE LOWER(name) = ? OR LOWER(name) LIKE ?
        ORDER BY set_release_date ASC
        LIMIT 400`,
    )
    .all(needle, `%${needle}%`) as unknown as EnCardRow[];

  if (rows.length === 0) return { cards: [], releaseDates: new Map() };

  const wanted = number ? normalizeNumber(number) : null;

  const score = (row: EnCardRow): number => {
    const exactName = row.name.trim().toLowerCase() === needle;
    const exactNumber = Boolean(wanted) && normalizeNumber(row.local_id) === wanted;
    if (exactName && exactNumber) return 0;
    if (exactName) return 1;
    if (exactNumber) return 2;
    return 3;
  };

  const ranked = [...rows].sort((a, b) => score(a) - score(b)).slice(0, limit);

  return {
    cards: ranked.map(toCard),
    releaseDates: new Map(ranked.map((r) => [r.id, r.set_release_date])),
  };
}

/**
 * Attach live TCGplayer/Cardmarket prices to locally-identified cards.
 *
 * Best-effort by design: one upstream call for the whole result set, and if it
 * fails the cards come back priced-less rather than the scan failing. The
 * seller can still see what they have, set a price by hand, or read the eBay
 * comps — all of which beat an error.
 */
export async function enrichWithPricing(
  cards: PokemonCard[],
  releaseDates: Map<string, string>,
): Promise<PokemonCard[]> {
  if (cards.length === 0) return cards;

  try {
    // One query covering every candidate — they all share a name by construction.
    const raw = await queryCards(`name:"${cards[0].name.replace(/"/g, "")}"`, 250);

    // Join on collector number + set release date. Set *names* are not a safe
    // key across providers: TCGdex's "Base Set" prefix-matches upstream's
    // "Base Set 2" as readily as its actual counterpart "Base", which priced a
    // 1999 Charizard at the 2000 reprint's $466 instead of its own $818.
    // Release dates agree exactly between the two sources.
    const byKey = new Map<string, RawTcgCard>();
    for (const card of raw) {
      const key = `${normalizeNumber(card.number)}|${normalizeDate(card.set?.releaseDate)}`;
      if (!byKey.has(key)) byKey.set(key, card);
    }

    return cards.map((card) => {
      const released = normalizeDate(releaseDates.get(card.id));
      if (!released) return card;

      const match = byKey.get(`${normalizeNumber(card.number)}|${released}`);
      if (!match) return card;

      const mapped = mapCard(match);
      return {
        ...card,
        rarity: mapped.rarity ?? card.rarity,
        prices: mapped.prices,
        // Keep our own image: the mirror has one for nearly every card.
        imageSmall: card.imageSmall || mapped.imageSmall,
        imageLarge: card.imageLarge || mapped.imageLarge,
      };
    });
  } catch {
    // Upstream is down. Identification already succeeded, which is the part
    // that matters — pricing can come from eBay comps or the seller.
    return cards;
  }
}

/** Whether the English mirror has been synced (npm run sync:en). */
export function hasEnglishMirror(): boolean {
  try {
    const row = db.prepare("SELECT COUNT(*) c FROM en_cards").get() as unknown as {
      c: number;
    };
    return row.c > 0;
  } catch {
    return false;
  }
}
