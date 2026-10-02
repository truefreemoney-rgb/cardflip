/**
 * Profit per card + the year-end report math (lib/profit.ts) and the
 * cost_basis column round trip (lib/server/cards.ts). Run: npm run test:profit
 *
 * Pins: profit = sold − fees (actual wins over the estimate) − postage − cost;
 * a sale with no cost counts at $0 and is flagged; the year is the Eastern
 * year of the sale; CSV cells quote commas and quotes; PATCH-style update
 * stores, rounds and clears cost_basis.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-profit-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { saleBreakdown, saleNet, yearTotals, saleYears, saleYear, csvCell } = await import(at("lib/profit.ts"));
const { estimatedEbayFees, POSTAGE_USD } = await import(at("lib/fees.ts"));

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} vs ${b}`);

// --- saleBreakdown ---------------------------------------------------------
{
  const b = saleBreakdown({ soldPrice: 100, soldFees: 12, soldAt: 0, costBasis: 40 });
  close(b.fees, 12, "actual fee wins");
  close(b.profit, 100 - 12 - POSTAGE_USD - 40, "profit with actual fee");
  assert.equal(b.feesActual, true);
  assert.equal(b.costKnown, true);

  const e = saleBreakdown({ soldPrice: 100, soldFees: null, soldAt: 0, costBasis: null });
  close(e.fees, estimatedEbayFees(100), "estimate when no actual fee");
  close(e.profit, 100 - estimatedEbayFees(100) - POSTAGE_USD, "no cost counts as $0");
  assert.equal(e.feesActual, false);
  assert.equal(e.costKnown, false);

  assert.equal(saleBreakdown({ soldPrice: null, soldFees: null, soldAt: 0, costBasis: 5 }), null, "unsold = no breakdown");

  const loss = saleBreakdown({ soldPrice: 5, soldFees: null, soldAt: 0, costBasis: 20 });
  assert.ok(loss.profit < 0, "a loss is negative, not clamped");

  // Marked sold by hand (off eBay, Chris 10-01): no eBay fee, no postage.
  const hand = saleBreakdown({ soldPrice: 15, soldFees: null, soldAt: 0, costBasis: 4, soldByHand: true });
  close(hand.fees, 0, "hand-marked: no fee");
  close(hand.postage, 0, "hand-marked: no postage");
  close(hand.profit, 11, "hand-marked: price minus cost");
  assert.equal(hand.feesActual, true, "hand-marked: nothing is estimated");
  assert.equal(hand.byHand, true);
  close(saleNet({ soldPrice: 15, soldFees: null, soldByHand: true }), 15, "hand-marked net is the whole price");
  close(saleNet({ soldPrice: 100, soldFees: 12 }), 100 - 12 - POSTAGE_USD, "eBay sale net");
}

// --- years (Eastern) ------------------------------------------------------
{
  // 2026-01-01 03:00 UTC is still Dec 31 2025 in New York.
  const nyeLate = Date.UTC(2026, 0, 1, 3, 0, 0);
  assert.equal(saleYear(nyeLate), 2025, "Eastern year, not UTC");
  const cards = [
    { soldPrice: 50, soldFees: null, soldAt: nyeLate, costBasis: 10 },
    { soldPrice: 80, soldFees: 10, soldAt: Date.UTC(2026, 5, 1), costBasis: null },
    { soldPrice: 20, soldFees: 3, soldAt: Date.UTC(2026, 6, 1), costBasis: 5 },
    { soldPrice: null, soldFees: null, soldAt: null, costBasis: 5 },
  ];
  assert.deepEqual(saleYears(cards), [2026, 2025], "newest year first, unsold ignored");
  const t = yearTotals(cards, 2026);
  assert.equal(t.sales, 2);
  close(t.gross, 100, "gross");
  close(t.fees, 13, "fees");
  close(t.postage, 2 * POSTAGE_USD, "postage");
  close(t.cost, 5, "cost only where known");
  close(t.profit, 100 - 13 - 2 * POSTAGE_USD - 5, "profit");
  assert.equal(t.feesEstimated, 0);
  assert.equal(t.costMissing, 1);
  const t25 = yearTotals(cards, 2025);
  assert.equal(t25.sales, 1);
  assert.equal(t25.feesEstimated, 1);
}

// --- csv ------------------------------------------------------------------
assert.equal(csvCell('Pikachu, "the" mouse'), '"Pikachu, ""the"" mouse"');
assert.equal(csvCell(12.5), "12.50");
assert.equal(csvCell(3), "3");
assert.equal(csvCell(null), "");

// --- cost_basis round trip through the card store -------------------------
{
  const { createCard, updateCard, getCardForUser } = await import(at("lib/server/cards.ts"));
  const { createUser } = await import(at("lib/server/users.ts"));
  const user = await createUser("Profit Test", "profit-test@example.test", "Pw-123456!");
  const card = await createCard(user.id, {
    cardName: "Charizard", setName: "Base Set", cardNumber: "4", imageUrl: "https://example.test/c.png",
    condition: "Near Mint", price: 100, game: "pokemon",
  });
  assert.equal(card.costBasis, null, "new card has no cost");
  const set = await updateCard(card.id, user.id, { costBasis: 42.5 });
  assert.equal(set.costBasis, 42.5, "cost stored");
  const same = await updateCard(card.id, user.id, { price: 120 });
  assert.equal(same.costBasis, 42.5, "an unrelated patch keeps the cost");
  const cleared = await updateCard(card.id, user.id, { costBasis: null });
  assert.equal(cleared.costBasis, null, "null clears it");
  const again = await getCardForUser(card.id, user.id);
  assert.equal(again.costBasis, null);

  // sold_by_hand: stamped only by the seller's own move INTO sold, never by the eBay sync's.
  const hand = await updateCard(card.id, user.id, { status: "sold", soldPrice: 90, soldAt: Date.now(), soldByHand: true });
  assert.equal(hand.soldByHand, true, "the seller's Mark as Sold is by hand");
  const fixed = await updateCard(card.id, user.id, { soldPrice: 95 });
  assert.equal(fixed.soldByHand, true, "a price correction keeps it");
  assert.equal((await getCardForUser(card.id, user.id)).soldByHand, true, "stored");
  const ebay = await createCard(user.id, {
    cardName: "Blastoise", setName: "Base Set", cardNumber: "2", imageUrl: "https://example.test/b.png",
    condition: "Near Mint", price: 50, game: "pokemon",
  });
  const synced = await updateCard(ebay.id, user.id, { status: "sold", soldPrice: 50, soldAt: Date.now() });
  assert.equal(synced.soldByHand, false, "the sales sync's sold is not by hand");
  const resent = await updateCard(ebay.id, user.id, { status: "sold", soldPrice: 55, soldByHand: true });
  assert.equal(resent.soldByHand, false, "correcting an eBay sale's price does not make it hand-marked");
}

console.log("test:profit ok");
