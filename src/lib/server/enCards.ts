import "server-only";
import { db } from "@/lib/db";
import { queryCards, mapCard, type RawTcgCard } from "@/lib/tcg";
import {
  agreesWithSetCode,
  agreesWithSetTotal,
  isSecretRareNumber,
  normalizeDate,
  normalizeNumber,
  type PrintedNumber,
} from "@/lib/cardNumber";
import type { ArtStyle, PokemonCard } from "@/lib/types";

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
  set_card_count_official: number | null;
  set_code: string;
}

/** Every column the ranking needs, in one place — the two queries share it. */
const CARD_COLUMNS = `id, name, set_name, local_id, set_release_date, image_url,
                      set_card_count_official, set_code`;

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
    setTotal: row.set_card_count_official,
    setCode: row.set_code || null,
    isSecretRare: isSecretRareNumber(row.local_id, row.set_card_count_official),
  };
}

export interface LocalSearchResult {
  cards: PokemonCard[];
  /** Card id -> set release date, the join key for live pricing. */
  releaseDates: Map<string, string>;
}

/**
 * How much a candidate loses for disagreeing with the fraction that was read.
 *
 * Three-valued on purpose. "We never read a set total" and "this card's set
 * total contradicts the one we read" are different, and only the second should
 * cost anything — a mirror synced before set totals existed returns null for
 * every card, and a scan must still work against it.
 *
 * All three scales stay below NAME_TIER (their worst case sums to 7) so the set
 * total can only reorder cards *within* a name/number tier, never lift a
 * substring match above an exact one. The denominator is the most misread
 * glyph run on the card; it earns a tiebreak, not a veto.
 *
 * ART_PENALTY is the last tiebreak: when the number couldn't be read at all,
 * every printing of the name ties and "oldest first" picked the SVP promo for
 * a full-art Sprigatito (08-16, Chris's phone). The mirror has no rarity
 * column, but a numerator above the set total *is* the full-art / secret tier
 * in the modern game, so vision's frame read ("standard" | "full-art") is
 * checked against isSecretRareNumber. Promos print no denominator and count
 * as standard-numbered.
 */
const TOTAL_PENALTY = { match: 0, unknown: 2, mismatch: 4 } as const;
const CODE_PENALTY = { match: 0, unknown: 1, mismatch: 2 } as const;
const ART_PENALTY = { match: 0, unknown: 0, mismatch: 1 } as const;
const NAME_TIER = 8;

function agreesWithArt(art: ArtStyle, secretNumbered: boolean): keyof typeof ART_PENALTY {
  if (!art) return "unknown";
  return (art === "full-art") === secretNumbered ? "match" : "mismatch";
}

/**
 * Find the cards a scan could plausibly be, best first.
 *
 * The primary ordering is unchanged — exact name + number, then exact name,
 * then a name substring — because a name is the one field OCR gets right most
 * often. What the set total adds is the tiebreak *inside* the top tier, which
 * is exactly where the expensive mistakes were happening: "Charizard #4" is
 * two different cards, Base Set (1999) and Base Set 2 (2000), and the mirror
 * holds 1,306 such name+number collisions covering 2,890 cards. Ranking by
 * release date alone guessed; the printed denominator knows, because Base Set
 * prints 4/102 and Base Set 2 prints 4/130.
 *
 * Anything still genuinely ambiguous comes back as several matches, and the
 * scanner puts those in front of the seller with thumbnails rather than
 * silently committing to one.
 */
/** Exact catalog-id fetch — the fast path for reopening a card a ledger or
 * wishlist row already identified. Skips the name walk entirely. */
export async function englishCardById(id: string): Promise<LocalSearchResult> {
  const row = (await db
    .prepare(`SELECT ${CARD_COLUMNS} FROM en_cards WHERE id = ?`)
    .get(id)) as EnCardRow | undefined;
  if (!row) return { cards: [], releaseDates: new Map() };
  return { cards: [toCard(row)], releaseDates: new Map([[row.id, row.set_release_date]]) };
}

/**
 * Hyphens read as spaces on both sides of the match. TCGdex names Shiny Vault
 * and promo cards "Charizard-GX" while the card itself (and vision's read)
 * says "Charizard GX" — 170 mirror rows carry the suffix hyphen, and without
 * this they can never be found by name (09-02: a Hidden Fates SV49 slab
 * matched to the Burning Shadows rainbow because the real row was invisible).
 * Genuinely hyphenated names (Ho-Oh, Porygon-Z) normalize identically on both
 * sides, so they keep matching too.
 */
/** The SQL twin of normalizeName — the mirror stores BOTH apostrophe forms
 * (962 straight, 63 curly on 09-02), so the column folds too. */
