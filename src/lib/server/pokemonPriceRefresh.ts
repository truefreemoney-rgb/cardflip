import { db } from "@/lib/db";
import { decodePrices, encodePrices, setDay, todayUtc } from "@/lib/priceSeries";
import { LOW_TRACKED_USD, readSeriesMap, upsertListingLows, upsertSeriesRows, type ListingLow, type SeriesKeyed, type SeriesUpsert } from "@/lib/server/priceBulkWrite";
import { getSetting, setSetting } from "@/lib/server/settings";
import { CONVERTED_SOURCE, cardmarketUsd } from "@/lib/server/cardmarket";
import { PRICE_TRUST, REF_ALT_SOURCE, lastPriced } from "@/lib/server/priceTrust";
import {
  kitHalves,
  mapKitProducts,
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
const TRIED_KEY = "tcgcsv_map_tried";

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
 * `max` TCGplayer groups that match a mirror set with no mapped card yet
 * (Trainer Kits: one group, two decks).
 * Best-effort: a failure here never stops the price run.
 */
export async function mapNewPokemonGroups(max = 40): Promise<{ groups: number; products: number }> {
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
  // Groups looked at in the last 7 days and left as they were: not refetched daily (they'd starve new sets of the slots).
  const tried = JSON.parse((await getSetting(TRIED_KEY)) ?? "{}") as Record<string, string>;
  const today = todayUtc();
  const fresh = (gid: number) => !tried[gid] || Date.parse(today) - Date.parse(tried[gid]) >= 7 * 86_400_000;
  // Plus sets out in the last 60 days, mapped or not: TCGplayer adds products after release and the
  // matcher learns names (Palkia LV.X, 10-05), so a young set's gaps get another look each run.
  const recent = new Set(sets.filter((s) => s.released && Date.now() - Date.parse(s.released) < 60 * 86_400_000).map((s) => s.name));
  // Sets with cards no product reaches yet: their group gets a weekly second look, after the new ones
  // (TCGplayer adds promos to a group for years: 29 Mega Evolution promos sat unmapped, 10-05).
  const reached = new Set(
    ((await db.prepare("SELECT card_id FROM tcgplayer_products WHERE game = 'pokemon'").all()) as { card_id: string }[]).map((r) => r.card_id),
  );
  const gappy = new Set(
    ((await db.prepare("SELECT id, set_name FROM en_cards WHERE id NOT LIKE '%-1st'").all()) as { id: string; set_name: string }[])
      .filter((r) => !reached.has(r.id))
      .map((r) => r.set_name),
  );
  const matched = matchGroupsToSets(groups, sets);
  const todo: { gid: number; halves: { set: string; tag: string }[] }[] = [];
  const recheck: typeof todo = [];
  for (const [gid, set] of matched) {
    if (recent.has(set) || (!mappedGroups.has(gid) && !mappedSets.has(set) && fresh(gid))) todo.push({ gid, halves: [{ set, tag: "" }] });
    else if (gappy.has(set) && fresh(gid)) recheck.push({ gid, halves: [{ set, tag: "" }] });
  }
  // Trainer Kits: one TCGplayer group, two mirror decks (10-05).
  const setNames = sets.map((s) => s.name);
  for (const g of groups) {
    if (matched.has(g.groupId) || mappedGroups.has(g.groupId) || !fresh(g.groupId)) continue;
    const halves = kitHalves(g.name, setNames);
    if (halves && !halves.some((h) => mappedSets.has(h.set))) todo.push({ gid: g.groupId, halves });
    // "Generations: Radiant Collection" is its own TCGplayer group; TCGdex files the RC cards
    // inside the main set (g1-RC9), which is already mapped, so it needs its own look (10-05).
    const rc = /^(.+?):\s*radiant collection$/i.exec(g.name.trim());
    const parent = rc ? sets.find((s) => s.name.toLowerCase() === rc[1].trim().toLowerCase()) : undefined;
    if (parent) todo.push({ gid: g.groupId, halves: [{ set: parent.name, tag: "" }] });
  }
  let products = 0;
  let done = 0;
  for (const { gid, halves } of [...todo, ...recheck].slice(0, max)) {
    const pres = await fetch(`https://tcgcsv.com/tcgplayer/3/${gid}/products`, { headers: HEADERS });
    if (!pres.ok) continue;
    const list = ((await pres.json()) as { results?: TcgProduct[] }).results ?? [];
    const decks = await Promise.all(
      halves.map(async (h) => ({
        tag: h.tag,
        cards: (await db.prepare("SELECT id, local_id AS number, name FROM en_cards WHERE set_name = ?").all(h.set)) as MirrorCard[],
      })),
    );
    // Only cards no product reaches yet: a second product on a priced card would race it for the price.
    const map = [...(halves.length > 1 ? mapKitProducts(list, decks) : mapProductsToCards(list, decks[0].cards))].filter(([, id]) => !reached.has(id));
    if (map.length) {
      await db
        .prepare(`INSERT OR IGNORE INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES ${map.map(() => "(?, ?, ?, 'pokemon')").join(", ")}`)
        .run(...map.flatMap(([pid, cardId]) => [pid, gid, cardId]));
    }
    console.log(`tcgcsv map: group ${gid} → ${halves.map((h) => h.set).join(" + ")}: ${map.length} of ${list.length} products`);
    tried[gid] = today;
    products += map.length;
    done++;
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  if (done) await setSetting(TRIED_KEY, JSON.stringify(tried));
  return { groups: done, products };
}

// v2 (10-05): the Cardmarket fallback came in, so every card the old memo parked is asked once more.
const TCGDEX_TRIED_KEY = "tcgdex_price_tried_v2";
/** Last day each card was asked of TCGdex, so the `max` a run rotates instead of re-asking the same cards. */
const TCGDEX_FETCHED_KEY = "tcgdex_price_fetched";
/**
 * Cards no TCGplayer product reaches (nor a twin of one): TCGdex's card
 * endpoint, pricing.tcgplayer.<variant>.marketPrice; when TCGdex has no
 * TCGplayer price either, its Cardmarket figure converted to dollars
 * (source "cardmarket-converted", variant "average"; 10-05, Chris: "use every
 * resource available to get the cards priced"). Up to `max` a run, least
 * recently asked first; a card TCGdex can't price at all waits 7 days.
 */
async function tcgdexFill(
  day: string,
  existingSeries: Map<string, { startDay: string; prices: string }>,
  touched: Set<string>,
  reached: Set<string>,
  twinsOf: Map<string, string[]>,
  max = 1200, // ~2 s per 300 cards (measured 10-05), so every gap fits one run
): Promise<SeriesUpsert[]> {
  const tried = JSON.parse((await getSetting(TCGDEX_TRIED_KEY)) ?? "{}") as Record<string, string>;
  const fetched = JSON.parse((await getSetting(TCGDEX_FETCHED_KEY)) ?? "{}") as Record<string, string>;
  const due = (id: string) => !tried[id] || Date.parse(day) - Date.parse(tried[id]) >= 7 * 86_400_000;
  const converted = await readSeriesMap("pokemon", CONVERTED_SOURCE);
  let rate: number | null = null;
  try {
    rate = await (await import("@/lib/server/fx")).usdPerEur();
  } catch {
    rate = null;
  }
  const ids = ((await db.prepare("SELECT id FROM en_cards WHERE id NOT LIKE '%-1st'").all()) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !reached.has(id) && !(twinsOf.get(id) ?? []).some((t) => reached.has(t)) && due(id) && fetched[id] !== day)
    .sort((a, b) => (fetched[a] ?? "").localeCompare(fetched[b] ?? ""))
    .slice(0, max);
  const out: SeriesUpsert[] = [];
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
        const card = res.ok ? ((await res.json()) as { pricing?: { tcgplayer?: Record<string, unknown>; cardmarket?: unknown } }) : null;
        fetched[id] = day;
        let priced = false;
        for (const [k, v] of Object.entries(card?.pricing?.tcgplayer ?? {})) {
          const price = (v as { marketPrice?: unknown } | null)?.marketPrice;
          if (typeof price !== "number" || !(price > 0) || /1st/i.test(k)) continue;
          const variant = k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()); // "reverse-holofoil" → "reverseHolofoil"
          const key = `${id}|${variant}`;
          if (touched.has(key)) continue;
          const existing = existingSeries.get(key);
          if (!existing && price < MIN_TRACKED_USD) continue;
          const next = setDay(existing ? { startDay: existing.startDay, prices: decodePrices(existing.prices) } : null, day, price);
          out.push({ cardId: id, game: "pokemon", variant, source: "tcgplayer", currency: "USD", startDay: next.startDay, prices: encodePrices(next.prices), updatedDay: day });
          touched.add(key);
          priced = true;
        }
        if (!priced) {
          const usd = cardmarketUsd(card?.pricing?.cardmarket, rate);
          if (usd != null) {
            const existing = converted.get(`${id}|average`);
            const next = setDay(existing ? { startDay: existing.startDay, prices: decodePrices(existing.prices) } : null, day, usd);
            out.push({ cardId: id, game: "pokemon", variant: "average", source: CONVERTED_SOURCE, currency: "USD", startDay: next.startDay, prices: encodePrices(next.prices), updatedDay: day });
            priced = true;
          }
        }
        if (!priced) tried[id] = day;
      } catch {
        tried[id] = day;
      }
    }
  };
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  if (ids.length) {
    await setSetting(TCGDEX_TRIED_KEY, JSON.stringify(tried));
    await setSetting(TCGDEX_FETCHED_KEY, JSON.stringify(fetched));
  }
  return out;
}

