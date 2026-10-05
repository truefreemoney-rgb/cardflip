import { db } from "@/lib/db";
import { decodePrices, encodePrices, setDay, todayUtc } from "@/lib/priceSeries";
import { readSeriesMap, upsertSeriesRows, type SeriesUpsert } from "@/lib/server/priceBulkWrite";
import {
  mapProductsToCards,
  matchGroupsToSets,
  tcgplayerProductPattern,
  tcgplayerVariantKey,
  type MirrorCard,
  type MirrorSet,
  type PatternVariant,
  type TcgGroup,
  type TcgProduct,
} from "@/lib/tcgcsv";
import { readSealedMap, sealedSeriesUpserts } from "@/lib/server/sealedPrices";

/**
 * Daily Pokémon price points from TCGCSV (tcgcsv.com — TCGplayer's prices,
 * republished daily as plain JSON per set). Uses the productId → card map
 * that scripts/backfill-tcgcsv.mjs built (`tcgplayer_products`, shipped in
 * the seed), so every mapped card gets today's point in one pass of ~150
 * small requests — no pokemontcg.io involved, which fails half its calls.
 * Same compact price_series rows and 5¢ rule as everything else.
 */

const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip-superior.fly.dev)" };
const MIN_TRACKED_USD = 0.05;
const PAUSE_MS = 80;

// Schema (tcgplayer_products) lives in lib/db.ts behind the adapter's schema gate.

export interface PokemonRefreshResult {
  groups: number;
  groupsFailed: number;
  seriesTouched: number;
  /** Sealed product series written this run (lib/server/sealedPrices.ts). */
  sealedSeries: number;
  day: string;
}

export async function hasTcgplayerMap(): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM tcgplayer_products LIMIT 1").get();
  return Boolean(row);
}

/**
 * New sets map themselves (10-05): the productId → card map was only ever
 * built by scripts/backfill-tcgcsv.mjs run by hand, so the 30th Celebration
 * sets (and the 2021 Classic Collection) sat priceless. Each run maps up to
 * `max` TCGplayer groups that match a mirror set with no mapped card yet.
 * Best-effort: a failure here never stops the price run.
 */
