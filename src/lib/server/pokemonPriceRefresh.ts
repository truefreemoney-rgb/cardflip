import { TCGCSV_HEADERS, TCGCSV_PAUSE_MS, tcgcsvFetch } from "@/lib/server/tcgcsv";
import { POKEMON_BACKUP_NEEDED_KEY, pokemonBackupFromPokemontcgIo } from "@/lib/server/priceBackups";
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
  tcgplayerProductStamp,
  tcgplayerVariantKey,
  type MirrorCard,
  type MirrorSet,
  type PatternVariant,
  type TcgGroup,
  type TcgProduct,
} from "@/lib/tcgcsv";
import { loadPokemonHandMap } from "@/lib/server/pokemonHandMap";
import { SOFT_CAP_X } from "@/lib/server/mtgPriceRefresh";
import { readSealedMap, sealedSeriesUpserts } from "@/lib/server/sealedPrices";

/**
 * Daily Pokémon price points from TCGCSV (tcgcsv.com — TCGplayer's prices,
 * republished daily as plain JSON per set). Uses the productId → card map
 * that scripts/backfill-tcgcsv.mjs built (`tcgplayer_products`, shipped in
 * the seed), so every mapped card gets today's point in one pass of ~150
 * small requests — no pokemontcg.io involved, which fails half its calls.
 * Same compact price_series rows and 5¢ rule as everything else.
 */

const HEADERS = TCGCSV_HEADERS;
const MIN_TRACKED_USD = 0.05;
const PAUSE_MS = TCGCSV_PAUSE_MS;
const TRIED_KEY = "tcgcsv_map_tried";

// Schema (tcgplayer_products) lives in lib/db.ts behind the adapter's schema gate.

/**
 * From this market price up a card takes the listing cap. A $15 soft floor (min(market, max(1.45x low, $15)) from $15)
 * was tried 10-17 and REJECTED: it won a 6-card sample it was picked on, then lost 10 fresh cards (within 25% of eBay
 * sold: today's rule 6 of 10, floor 4 of 10; Unown K rev $5.51 vs ~$3 sold would have gone to $15).
 */
export const POKEMON_CAP_MIN_USD = 20;
/**
 * The cap starts when the market is this many times the cheapest listing. Was 2 (10-16), a cliff: $99.99 on a $50 low
 * stayed, $100 fell to $72.50. 10-17 (#22): starting at SOFT_CAP_X itself leaves no jump (a higher market never shows a
 * lower price). eBay sold sample of the 1.45x-2x band (1,232 of 3,738 $20+ printings that day): the capped number was
 * closer on 9 of 10 (Cresselia-EX $122 -> $103 vs ~$63 sold, Victini-EX $201 -> $167 vs ~$125); the miss was Rayquaza
 * Dragon Vault ($62 -> $47 vs ~$80).
 */
export const POKEMON_CAP_OVER = 1.45;
/**
 * Pokémon listing cap (10-16, Chris "go ahead" after a dry run): TCGplayer's market price on older cards can sit far over
 * every copy actually for sale (Base Set 2 Mewtwo $129.77 with the cheapest copy $47 and eBay sold ~$34; Reshiram-EX full
 * art $445 vs $174 / ~$100). From $20, a market at POKEMON_CAP_OVER x the cheapest listing or more becomes SOFT_CAP_X
 * (1.45) x that listing, as Magic's soft cap does: under the trust check's 1.5x edge, and above the cheapest copy, which
 * is often a played one. Dry run 10-16: 1,351 of 8,196 $10+ printings (16.5%); eBay sold sample, the capped number was
 * closer on 11 of 13; the 2 misses were $12-$15 holos, hence the $20 floor. Pure.
 */
export function pokemonListingCap(market: number, low: number | null): number {
  if (!POKEMON_CAP_ON) return market;
  if (!(market >= POKEMON_CAP_MIN_USD) || low == null || !(low > 0) || market < POKEMON_CAP_OVER * low) return market;
  return Math.min(market, Math.round(low * SOFT_CAP_X * 100) / 100);
}
/**
 * OFF since 10-22 (Chris "build the cap rule" after the 106-card incident, docs/REPORT-CARD-2026-10-21.md §14-15). The
 * cheapest listing is a damaged copy on most older cards, so the cap priced them at a fraction of what Near Mint copies
 * sell for: of the 106 cards it cut 2x+ on 10-16, 28 of the 30 with 3+ TCGplayer NM sales sat at 15-55% of the NM
 * median. A fresh 48-card sample across every band on 10-22 (16 with 3+ NM sales, TCGplayer's own signed-in sales feed):
 * TCGplayer's market was closer than the capped number on 15 of 16, in the 1.45-2x band 4 of 4, 2-3x 6 of 7, 3x+ 5 of 5;
 * median error market 13-41% vs cap 30-72%. The 10-16/10-17 samples that okayed the cap were eBay sold reads mixing
 * played copies and Best Offer sales, which read low. A damaged copy for sale says nothing about a Near Mint price.
 * The function stays (tests, history) and answers the market while this is false; the 10-16/10-18 cut points stay in
 * the stored series and lib/priceOutliers.ts starts charts at the cut and again at the lift.
 */
