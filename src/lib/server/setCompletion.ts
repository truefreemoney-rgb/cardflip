import "server-only";
import { db } from "@/lib/db";
import { cachedList } from "@/lib/server/listCache";
import { judgeSeries, latestUsdWithTrust, loadTrustData } from "@/lib/server/priceTrustSite";
import { displayNumber, headlinePrice, variantPrices } from "@/lib/cardPages";
import { todayUtc } from "@/lib/priceSeries";
import type { GameId } from "@/lib/types";

/**
 * Set completion (Tier 2 #6, 09-27; every game 10-06): for every set the seller
 * owns a card from, "you own 142 of 198", the missing cards, what filling the
 * gaps costs at today's market, and the cheapest ten to finish.
 *
 * Owned = any card row of that game that is not sold, keyed by catalog_card_id
 * into the game's catalog (en_cards, mtg_cards or tcg_cards; rows without a
 * catalog id — pre-09-01 scans — do not count, the same as the live refresh).
 * A set's size is its catalog row count. Pokémon: every en_cards row (secret
 * rares included). Magic: English rows with a picture. Lorcana / One Piece /
 * Yu-Gi-Oh!: rows with a picture and no '#' variant id, the same rows the
 * public set pages list. Set keys follow lib/server/cardPages.ts: Pokémon
 * set_id, Magic set_code, the tcg games "set_code|set_name" (all indexed).
 * A set's catalog rows are kept in card_cache for a day: one row read instead
 * of hundreds. Prices come from price_series, no external calls. A missing
 * card whose market the price guard flags counts as unpriced: a junk $1,013
 * must not turn "cost to finish" into a fantasy number.
 */

const SET_CAP: Record<GameId, number> = { pokemon: 60, mtg: 30, lorcana: 30, onepiece: 30, yugioh: 30 };
const CAT_TTL_MS = 24 * 60 * 60 * 1000;
export const CHEAPEST = 10;

export interface MissingCard {
  id: string;
  name: string;
  /** Raw catalog number ("123a", "OP01-001"). */
  number: string;
  /** How the number reads on the card: "#3/198", "LTR 187", "OP01-001". */
  label: string;
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
  skey: string;
  sname: string;
}

interface CatRow {
  id: string;
  name: string;
  number: string;
  label: string;
  imageUrl: string;
}

interface SetCatalog {
  releaseDate: string | null;
  printed: number | null;
  rows: CatRow[];
}

const round = (n: number) => Math.round(n * 100) / 100;

const FROM: Record<GameId, string> = {
  pokemon: "JOIN en_cards e ON e.id = c.catalog_card_id",
  mtg: "JOIN mtg_cards e ON e.id = c.catalog_card_id",
  lorcana: "JOIN tcg_cards e ON e.id = c.catalog_card_id AND e.game = c.game",
  onepiece: "JOIN tcg_cards e ON e.id = c.catalog_card_id AND e.game = c.game",
  yugioh: "JOIN tcg_cards e ON e.id = c.catalog_card_id AND e.game = c.game",
};
const SET_COLS: Record<GameId, string> = {
  pokemon: "e.set_id AS skey, e.set_name AS sname",
  mtg: "e.set_code AS skey, e.set_name AS sname",
  lorcana: "e.set_code || '|' || e.set_name AS skey, e.set_name AS sname",
  onepiece: "e.set_code || '|' || e.set_name AS skey, e.set_name AS sname",
  yugioh: "e.set_code || '|' || e.set_name AS skey, e.set_name AS sname",
};

/** Every distinct catalog card the seller holds (unsold) in this game, with its set. */
async function ownedRows(userId: string, game: GameId): Promise<OwnedRow[]> {
  return (await db
    .prepare(
      `SELECT DISTINCT c.catalog_card_id, ${SET_COLS[game]}
         FROM cards c ${FROM[game]}
        WHERE c.user_id = ? AND c.status != 'sold' AND c.game = ?`,
    )
    .all(userId, game)) as unknown as OwnedRow[];
}

/** Printed order: numeric part first ("2" before "10", "123a" after "123"), then the rest as text. */
const byNumber = (a: CatRow, b: CatRow) => a.number.localeCompare(b.number, "en", { numeric: true }) || a.name.localeCompare(b.name);

