/**
 * Pokémon cards TCGplayer can't price → Cardmarket's figure in dollars.
 * Run: npm run test:pkcardmarket
 *
 * Pins (10-05, Chris: "use every resource available to get the cards
 * priced"): trend first, else the 30-day average, times the day's rate,
 * rounded to cents; nothing without a rate; nothing under 2 cents; junk
 * skipped when trend and avg30 disagree over 3x or the cheapest listing sits
 * over 2x the trend, or EUR 100+ has no listing (Creator Pack Mudkip, Treecko,
 * Torchic); a real EUR 312 POP 4 Deoxys ex with a EUR 250 low still prices.
 */
import assert from "node:assert/strict";

const { cardmarketUsd } = await import("../src/lib/server/cardmarket.ts");

assert.equal(cardmarketUsd({ trend: 2, avg30: 2.2, low: 1.5 }, 1.1), 2.2);
assert.equal(cardmarketUsd({ avg30: 3 }, 1.1), 3.3);
assert.equal(cardmarketUsd({ trend: 2 }, null), null);
assert.equal(cardmarketUsd({ trend: 0.01 }, 1.1), null);
assert.equal(cardmarketUsd({ trend: 10, avg30: 2 }, 1.1), null);
assert.equal(cardmarketUsd({ trend: 2912, avg30: 2500, low: 10000 }, 1.1), null);
assert.equal(cardmarketUsd(null, 1.1), null);
assert.equal(cardmarketUsd({ trend: 942.84, avg30: 575, low: 2500 }, 1.1), null);
assert.equal(cardmarketUsd({ trend: 1198.5, avg30: 799.8, low: null }, 1.1), null);
assert.equal(cardmarketUsd({ trend: 312.27, avg30: 213.61, low: 250 }, 1.1), 343.5);
assert.equal(cardmarketUsd({ trend: "5" }, 1.1), null);

// Yu-Gi-Oh / Lorcana: mapped cards TCGplayer left unpriced today take the converted price, tagged, and
// the series lands under "cardmarket-converted"; a card TCGplayer priced is never touched.
const { guideUsd } = await import("../src/lib/server/cardmarket.ts");
const { cardmarketPoints, planTcgRefresh } = await import("../src/lib/server/tcgPriceRefresh.ts");
assert.deepEqual(guideUsd({ idProduct: 1, trend: 1, avg30: 1, "trend-foil": 4, "avg30-foil": 4 }, 1.1), { usd: 1.1, foil: 4.4 });
const guide = new Map([[10, { idProduct: 10, trend: 2, avg30: 2 }], [11, { idProduct: 11, trend: 5, avg30: 5 }]]);
const pts = cardmarketPoints([{ id: "a", usd: 3, foil: null }, { id: "b", usd: null, foil: null }], { a: 11, b: 10, c: 99 }, guide, 1.1);
assert.deepEqual(pts, [{ id: "b", usd: 2.2, foil: null, source: "cardmarket-converted" }]);
const plan = planTcgRefresh("yugioh", pts, new Map([["b", { usd: null, foil: null }]]), new Map(), "2026-10-06");
assert.equal(plan.upserts[0].source, "cardmarket-converted");
assert.deepEqual(plan.columns, [{ id: "b", usd: 2.2, foil: null }]);

console.log("pokemon cardmarket fill: all assertions passed");
process.exit(0);