export const POKEMON_CAP_ON = false;
export interface PokemonRefreshResult {
  groups: number;
  groupsFailed: number;
  seriesTouched: number;
  /** Sealed product series written this run (lib/server/sealedPrices.ts). */
  sealedSeries: number;
  day: string;
  /** tcgcsv answered nothing: the day's points came from pokemontcg.io instead (lib/server/priceBackups.ts). */
  backup?: { source: "pokemontcg.io"; sets: number; setsDone: number; setsFailed: number; setsLeft: number; series: number };
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
  const res = await tcgcsvFetch("https://tcgcsv.com/tcgplayer/3/groups");
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
    const pres = await tcgcsvFetch(`https://tcgcsv.com/tcgplayer/3/${gid}/products`);
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

/**
 * Where a product's price is written: a pattern product's price is the pattern variant whatever subtype
 * TCGplayer files it under ("Holofoil"); 1st Edition variants go to the "-1st" twin. Null = not this card's.
 */
function productSeries(
  productId: number, subTypeName: string | null | undefined, mapped: string,
  patternOf: Map<number, PatternVariant>, twins: Set<string>,
): { cardId: string; variant: string } | null {
  const variant = patternOf.get(productId) ?? tcgplayerVariantKey(subTypeName);
  const stamped = variant.startsWith("1stEdition");
  if (mapped.endsWith("-1st") && !stamped) return null;
  return { cardId: stamped && twins.has(`${mapped}-1st`) ? `${mapped}-1st` : mapped, variant };
}

/**
 * Pure: one pattern group's day for the cleanup after the loop. `seen` = the variants each card with two
 * products came back under, a product with no market today included (no recent TCGplayer sale is not a
 * wrong key); `unsure` = cards with a product missing from the day's file, whose variants nobody can vouch
 * for. 10-21: the cleanup deleted the stopped lines of the dearest pattern cards.
 */
export function patternVariantsSeen(
  results: { productId: number; subTypeName?: string | null }[],
  groupProducts: number[],
  patternOf: Map<number, PatternVariant>,
  productToCard: Map<number, string>,
  cardProducts: Map<string, number>,
  twins: Set<string>,
): { seen: Map<string, Set<string>>; unsure: Set<string> } {
  const seen = new Map<string, Set<string>>();
  for (const r of results) {
    const mapped = productToCard.get(r.productId);
    const s = mapped ? productSeries(r.productId, r.subTypeName, mapped, patternOf, twins) : null;
    if (!s || (cardProducts.get(s.cardId) ?? 0) <= 1) continue;
    seen.set(s.cardId, (seen.get(s.cardId) ?? new Set()).add(s.variant));
  }
  const listed = new Set(results.map((r) => r.productId));
  const unsure = new Set<string>();
  for (const pid of groupProducts) {
    const mapped = productToCard.get(pid);
    if (mapped && !listed.has(pid)) unsure.add(mapped).add(`${mapped}-1st`);
  }
  return { seen, unsure };
}

/** Pure: the pattern cards' stored variants no product named today (the old mislabelled "holofoil" rows). */
export function patternCleanupDeletes(
  seen: Map<string, Set<string>>, unsure: Set<string>, existingKeys: Iterable<string>,
): { cardId: string; variant: string }[] {
  const out: { cardId: string; variant: string }[] = [];
  for (const key of existingKeys) {
    const bar = key.indexOf("|");
    const cardId = key.slice(0, bar);
    const variant = key.slice(bar + 1);
    const named = seen.get(cardId);
    if (named && !unsure.has(cardId) && !named.has(variant)) out.push({ cardId, variant });
  }
  return out;
}

export async function refreshPokemonPricesFromTcgcsv(day = todayUtc()): Promise<PokemonRefreshResult> {
  await loadPokemonHandMap(); // best-effort, never throws
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
  const groupProducts = new Map<number, number[]>();
  // The sync driver streamed this with .iterate(); the map is ~30k small rows,
  // well within memory as one read.
  for (const r of (await db.prepare("SELECT product_id, group_id, card_id FROM tcgplayer_products WHERE game = 'pokemon'").all()) as { product_id: number; group_id: number; card_id: string }[]) {
    productToCard.set(r.product_id, r.card_id);
    const inGroup = groupProducts.get(r.group_id);
    if (inGroup) inGroup.push(r.product_id);
    else groupProducts.set(r.group_id, [r.product_id]);
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
  const patternCardsUnsure = new Set<string>();
  for (const gid of groups) {
    let results: { productId: number; marketPrice?: number | null; lowPrice?: number | null; subTypeName?: string | null }[];
    const patternOf = new Map<number, PatternVariant>();
    // Stamped promo products ("[Staff]", Worlds placements) mapped beside the plain card: never price it (10-22).
    const stamped = new Set<number>();
    try {
      if (patternGroups.has(gid)) {
        const pres = await tcgcsvFetch(`https://tcgcsv.com/tcgplayer/3/${gid}/products`);
        if (!pres.ok) throw new Error(`products HTTP ${pres.status}`);
        const products = ((await pres.json()) as { results?: { productId: number; name?: string }[] }).results ?? [];
        for (const p of products) {
          const pattern = tcgplayerProductPattern(p.name);
          if (pattern) patternOf.set(p.productId, pattern);
          if (tcgplayerProductStamp(p.name)) stamped.add(p.productId);
        }
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
      const res = await tcgcsvFetch(`https://tcgcsv.com/tcgplayer/3/${gid}/prices`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      results = ((await res.json()) as { results?: typeof results }).results ?? [];
    } catch (err) {
      groupsFailed++;
      console.warn(`tcgcsv group ${gid}:`, err instanceof Error ? err.message : err);
      continue;
    }
    if (patternOf.size > 0) {
      const today = patternVariantsSeen(results, groupProducts.get(gid) ?? [], patternOf, productToCard, cardProducts, twins);
      for (const [cardId, variants] of today.seen) {
        const all = patternCardVariants.get(cardId) ?? new Set<string>();
        for (const v of variants) all.add(v);
        patternCardVariants.set(cardId, all);
      }
      for (const cardId of today.unsure) patternCardsUnsure.add(cardId);
    }
    for (const r of results) {
      if (stamped.has(r.productId)) continue;
      const mapped = productToCard.get(r.productId);
      // Sealed products keep TCGplayer's market as is; cards take the listing cap (pokemonListingCap).
      const price = mapped && r.marketPrice != null ? pokemonListingCap(r.marketPrice, r.lowPrice ?? null) : (r.marketPrice ?? null);
      if (!mapped && price != null && price > 0 && sealedMap.has(r.productId) && !sealedPrices.has(r.productId)) {
        sealedPrices.set(r.productId, price);
        continue;
      }
      if (!mapped || price == null || !(price > 0)) continue;
      const series = productSeries(r.productId, r.subTypeName, mapped, patternOf, twins);
      if (!series) continue;
      const { cardId, variant } = series;
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
  // tcgcsv down for the whole run (10-08, our agent blocked): the same TCGplayer market number from pokemontcg.io.
  let backup: PokemonRefreshResult["backup"];
  if (groups.length > 0 && groupsFailed === groups.length) {
    await setSetting(POKEMON_BACKUP_NEEDED_KEY, day).catch(() => {});
    const b = await pokemonBackupFromPokemontcgIo(day, existingSeries, touched, { deadline: Date.now() + 110_000 });
    upserts.push(...b.upserts);
    backup = { source: "pokemontcg.io", sets: b.sets, setsDone: b.setsDone, setsFailed: b.setsFailed, setsLeft: b.setsLeft, series: b.upserts.length };
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
  for (const { cardId, variant } of patternCleanupDeletes(patternCardVariants, patternCardsUnsure, existingSeries.keys())) {
    await db
      .prepare("DELETE FROM price_series WHERE card_id = ? AND source = 'tcgplayer' AND variant = ?")
      .run(cardId, variant);
  }
  return { groups: groups.length, groupsFailed, seriesTouched: upserts.length + tcgdexSeries, sealedSeries: sealedUpserts.length, day, ...(backup ? { backup } : {}) };
}