async function buildCatalog(game: GameId, setKey: string): Promise<SetCatalog> {
  if (game === "pokemon") {
    const rows = (await db
      .prepare(
        `SELECT id, name, local_id, image_url, set_release_date, set_card_count_official
           FROM en_cards WHERE set_id = ?
          ORDER BY CASE WHEN local_id GLOB '[0-9]*' THEN 0 ELSE 1 END, CAST(local_id AS INTEGER), local_id`,
      )
      .all(setKey)) as unknown as { id: string; name: string; local_id: string; image_url: string; set_release_date: string | null; set_card_count_official: number | null }[];
    const printed = rows[0]?.set_card_count_official ?? null;
    return {
      releaseDate: rows[0]?.set_release_date ?? null,
      printed,
      rows: rows.map((r) => ({ id: r.id, name: r.name, number: r.local_id, label: `#${r.local_id}${printed ? `/${printed}` : ""}`, imageUrl: r.image_url })),
    };
  }
  if (game === "mtg") {
    const rows = (await db
      .prepare(
        `SELECT c.id, c.name, c.collector_number, c.set_code, c.image_url, c.set_release_date, s.printed_size
           FROM mtg_cards c LEFT JOIN mtg_sets s ON s.code = c.set_code
          WHERE c.set_code = ? AND c.lang = 'en' AND c.image_url <> ''`,
      )
      .all(setKey)) as unknown as { id: string; name: string; collector_number: string; set_code: string; image_url: string; set_release_date: string | null; printed_size: number | null }[];
    const out = rows.map((r) => ({
      id: r.id,
      name: r.name,
      number: r.collector_number,
      label: displayNumber("mtg", { number: r.collector_number, setCode: r.set_code.toUpperCase() }),
      imageUrl: r.image_url,
    }));
    out.sort(byNumber);
    return { releaseDate: rows[0]?.set_release_date || null, printed: rows[0]?.printed_size ?? null, rows: out };
  }
  // "#<n>" ids are parallel printings of a base card and stay out; "#promo" / "#don" are the
  // only id a promo or DON card has (One Piece promos, 10-08), so those sets were coming up empty.
  const cut = setKey.indexOf("|");
  const rows = (await db
    .prepare(
      `SELECT id, name, subtitle, collector_number, set_code, set_total, image_url, set_release_date
         FROM tcg_cards
        WHERE game = ? AND set_code = ? AND set_name = ? AND image_url <> ''
          AND (id NOT LIKE '%#%' OR id LIKE '%#promo' OR id LIKE '%#don')`,
    )
    .all(game, setKey.slice(0, cut), setKey.slice(cut + 1))) as unknown as { id: string; name: string; subtitle: string; collector_number: string; set_code: string; set_total: number | null; image_url: string; set_release_date: string }[];
  const out = rows.map((r) => ({
    id: r.id,
    name: r.subtitle ? `${r.name} - ${r.subtitle}` : r.name,
    number: r.collector_number,
    label: displayNumber(game, { number: r.collector_number, setTotal: r.set_total, setCode: r.set_code }),
    imageUrl: r.image_url,
  }));
  out.sort(byNumber);
  return { releaseDate: rows[0]?.set_release_date || null, printed: rows[0]?.set_total ?? null, rows: out };
}

/** One set's catalog, from card_cache for a day (an object wrapper: cachedList will not memo a bare empty list). */
async function setCatalog(game: GameId, setKey: string): Promise<SetCatalog> {
  return cachedList(`sets:cat:v2:${game}:${setKey}`, CAT_TTL_MS, () => buildCatalog(game, setKey));
}

/** Today's market per card id, guard applied: a flagged or missing price is absent from the map. */
async function marketPrices(game: GameId, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  if (game === "pokemon") {
    for (const [id, e] of await latestUsdWithTrust(ids)) if (!e.flag) out.set(id, e.price);
    return out;
  }
  const day = todayUtc();
  const trust = await loadTrustData(ids.map((cardId) => ({ cardId, game })), day);
  for (const [id, data] of trust) {
    const head = headlinePrice(variantPrices(game, data.series.map((s) => ({ ...s, flag: judgeSeries(data, { variant: s.variant, exact: true, day }) })), day));
    if (head) out.set(id, head.price);
  }
  return out;
}

const toMissing = (r: CatRow, prices: Map<string, number>): MissingCard => {
  const p = prices.get(r.id);
  return { id: r.id, name: r.name, number: r.number, label: r.label, imageUrl: r.imageUrl, price: p != null && p > 0 ? round(p) : null };
};

/** Every set of this game the seller has a card from, most complete first. */
export async function setCompletion(userId: string, game: GameId = "pokemon"): Promise<SetProgress[]> {
  const owned = await ownedRows(userId, game);
  if (owned.length === 0) return [];

  const bySet = new Map<string, { name: string; ids: Set<string> }>();
  for (const r of owned) {
    const s = bySet.get(r.skey) ?? { name: r.sname, ids: new Set<string>() };
    s.ids.add(r.catalog_card_id);
    bySet.set(r.skey, s);
  }
  // Biggest piles first when the cap bites.
  const sets = [...bySet.entries()].sort((a, b) => b[1].ids.size - a[1].ids.size).slice(0, SET_CAP[game]);

  const out: SetProgress[] = [];
  const missingAll: CatRow[][] = [];
  for (const [setKey, s] of sets) {
    const cat = await setCatalog(game, setKey);
    if (cat.rows.length === 0) continue;
    const missing = cat.rows.filter((r) => !s.ids.has(r.id));
    missingAll.push(missing);
    out.push({
      setId: setKey,
      setName: s.name,
      releaseDate: cat.releaseDate,
      owned: cat.rows.length - missing.length,
      total: cat.rows.length,
      printed: cat.printed,
      pct: Math.round(((cat.rows.length - missing.length) / cat.rows.length) * 1000) / 10,
      missing: missing.length,
      costToFinish: 0,
      unpriced: 0,
      cheapest: [],
    });
  }

  const prices = await marketPrices(game, [...new Set(missingAll.flat().map((m) => m.id))]);
  out.forEach((set, i) => {
    const missing = missingAll[i].map((r) => toMissing(r, prices));
    let cost = 0;
    let unpriced = 0;
    for (const m of missing) {
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
export async function missingInSet(userId: string, setId: string, game: GameId = "pokemon"): Promise<MissingCard[]> {
  const ownedIds = new Set((await ownedRows(userId, game)).filter((r) => r.skey === setId).map((r) => r.catalog_card_id));
  const cat = await setCatalog(game, setId);
  const missing = cat.rows.filter((r) => !ownedIds.has(r.id));
  const prices = await marketPrices(game, missing.map((r) => r.id));
  return missing.map((r) => toMissing(r, prices));
}