/** Default printing first, as the price guard picks it (priceTrustLoad). */
const REF_VARIANTS = ["normal", "nonfoil", "holofoil", "reverseHolofoil"];
const refRank = (variant: string) => REF_VARIANTS.indexOf(variant) + 1 || 99;

/**
 * Pure: the cards whose pokemontcg.io Cardmarket average disagrees with the
 * US price (>= refClear on a $10+ default printing), plus every card that
 * already has a TCGdex reading, so it stays fresh. Disputed first, then the rest.
 */
export function refereeCandidates(
  tcg: Map<string, { prices: string }>,
  cm: Map<string, { prices: string }>,
  alt: Map<string, { prices: string }>,
): string[] {
  const best = new Map<string, { variant: string; usd: number }>();
  for (const [key, s] of tcg) {
    const bar = key.indexOf("|");
    const id = key.slice(0, bar);
    const variant = key.slice(bar + 1);
    const usd = lastPriced(decodePrices(s.prices));
    if (usd == null) continue;
    const cur = best.get(id);
    if (!cur || refRank(variant) < refRank(cur.variant)) best.set(id, { variant, usd });
  }
  const disputed: string[] = [];
  for (const [id, { usd }] of best) {
    if (usd < PRICE_TRUST.refMinUsd) continue;
    const eur = cm.get(`${id}|average`);
    const ref = eur ? lastPriced(decodePrices(eur.prices)) : null;
    if (ref != null && ref >= PRICE_TRUST.refMinEur && usd / (ref * PRICE_TRUST.eurToUsd) >= PRICE_TRUST.refClear) disputed.push(id);
  }
  const seen = new Set(disputed);
  const keep = [...alt.keys()].map((k) => k.slice(0, k.indexOf("|"))).filter((id) => !seen.has(id));
  return [...disputed, ...keep];
}

