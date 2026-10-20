/**
 * The card price chain (lib/priceChain.ts, Chris 10-19 "yes build it"; measured in docs/PRICE-SOURCES-TEST-10-19.md):
 * TCGplayer > own 30-day median > Cardmarket x1.12 (Magic only) > Card Kingdom / 1.24 (Magic only) > CardTrader > unsure.
 * Run: npm run test:pricechain
 */
import assert from "node:assert/strict";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { CARDMARKET_LIFT, CARD_KINGDOM_DIVISOR, BACKUP_ORDER, backupRank, backupSourceLabel, cardmarketLift, recentMedian } = await import(at("lib/priceChain.ts"));
const { cardkingdomMap, adjustedUsd, cardkingdomFill, cardkingdomFills } = await import(at("lib/server/cardkingdom.ts"));
const { fillFromEuro, planMtgWrites } = await import(at("lib/server/mtgPriceRefresh.ts"));
const { eurMarketUsd } = await import(at("lib/listing.ts"));
const { fallbackOf, ownMedianFallback } = await import(at("lib/server/priceTrustSite.ts"));

let passed = 0;
const check = (name, got, want) => {
  assert.deepEqual(got, want, name);
  passed++;
};

// The lifts are Magic only: Pokémon's Cardmarket sits at half of TCGplayer (24-25% within 25%), no lift rescues it.
check("lift: Magic 1.12, every other game 1", ["mtg", "pokemon", "yugioh", "onepiece", "lorcana", null].map(cardmarketLift), [1.12, 1, 1, 1, 1, 1]);
check("lift table holds Magic only", Object.keys(CARDMARKET_LIFT), ["mtg"]);
check("Card Kingdom divisor 1.24", CARD_KINGDOM_DIVISOR, 1.24);

// Backup order per game: Magic Cardmarket > Card Kingdom > CardTrader; the others CardTrader > Cardmarket (today's fills).
check("Magic backup order", BACKUP_ORDER.mtg, ["cardmarket-converted", "cardkingdom", "cardtrader"]);
check("Pokémon backup order", BACKUP_ORDER.pokemon, ["cardtrader", "cardmarket-converted"]);
check("rank: Magic Cardmarket 0, Card Kingdom 1, CardTrader 2, unknown last (3)", ["cardmarket-converted", "cardkingdom", "cardtrader", "tcgplayer"].map((s) => backupRank("mtg", s)), [0, 1, 2, 3]);
check("rank: Yu-Gi-Oh CardTrader before Cardmarket, Card Kingdom never", ["cardtrader", "cardmarket-converted", "cardkingdom"].map((s) => backupRank("yugioh", s)), [0, 1, 2]);
check("labels", ["cardmarket-converted", "cardkingdom", "cardtrader", "x"].map(backupSourceLabel), ["Cardmarket (converted from €)", "Card Kingdom (adjusted)", "CardTrader (listings)", "x"]);

// Step 2: the own 30-day median.
check("median: last 30 days only, nulls skipped, even count averages", recentMedian([100, 100, 100, ...Array(30).fill(null), 10, 12, null, 14, 16, 20, 30], 30), 15);
check("median: under 5 priced points = null", recentMedian([null, 10, 12, 14, 16], 30), null);
check("median: odd count takes the middle, rounded to the cent", recentMedian([1.005, 2.015, 3.025, 4.035, 5.045]), 3.03);
check("own median stands in only when it reads differently (over 10% away)", [ownMedianFallback([10, 10, 10, 10, 10, 10], 10), ownMedianFallback([10, 10, 10, 10, 10, 40], 40), ownMedianFallback([10, 10, 10, 10, 10, 40], null)], [null, 10, 10]);

// fallbackOf order: before jump / cardmarket ref > own median > ebay-ask ref > live ask > cheapest listing > sibling.
check("fallback: a spike's before-jump level beats the median", fallbackOf({ reason: "spike 4.0x", ref: 25 }, null, null, [], 30), { fallback: 25, fallbackFrom: "before jump" });
check("fallback: Cardmarket's reading beats the median", fallbackOf({ reason: "cardmarket 20.4x", ref: 5 }, null, null, [], 30), { fallback: 5, fallbackFrom: "cardmarket" });
check("fallback: the median beats an eBay-ask reference", fallbackOf({ reason: "ebay asks 3.1x", ref: 40 }, null, null, [], 30), { fallback: 30, fallbackFrom: "30-day median" });
check("fallback: no median, the eBay-ask reference stands", fallbackOf({ reason: "ebay asks 3.1x", ref: 40 }, null, null, []), { fallback: 40, fallbackFrom: "ebay ask" });
check("fallback: the median beats a live ask", fallbackOf({ reason: "sibling 3x" }, { median: 50, nNm: 5 }, null, [20], 30), { fallback: 30, fallbackFrom: "30-day median" });
check("fallback: without a median the old order holds (live ask, 3+)", fallbackOf({ reason: "sibling 3x" }, { median: 50, nNm: 5 }, null, [20]), { fallback: 50, fallbackFrom: "ebay ask" });

