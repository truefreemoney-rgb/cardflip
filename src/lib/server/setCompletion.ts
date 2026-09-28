import "server-only";
import { db } from "@/lib/db";
import { latestUsdPrices } from "@/lib/server/priceHistory";

/**
 * Set completion (Tier 2 #6, 09-27): for every Pokémon set the seller owns
 * a card from, "you own 142 of 198", the missing cards, what filling the
 * gaps costs at today's market, and the cheapest ten to finish.
 *
 * Owned = any card row that is not sold, keyed by catalog_card_id into
 * en_cards (rows without a catalog id — pre-09-01 scans — do not count, the
 * same as the live refresh). A set's size is its row count in the mirror,
 * secret rares included; set_card_count_official rides along as "printed".
 * Prices come from price_series (latestUsdPrices), no external calls.
 * Pokémon only for now: Magic is still admin-only.
 */

const SET_CAP = 60;
export const CHEAPEST = 10;

export interface MissingCard {
  id: string;
  name: string;
  number: string;
  imageUrl: string;
  price: number | null;
}

export interface SetProgress {
  setId: string;
  setName: string;
  releaseDate: string | null;
  owned: number;
  total: number;
  printed: number | null;
  pct: number;
  missing: number;
  /** Sum of today's market price over the priced missing cards. */
  costToFinish: number;
  unpriced: number;
  cheapest: MissingCard[];
}

interface OwnedRow {
  catalog_card_id: string;
  set_id: string;
  set_name: string;
}

interface CatalogRow {
  id: string;
  name: string;
  local_id: string;
  image_url: string;
  set_release_date: string | null;
  set_card_count_official: number | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

async function setRows(setId: string): Promise<CatalogRow[]> {
  return (await db
    .prepare(
      `SELECT id, name, local_id, image_url, set_release_date, set_card_count_official
         FROM en_cards WHERE set_id = ?
        ORDER BY CASE WHEN local_id GLOB '[0-9]*' THEN 0 ELSE 1 END, CAST(local_id AS INTEGER), local_id`,
    )
    .all(setId)) as unknown as CatalogRow[];
}

/** Every set the seller has a card from, most complete first. */
export async function setCompletion(userId: string): Promise<SetProgress[]> {
  const owned = (await db
    .prepare(
      `SELECT DISTINCT c.catalog_card_id, e.set_id, e.set_name
         FROM cards c JOIN en_cards e ON e.id = c.catalog_card_id
        WHERE c.user_id = ? AND c.status != 'sold' AND c.game = 'pokemon'`,
    )
    .all(userId)) as unknown as OwnedRow[];
  if (owned.length === 0) return [];

  const bySet = new Map<string, { name: string; ids: Set<string> }>();
  for (const r of owned) {
    const s = bySet.get(r.set_id) ?? { name: r.set_name, ids: new Set<string>() };
    s.ids.add(r.catalog_card_id);
    bySet.set(r.set_id, s);
  }
  // Biggest piles first when the cap bites.
  const sets = [...bySet.entries()].sort((a, b) => b[1].ids.size - a[1].ids.size).slice(0, SET_CAP);

  const out: SetProgress[] = [];
  const missingAll: MissingCard[][] = [];
  for (const [setId, s] of sets) {
    const rows = await setRows(setId);
    if (rows.length === 0) continue;
    const missing = rows.filter((r) => !s.ids.has(r.id)).map((r) => ({ id: r.id, name: r.name, number: r.local_id, imageUrl: r.image_url, price: null as number | null }));
    missingAll.push(missing);
    out.push({
      setId,
      setName: s.name,
      releaseDate: rows[0].set_release_date ?? null,
      owned: rows.length - missing.length,
      total: rows.length,
      printed: rows[0].set_card_count_official ?? null,
      pct: Math.round(((rows.length - missing.length) / rows.length) * 1000) / 10,
      missing: missing.length,
      costToFinish: 0,
      unpriced: 0,
      cheapest: [],
    });
  }

  const prices = await latestUsdPrices([...new Set(missingAll.flat().map((m) => m.id))]);
  out.forEach((set, i) => {
    const missing = missingAll[i];
    let cost = 0;
    let unpriced = 0;
    for (const m of missing) {
      const p = prices.get(m.id)?.price ?? null;
      m.price = p != null && p > 0 ? round(p) : null;
      if (m.price == null) unpriced++;
      else cost += m.price;
    }
    set.costToFinish = round(cost);
    set.unpriced = unpriced;
    set.cheapest = missing.filter((m) => m.price != null).sort((a, b) => a.price! - b.price!).slice(0, CHEAPEST);
  });
  return out.sort((a, b) => b.pct - a.pct || b.owned - a.owned || a.setName.localeCompare(b.setName));
}

/** The full missing list for one set, in printed order, priced. */
export async function missingInSet(userId: string, setId: string): Promise<MissingCard[]> {
  const ownedIds = new Set(
    ((await db
      .prepare(
        `SELECT DISTINCT c.catalog_card_id FROM cards c JOIN en_cards e ON e.id = c.catalog_card_id
          WHERE c.user_id = ? AND c.status != 'sold' AND e.set_id = ?`,
      )
      .all(userId, setId)) as unknown as { catalog_card_id: string }[]).map((r) => r.catalog_card_id),
  );
  const rows = await setRows(setId);
  const missing = rows.filter((r) => !ownedIds.has(r.id));
  const prices = await latestUsdPrices(missing.map((r) => r.id));
  return missing.map((r) => {
    const p = prices.get(r.id)?.price ?? null;
    return { id: r.id, name: r.name, number: r.local_id, imageUrl: r.image_url, price: p != null && p > 0 ? round(p) : null };
  });
}
