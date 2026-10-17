/**
 * Price-series fixtures for the tests that go through the site price guard
 * (lib/server/priceTrustSite.ts): a card priced at $100+ needs a real history
 * (a series with one point is "unverified"), so tests record a liquid one, and
 * for the junk cases the two shapes a collector calls wrong.
 */

/** A market that moves every day and ends on `to` (the same shape test:pricetrust uses). */
export const liquidPrices = (to, days = 60) =>
  Array.from({ length: days }, (_, i) => Math.round((to * (1 + ((i * 7) % 5) / 100) - (i % 3)) * 100) / 100).concat(to);

/** A stuck listing: the same round price for `days` days (Deoxys, $500 for 87 days). Since 10-02 this is STALE (shown with a note), not hidden. */
export const flatPrices = (price, days = 60) => Array(days).fill(price);

/** A junk price the guard HIDES (hard): a one-day 5x spike to `to` that never came back (Rayquaza col1-20's shape). */
export const junkPrices = (to) => [...liquidPrices(Math.round((to / 5) * 100) / 100, 60), ...Array(30).fill(to)];

/** Record `prices` (oldest first) so the last one lands on `endDay` (the whole series through recordPoint, one day each). */
export async function recordSeries(recordPoint, addDays, endDay, cardId, game, variant, prices) {
  for (let i = 0; i < prices.length; i++) {
    await recordPoint(cardId, game, variant, "tcgplayer", "USD", prices[i], addDays(endDay, i - (prices.length - 1)));
  }
}

/**
 * A HARD flag with NO fallback (10-17): an admin's eBay sold check said "hide" (ebay_asks.manual) and the nightly ask reading
 * is too old to count, so the guard has no spike level, no Cardmarket and no median ask to offer. The only kind of flag that
 * still blanks a price. Judged at `price`; hide it BEFORE the first trust read (the loader memoises for ten minutes).
 */
export async function hideByAdmin(db, addDays, today, cardId, game, variant, price) {
  await db
    .prepare(`INSERT OR REPLACE INTO ebay_asks (card_id, game, variant, price_usd, n, n_nm, median_usd, q75_usd, verdict, reason, day, manual, manual_price) VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 'high', '', ?, 'hide', ?)`)
    .run(cardId, game, variant, price, addDays(today, -30), price);
}