/**
 * TCGdex's Cardmarket `avg` (EUR) for the disputed cards (refereeCandidates),
 * stored as REF_ALT_SOURCE so the price guard has a second reading (10-06:
 * pokemontcg.io's average was another printing's on 97 of 185 disputed cards).
 * The plain `avg` only: TCGdex's "-holo" fields are Cardmarket's reverse holo,
 * and its trend/avg30 carry spikes (Cresselia GE: avg EUR 4.32, avg7 EUR 513).
 */
async function tcgdexReferee(day: string, tcg: Map<string, SeriesKeyed>, max = 600): Promise<SeriesUpsert[]> {
  const [cm, alt] = await Promise.all([readSeriesMap("pokemon", "cardmarket"), readSeriesMap("pokemon", REF_ALT_SOURCE)]);
  const queue = refereeCandidates(tcg, cm, alt).filter((id) => alt.get(`${id}|average`)?.updatedDay !== day).slice(0, max);
  const out: SeriesUpsert[] = [];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
        const card = res.ok ? ((await res.json()) as { pricing?: { cardmarket?: { avg?: unknown } | null } }) : null;
        const avg = card?.pricing?.cardmarket?.avg;
        if (typeof avg !== "number" || !(avg >= PRICE_TRUST.refMinEur)) continue;
        const existing = alt.get(`${id}|average`);
        const next = setDay(existing ? { startDay: existing.startDay, prices: decodePrices(existing.prices) } : null, day, avg);
        out.push({ cardId: id, game: "pokemon", variant: "average", source: REF_ALT_SOURCE, currency: "EUR", startDay: next.startDay, prices: encodePrices(next.prices), updatedDay: day });
      } catch {
        // one card's miss waits for tomorrow
      }
    }
  };
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  return out;
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

  // Same set, number and name under two catalog ids → each gets the other's price.
  // (1st Edition twins are their own printing and price; never copied.)
  const twinsOf = new Map<string, string[]>();
  const sameCard = new Map<string, string[]>();
  for (const r of (await db.prepare("SELECT id, set_name, local_id, name FROM en_cards WHERE id NOT LIKE '%-1st'").all()) as {
    id: string; set_name: string; local_id: string; name: string;
  }[]) {
    const k = `${r.set_name}|${r.local_id}|${r.name}`;
    sameCard.set(k, [...(sameCard.get(k) ?? []), r.id]);
  }
  for (const ids of sameCard.values()) if (ids.length > 1) for (const id of ids) twinsOf.set(id, ids.filter((x) => x !== id));

  // Sealed product (booster boxes, ETBs, tins): the same /prices response
  // carries them; their points are collected here and written after the
  // loop under the sealed catalog ids (Tier 2 #13).
  const sealedMap = await readSealedMap("pokemon");
  const sealedPrices = new Map<number, number>();

  let groupsFailed = 0;
  const upserts: SeriesUpsert[] = [];
  const touched = new Set<string>();
  const lows: ListingLow[] = [];
  // Cards with a pattern product: every variant seen for them this run, so
  // the mislabelled "holofoil" rows earlier runs wrote can be dropped.
  const patternCardVariants = new Map<string, Set<string>>();
  for (const gid of groups) {
    let results: { productId: number; marketPrice?: number | null; lowPrice?: number | null; subTypeName?: string | null }[];
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
      // The card and any catalog twin that no product reaches (TCGdex lists the SWSH Trainer
      // Galleries twice, swsh10tg-TG04 and swsh10.5tg-TG04: 99 copies sat priceless, 10-05).
      for (const id of [cardId, ...(twinsOf.get(cardId) ?? []).filter((t) => !cardProducts.has(t))]) {
        const key = `${id}|${variant}`;
        if (touched.has(key)) continue;
        const existing = existingSeries.get(key);
        if (!existing && price < MIN_TRACKED_USD) continue;
        const next = setDay(existing ? { startDay: existing.startDay, prices: decodePrices(existing.prices) } : null, day, price);
        upserts.push({
          cardId: id, game: "pokemon", variant, source: "tcgplayer", currency: "USD",
          startDay: next.startDay, prices: encodePrices(next.prices), updatedDay: day,
        });
        touched.add(key);
        // The cheapest live listing beside a $100+ market price: the guard's check on a market frozen on an old sale.
        if (price >= LOW_TRACKED_USD && r.lowPrice != null && r.lowPrice > 0) lows.push({ cardId: id, game: "pokemon", variant, lowUsd: r.lowPrice });
      }
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  const sealedUpserts = sealedSeriesUpserts("pokemon", day, sealedPrices, sealedMap, existingSeries);
  await upsertSeriesRows([...upserts, ...sealedUpserts]);
  await upsertListingLows(lows, day).catch((err) => console.warn("listing lows:", err instanceof Error ? err.message : err));
  // Last resort, TCGdex: our catalog's own source carries TCGplayer's market price per card id (the
  // Unseen Forces Unown Collection and a few promos no TCGplayer group lines up with, 10-05). After the
  // main write, so a slow TCGdex can never cost the day's prices.
  let tcgdexSeries = 0;
  try {
    const fill = await tcgdexFill(day, existingSeries, touched, new Set(cardProducts.keys()), twinsOf);
    await upsertSeriesRows(fill);
    tcgdexSeries = fill.length;
  } catch (err) {
    console.warn("tcgdex price fill:", err instanceof Error ? err.message : err);
  }
  try {
    await upsertSeriesRows(await tcgdexReferee(day, existingSeries));
  } catch (err) {
    console.warn("tcgdex referee:", err instanceof Error ? err.message : err);
  }
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
  return { groups: groups.length, groupsFailed, seriesTouched: upserts.length + tcgdexSeries, sealedSeries: sealedUpserts.length, day };
}