const FOLDED_NAME = "REPLACE(REPLACE(REPLACE(LOWER(name), '-', ' '), '’', ''''), '‘', '''')";

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    // Curly/typographic apostrophes and quotes fold to the straight ones the
    // mirror stores — vision writes "Team Rocket’s Zapdos" (U+2019), TCGdex
    // has "Team Rocket's Zapdos", and the whole Destined Rivals set missed
    // the mirror on Chris's 09-02 stress test (then 400'd upstream).
    .replace(/[‘’‛′`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}

export async function searchEnglishCardsLocal(
  name: string,
  printed: PrintedNumber | null,
  limit = 24,
  art: ArtStyle = null,
): Promise<LocalSearchResult> {
  const needle = normalizeName(name);

  // No usable name, but a full fraction is itself an identification — resolve
  // on the numbers alone rather than giving up.
  if (!needle) {
    return printed?.setTotal
      ? lookupByPrintedNumber(printed, limit)
      : { cards: [], releaseDates: new Map() };
  }

  const rows = (await db
    .prepare(
      `SELECT ${CARD_COLUMNS}
         FROM en_cards
        WHERE ${FOLDED_NAME} = ? OR ${FOLDED_NAME} LIKE ?
        ORDER BY set_release_date ASC
        LIMIT 400`,
    )
    .all(needle, `%${needle}%`)) as unknown as EnCardRow[];

  // The name was misread badly enough to match nothing. The fraction doesn't
  // depend on having read the name, so it can still identify the card.
  if (rows.length === 0) {
    return printed?.setTotal
      ? lookupByPrintedNumber(printed, limit)
      : { cards: [], releaseDates: new Map() };
  }

  const wanted = printed ? normalizeNumber(printed.number) : null;

  const score = (row: EnCardRow): number => {
    const exactName = normalizeName(row.name) === needle;
    const exactNumber = Boolean(wanted) && normalizeNumber(row.local_id) === wanted;

    let tier: number;
    if (exactName && exactNumber) tier = 0;
    else if (exactName) tier = 1;
    else if (exactNumber) tier = 2;
    else tier = 3;

    const total = agreesWithSetTotal(
      printed?.setTotal ?? null,
      row.set_card_count_official,
    );
    const code = agreesWithSetCode(printed?.setCode ?? null, row.set_code || null);
    const frame = agreesWithArt(art, isSecretRareNumber(row.local_id, row.set_card_count_official));

    return tier * NAME_TIER + TOTAL_PENALTY[total] + CODE_PENALTY[code] + ART_PENALTY[frame];
  };

  // Stable sort, so release-date order from the query survives as the final
  // tiebreak — the oldest printing still wins a tie the fraction can't settle.
  const ranked = [...rows].sort((a, b) => score(a) - score(b)).slice(0, limit);

  return {
    cards: ranked.map(toCard),
    releaseDates: new Map(ranked.map((r) => [r.id, r.set_release_date])),
  };
}

/**
 * Identify a card from its printed fraction alone — "25/102" with no readable
 * name.
 *
 * This is the case a name-keyed lookup simply cannot serve: glare across the
 * name band, a foil that washes out the top of the card, a language the OCR
 * model doesn't have. The numerator and denominator sit in a different band
 * and survive independently, and together they're close to unique — the
 * denominator picks the expansion, the numerator picks the card out of it.
 *
 * A bare numerator is not enough to run this: "25" alone matches one card in
 * nearly every set ever printed.
 */
export async function lookupByPrintedNumber(
  printed: PrintedNumber,
  limit = 24,
): Promise<LocalSearchResult> {
  if (!printed.setTotal) return { cards: [], releaseDates: new Map() };

  // Bounded by the size of the sets sharing this denominator — a few hundred
  // rows at worst — so the numerator is matched in JS, where "004" and "4"
  // normalize the same way they do everywhere else.
  const rows = (
    (await db
      .prepare(
        `SELECT ${CARD_COLUMNS}
           FROM en_cards
          WHERE set_card_count_official = ?
          ORDER BY set_release_date ASC`,
      )
      .all(printed.setTotal)) as unknown as EnCardRow[]
  ).filter((row) => normalizeNumber(row.local_id) === normalizeNumber(printed.number));

  const ranked = printed.setCode
    ? [...rows].sort(
        (a, b) =>
          CODE_PENALTY[agreesWithSetCode(printed.setCode, a.set_code || null)] -
          CODE_PENALTY[agreesWithSetCode(printed.setCode, b.set_code || null)],
      )
    : rows;

  const limited = ranked.slice(0, limit);

  return {
    cards: limited.map(toCard),
    releaseDates: new Map(limited.map((r) => [r.id, r.set_release_date])),
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
export async function hasEnglishMirror(): Promise<boolean> {
  try {
    const row = (await db.prepare("SELECT COUNT(*) c FROM en_cards").get()) as unknown as {
      c: number;
    };
    return row.c > 0;
  } catch {
    return false;
  }
}