export async function mapNewPokemonGroups(max = 8): Promise<{ groups: number; products: number }> {
  const res = await fetch("https://tcgcsv.com/tcgplayer/3/groups", { headers: HEADERS });
  if (!res.ok) throw new Error(`groups HTTP ${res.status}`);
  const groups = ((await res.json()) as { results?: TcgGroup[] }).results ?? [];
  const sets = (await db
    .prepare("SELECT set_name AS name, MAX(set_code) AS code, MIN(set_release_date) AS released FROM en_cards GROUP BY set_name")
    .all()) as MirrorSet[];
  const mappedGroups = new Set(
    ((await db.prepare("SELECT DISTINCT group_id FROM tcgplayer_products WHERE game = 'pokemon'").all()) as { group_id: number }[]).map((r) => r.group_id),
  );
  const mappedSets = new Set(
    ((await db
      .prepare("SELECT DISTINCT e.set_name FROM tcgplayer_products t JOIN en_cards e ON e.id = t.card_id WHERE t.game = 'pokemon'")
      .all()) as { set_name: string }[]).map((r) => r.set_name),
  );
  const todo = [...matchGroupsToSets(groups, sets)].filter(([gid, set]) => !mappedGroups.has(gid) && !mappedSets.has(set)).slice(0, max);
  let products = 0;
  for (const [gid, setName] of todo) {
    const pres = await fetch(`https://tcgcsv.com/tcgplayer/3/${gid}/products`, { headers: HEADERS });
    if (!pres.ok) continue;
    const list = ((await pres.json()) as { results?: TcgProduct[] }).results ?? [];
    const cards = (await db.prepare("SELECT id, local_id AS number, name FROM en_cards WHERE set_name = ?").all(setName)) as MirrorCard[];
    const map = [...mapProductsToCards(list, cards)];
    if (map.length) {
      await db
        .prepare(`INSERT OR IGNORE INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES ${map.map(() => "(?, ?, ?, 'pokemon')").join(", ")}`)
        .run(...map.flatMap(([pid, cardId]) => [pid, gid, cardId]));
    }
    console.log(`tcgcsv map: group ${gid} → ${setName}: ${map.length} of ${list.length} products`);
    products += map.length;
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  return { groups: todo.length, products };
}

export async function refreshPokemonPricesFromTcgcsv(day = todayUtc()): Promise<PokemonRefreshResult> {
  try {
    await mapNewPokemonGroups();
  } catch (err) {
    console.warn("tcgcsv map new groups:", err instanceof Error ? err.message : err);
  }
  const groups = ((await db.prepare("SELECT DISTINCT group_id FROM tcgplayer_products WHERE game = 'pokemon'").all()) as { group_id: number }[])
    .map((r) => r.group_id);
  const productToCard = new Map<number, string>();
  // Groups where two products map to one card: a Poké Ball / Master Ball
  // pattern product beside the base one. Only those groups need the product
  // list fetched (names carry the pattern) — the map itself has no names.
  const cardProducts = new Map<string, number>();
  const patternGroups = new Set<number>();
  // The sync driver streamed this with .iterate(); the map is ~30k small rows,
  // well within memory as one read.
  for (const r of (await db.prepare("SELECT product_id, group_id, card_id FROM tcgplayer_products WHERE game = 'pokemon'").all()) as { product_id: number; group_id: number; card_id: string }[]) {
    productToCard.set(r.product_id, r.card_id);
    const n = (cardProducts.get(r.card_id) ?? 0) + 1;
    cardProducts.set(r.card_id, n);
    if (n > 1) patternGroups.add(r.group_id);
  }
  // One bulk read of the whole family, all diffs computed in memory, one
  // batched write-back at the end — per-row SELECT+UPSERT was ~60k Turso
  // round trips and timed out Vercel's function limit (08-26).
  const existingSeries = await readSeriesMap("pokemon", "tcgplayer");
  // 1st Edition twins (scripts/sync-first-edition.mjs): the stamped printing
  // is its own catalog card, so a product's 1st Edition variants are written
  // under the twin's id; a twin mapped straight to a TCGplayer product (Base
  // Set Shadowless) ignores that product's unlimited variants.
  const twins = new Set(
    ((await db.prepare("SELECT id FROM en_cards WHERE id LIKE '%-1st'").all()) as { id: string }[]).map((r) => r.id),
  );

  // Sealed product (booster boxes, ETBs, tins): the same /prices response
  // carries them; their points are collected here and written after the
  // loop under the sealed catalog ids (Tier 2 #13).
  const sealedMap = await readSealedMap("pokemon");
  const sealedPrices = new Map<number, number>();

  let groupsFailed = 0;
  const upserts: SeriesUpsert[] = [];
  const touched = new Set<string>();
  // Cards with a pattern product: every variant seen for them this run, so
  // the mislabelled "holofoil" rows earlier runs wrote can be dropped.
  const patternCardVariants = new Map<string, Set<string>>();
  for (const gid of groups) {
    let results: { productId: number; marketPrice?: number | null; subTypeName?: string | null }[];
    const patternOf = new Map<number, PatternVariant>();
    try {
      if (patternGroups.has(gid)) {
        const pres = await fetch(`https://tcgcsv.com/tcgplayer/3/${gid}/products`, { headers: HEADERS });
        if (!pres.ok) throw new Error(`products HTTP ${pres.status}`);
        const products = ((await pres.json()) as { results?: { productId: number; name?: string }[] }).results ?? [];
        for (const p of products) {
          const pattern = tcgplayerProductPattern(p.name);
          if (pattern) patternOf.set(p.productId, pattern);
        }
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
      const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${gid}/prices`, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      results = ((await res.json()) as { results?: typeof results }).results ?? [];
    } catch (err) {
      groupsFailed++;
      console.warn(`tcgcsv group ${gid}:`, err instanceof Error ? err.message : err);
      continue;
    }
    for (const r of results) {
      const mapped = productToCard.get(r.productId);
      const price = r.marketPrice ?? null;
      if (!mapped && price != null && price > 0 && sealedMap.has(r.productId) && !sealedPrices.has(r.productId)) {
        sealedPrices.set(r.productId, price);
        continue;
      }
      if (!mapped || price == null || !(price > 0)) continue;
      // A pattern product's price is the pattern variant whatever subtype
      // TCGplayer files it under ("Holofoil").
      const variant = patternOf.get(r.productId) ?? tcgplayerVariantKey(r.subTypeName);
      const stamped = variant.startsWith("1stEdition");
      if (mapped.endsWith("-1st") && !stamped) continue;
      const cardId = stamped && twins.has(`${mapped}-1st`) ? `${mapped}-1st` : mapped;
      if ((cardProducts.get(cardId) ?? 0) > 1 && patternOf.size > 0) {
        let seen = patternCardVariants.get(cardId);
        if (!seen) patternCardVariants.set(cardId, (seen = new Set()));
        seen.add(variant);
      }
      const key = `${cardId}|${variant}`;
      if (touched.has(key)) continue;
      const existing = existingSeries.get(key);
      if (!existing && price < MIN_TRACKED_USD) continue;
      const next = setDay(existing ? { startDay: existing.startDay, prices: decodePrices(existing.prices) } : null, day, price);
      upserts.push({
        cardId, game: "pokemon", variant, source: "tcgplayer", currency: "USD",
        startDay: next.startDay, prices: encodePrices(next.prices), updatedDay: day,
      });
      touched.add(key);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  const sealedUpserts = sealedSeriesUpserts("pokemon", day, sealedPrices, sealedMap, existingSeries);
  await upsertSeriesRows([...upserts, ...sealedUpserts]);
  // Drop the series a pattern product wrote under the wrong key before the
  // pattern was understood (the "holofoil" row on an uncommon trainer).
  for (const [cardId, seen] of patternCardVariants) {
    for (const key of existingSeries.keys()) {
      if (!key.startsWith(`${cardId}|`)) continue;
      const variant = key.slice(cardId.length + 1);
      if (seen.has(variant)) continue;
      await db
        .prepare("DELETE FROM price_series WHERE card_id = ? AND source = 'tcgplayer' AND variant = ?")
        .run(cardId, variant);
    }
  }
  return { groups: groups.length, groupsFailed, seriesTouched: upserts.length, sealedSeries: sealedUpserts.length, day };
}
