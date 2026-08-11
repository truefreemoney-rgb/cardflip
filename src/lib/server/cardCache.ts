import "server-only";
import { db } from "@/lib/db";
import type { PokemonCard } from "@/lib/types";

/**
 * A local copy of every card lookup that has ever succeeded.
 *
 * pokemontcg.io is the single point of failure for English cards and it is
 * genuinely unreliable — measured at 5 failures in 10 requests during a
 * scanning session, which surfaced to the seller as "Scan failed — try another
 * photo" on a perfectly good photo. Retries alone don't fix a provider that is
 * down half the time.
 *
 * So: serve fresh hits from here without touching the network, and when the
 * upstream is failing, fall back to a stale hit rather than losing the scan.
 * A card's name, set, and number never change; only its prices go stale, which
 * is a far better failure than no card at all.
 */

/** How long a cached lookup is served without re-checking upstream. */
const FRESH_MS = 24 * 60 * 60 * 1000;

interface CacheRow {
  payload: string;
  cached_at: number;
}

export interface CachedLookup {
  cards: PokemonCard[];
  /** True when served past its freshness window because upstream was down. */
  stale: boolean;
}

/**
 * Bump when the shape of a cached PokemonCard changes.
 *
 * Entries are serialized cards, so adding a field leaves old rows structurally
 * stale in a way the freshness window can't detect — after currency was added
 * to CardPrice, production kept serving rows with `currency: undefined` and
 * rendered euros as dollars again. Versioning the key retires them on deploy
 * instead of relying on someone remembering to clear the table.
 */
const CACHE_VERSION = 2;

function keyFor(lang: string, name: string, number: string): string {
  return `v${CACHE_VERSION}|${lang}|${name.toLowerCase().trim()}|${number.trim()}`;
}

/**
 * `allowStale` is the difference between the two call sites: the fast path
 * only wants a fresh hit, the fallback path will take anything it can get.
 */
export function getCachedCards(
  lang: string,
  name: string,
  number: string,
  allowStale: boolean,
): CachedLookup | null {
  const row = db
    .prepare("SELECT payload, cached_at FROM card_cache WHERE key = ?")
    .get(keyFor(lang, name, number)) as unknown as CacheRow | undefined;

  if (!row) return null;

  const stale = Date.now() - row.cached_at > FRESH_MS;
  if (stale && !allowStale) return null;

  try {
    return { cards: JSON.parse(row.payload) as PokemonCard[], stale };
  } catch {
    // Corrupt row — treat as a miss rather than failing the lookup.
    return null;
  }
}

export function putCachedCards(
  lang: string,
  name: string,
  number: string,
  cards: PokemonCard[],
): void {
  // An empty result is a real answer ("no such card"), but caching it would
  // hide the card once the set is added upstream — only store hits.
  if (cards.length === 0) return;

  db.prepare(
    `INSERT INTO card_cache (key, payload, cached_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at`,
  ).run(keyFor(lang, name, number), JSON.stringify(cards), Date.now());
}
