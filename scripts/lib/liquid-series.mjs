/**
 * Price-series fixtures for the tests that go through the site price guard
 * (lib/server/priceTrustSite.ts): a card priced at $100+ needs a real history
 * (a series with one point is "unverified"), so tests record a liquid one, and
 * for the junk cases the two shapes a collector calls wrong.
 */

/** A market that moves every day and ends on `to` (the same shape test:pricetrust uses). */
export const liquidPrices = (to, days = 60) =>
  Array.from({ length: days }, (_, i) => Math.round((to * (1 + ((i * 7) % 5) / 100) - (i % 3)) * 100) / 100).concat(to);

/** A stuck listing: the same round price for `days` days (Deoxys, $500 for 87 days). */
export const flatPrices = (price, days = 60) => Array(days).fill(price);

/** Record `prices` (oldest first) so the last one lands on `endDay` (the whole series through recordPoint, one day each). */
export async function recordSeries(recordPoint, addDays, endDay, cardId, game, variant, prices) {
  for (let i = 0; i < prices.length; i++) {
    await recordPoint(cardId, game, variant, "tcgplayer", "USD", prices[i], addDays(endDay, i - (prices.length - 1)));
  }
}
