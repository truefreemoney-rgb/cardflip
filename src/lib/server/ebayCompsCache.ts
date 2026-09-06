import "server-only";
import { db } from "@/lib/db";
import type { EbayComps, PokemonCard } from "@/lib/types";

/**
 * One Browse call per card per day. The eBay keyset is capped at 5,000
 * Browse calls/day (raise requested 09-06) and repeat scans of the same
 * card (the seller re-checking, a second copy, the editor reopening)
 * were each spending a call for an answer that barely moves within a day.
 *
 * Rides the card_cache table under its own key prefix so there is no new
 * DDL (no dev-server restart, nothing to initialise on prod). Both a hit
 * and an honest "nothing comparable" (null) are cached; errors are not.
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const PREFIX = "ebaycomps:v1:";

export type Grading = { company: string; grade: string } | null | undefined;

export function compsCacheKey(card: PokemonCard, grading: Grading, firstEdition: boolean | null | undefined): string {
  const id = card.id || `${card.name}|${card.setName ?? ""}|${card.number ?? ""}`;
  const g = grading ? `${grading.company}-${grading.grade}`.toLowerCase() : "raw";
  const fe = firstEdition === true ? "1st" : firstEdition === false ? "unl" : "any";
  return `${PREFIX}${id}:${g}:${fe}`;
}

interface Row {
  payload: string;
  cached_at: number;
}

export async function getCachedComps(
  key: string,
  now = Date.now(),
): Promise<{ comps: EbayComps | null; cachedAt: number } | undefined> {
  const row = (await db.prepare("SELECT payload, cached_at FROM card_cache WHERE key = ?").get(key)) as unknown as
    | Row
    | undefined;
  if (!row || now - row.cached_at > TTL_MS) return undefined;
  try {
    return { comps: JSON.parse(row.payload) as EbayComps | null, cachedAt: row.cached_at };
  } catch {
    return undefined;
  }
}

export async function putCachedComps(key: string, comps: EbayComps | null, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO card_cache (key, payload, cached_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at`,
    )
    .run(key, JSON.stringify(comps), now);
}

/** Serve today's answer if we have one, else fetch, store, and return it. */
export async function cachedEbayComps(
  card: PokemonCard,
  grading: Grading,
  firstEdition: boolean | null | undefined,
  fetcher: () => Promise<EbayComps | null>,
): Promise<{ comps: EbayComps | null; cached: boolean }> {
  const key = compsCacheKey(card, grading, firstEdition);
  const hit = await getCachedComps(key).catch(() => undefined);
  if (hit) return { comps: hit.comps, cached: true };
  const comps = await fetcher();
  // A cache write failing must never cost the seller the answer.
  await putCachedComps(key, comps).catch((err) => console.error("ebay comps cache write failed:", err));
  return { comps, cached: false };
}