// Step 3: Cardmarket lifted for Magic. Lotus EUR 33,768.47 at 1.1 -> $37,145.32 plain; lifted 1.12 -> $41,602.76.
{
  const rows = [{ id: "lotus", usd: null, foil: null, etched: null, eur: 33768.47, eurFoil: null }];
  fillFromEuro(rows, 1.1, 1.12);
  check("euro fill lifted 12% for Magic", [rows[0].usd, rows[0].source], [41602.76, "cardmarket-converted"]);
  const plain = eurMarketUsd([{ source: "cardmarket", variant: "nonfoil", label: "Nonfoil", currency: "EUR", market: 100, low: null, high: null }], 1.1);
  const lifted = eurMarketUsd([{ source: "cardmarket", variant: "nonfoil", label: "Nonfoil", currency: "EUR", market: 100, low: null, high: null }], 1.1, 1.12);
  check("scan-side euro row: plain 110, lifted 123.20", [plain?.market, lifted?.market], [110, 123.2]);
}

// Step 4: Card Kingdom. Keyed by Scryfall id, plain and foil rows, retail / 1.24, only blank released rows.
{
  const list = cardkingdomMap([
    { scryfall_id: "a", is_foil: "false", price_retail: "12.40", qty_retail: 3 },
    { scryfall_id: "a", is_foil: "true", price_retail: "24.80", qty_retail: 0 },
    { scryfall_id: "b", is_foil: "false", price_retail: "0.00" },
    { scryfall_id: "", is_foil: "false", price_retail: "5" },
    { scryfall_id: "c", is_foil: false, price_retail: 1.24 },
    { scryfall_id: "stone", is_foil: "true", price_retail: "45000", qty_retail: "0" }, // The Mind Stone placeholder, 10-19 dry run
  ]);
  check("map: a plain (3 in stock) + foil (none), b dropped (no price), blank id dropped, c plain, stone foil with none in stock", [...list.entries()],
    [["a", { plain: 12.4, foil: 24.8, plainQty: 3, foilQty: 0 }], ["c", { plain: 1.24, foil: null, plainQty: 0, foilQty: 0 }], ["stone", { plain: null, foil: 45000, plainQty: 0, foilQty: 0 }]]);
  check("adjusted: 12.40 -> 10, 1.24 -> 1, 0.05 -> null (under a nickel), null -> null; $100+ with none in stock -> null, $99 out of stock still fills",
    [adjustedUsd(12.4), adjustedUsd(1.24), adjustedUsd(0.05), adjustedUsd(null), adjustedUsd(45000, 0), adjustedUsd(124, 0), adjustedUsd(99, 0)], [10, 1, null, null, null, null, 79.84]);
  check("fill: the Mind Stone placeholder yields nothing", cardkingdomFill("stone", list), null);
  const guarded = [{ id: "g", usd: null, foil: null, etched: null, eur: null, eurFoil: null }];
  check("the caller's guard can drop a fill (the 15x oracle guard)", cardkingdomFills(guarded, new Map([["g", { plain: 1240, foil: null, plainQty: 1, foilQty: 0 }]]), new Set(["g"]), () => []), 0);
  const rows = [
    { id: "a", usd: null, foil: null, etched: null, eur: null, eurFoil: null },
    { id: "c", usd: null, foil: null, etched: null, eur: null, eurFoil: null },
    { id: "a2", usd: 3, foil: null, etched: null, eur: null, eurFoil: null }, // already priced: untouched
    { id: "d", usd: null, foil: null, etched: null, eur: null, eurFoil: null }, // not on the list
  ];
  const n = cardkingdomFills(rows, list, new Set(["a", "a2", "d"])); // c unreleased
  check("fills: a takes 10 / 20 under cardkingdom; c (unreleased), a2 (priced), d (not listed) untouched",
    [n, rows.map((r) => [r.usd, r.foil, r.source ?? null])],
    [1, [[10, 20, "cardkingdom"], [null, null, null], [3, null, null], [null, null, null]]]);
  const plan = planMtgWrites(rows.slice(0, 1), new Map([["a", { id: "a", usd: null, foil: null, etched: null, eur: null, eurFoil: null }]]), new Map(), "2026-10-19");
  check("its series are written under cardkingdom, both finishes", plan.upserts.map((u) => [u.cardId, u.variant, u.source, u.currency]), [["a", "nonfoil", "cardkingdom", "USD"], ["a", "foil", "cardkingdom", "USD"]]);
}

console.log(`\nprice chain: ${passed} checks pass`);
