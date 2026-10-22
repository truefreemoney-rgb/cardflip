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
// v2 (10-22): the printing joined the key; a pattern card and its plain twin no longer share a day's answer.
const PREFIX = "ebaycomps:v2:";

export type Grading = { company: string; grade: string } | null | undefined;

/**
 * The card the comps are searched AND cached as (10-16 audit). The body's id
 * and name are both client-supplied: a real id with a made-up name cached the
 * made-up card's comps under the real card's key for a day, for every seller,
 * and seeded its graded history. A catalog card's identity comes from the
 * catalog; a card the catalog doesn't know is keyed by its own name|set|number.
 */
export function compsIdentity(
  client: PokemonCard,
  catalog: PokemonCard | null | undefined,
): { card: PokemonCard; verified: boolean } {
  if (!catalog) return { card: { ...client, id: "" }, verified: false };
  return {
    card: {
      ...client,
      id: catalog.id,
      name: catalog.name,
      englishName: catalog.englishName ?? null,
      setName: catalog.setName,
      number: catalog.number,
      setCode: catalog.setCode ?? null,
      setTotal: catalog.setTotal ?? null,
      game: catalog.game,
    },
    verified: true,
  };
}

export function compsCacheKey(
  card: PokemonCard,
  grading: Grading,
  firstEdition: boolean | null | undefined,
  /** The printing being priced; null/undefined = any printing. */
  variant?: string | null,
): string {
  const id = card.id || `${card.name}|${card.setName ?? ""}|${card.number ?? ""}`;
  const g = grading ? `${grading.company}-${grading.grade}`.toLowerCase() : "raw";
  const fe = firstEdition === true ? "1st" : firstEdition === false ? "unl" : "any";
  return `${PREFIX}${id}:${g}:${fe}:${variant || "any"}`;
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
  variant?: string | null,
): Promise<{ comps: EbayComps | null; cached: boolean }> {
  const key = compsCacheKey(card, grading, firstEdition, variant);
  const hit = await getCachedComps(key).catch(() => undefined);
  if (hit) return { comps: hit.comps, cached: true };
  const comps = await fetcher();
  // A cache write failing must never cost the seller the answer.
  await putCachedComps(key, comps).catch((err) => console.error("ebay comps cache write failed:", err));
  return { comps, cached: false };
}
