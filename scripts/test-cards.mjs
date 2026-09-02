/**
 * Ledger + wishlist + fee math — the server libs the money numbers ride on.
 * Run: npm run test:cards
 *
 * Pins: the fee formula and that a RECORDED actual fee (even 0) beats the
 * estimate; createCard defaults; ownership enforced inside the queries (a
 * guessed card id + wrong user mutates nothing); updateCard's two cleanups —
 * any status move settles ebay_ended_at, and leaving "sold" drops the old
 * sale's fees/order refs; recordCopiesSold's two roads (full sale flips the
 * row, partial splits a sold row off and decrements the listed one);
 * getPlatformStats blending actual fees with the estimate for unfetched
 * sales; wishlist add-twice no-op, legacy card_id backfill, and alert
 * re-arming when the target changes.
 *
 * Same throwaway-db trick as test-auth.mjs: chdir to a temp dir before any
 * import so `data/cardflip.db` lands there.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-cards-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { estimatedEbayFees, netAfterFees, EBAY_FEE_RATE, EBAY_FLAT_FEE } = await import(at("lib/fees.ts"));
const {
  createCard, getCardForUser, updateCard, deleteCard, listCardsForUser,
  recordCopiesSold, setCardSoldFees, setCardListingEnded, getPlatformStats,
} = await import(at("lib/server/cards.ts"));
const { addToWishlist, setWishlistAlert, removeFromWishlist, listWishlist } = await import(at("lib/server/wishlist.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

const alice = await createUser("Alice", "alice@example.com", "hunter22");
const mallory = await createUser("Mallory", "mallory@example.com", "hunter22");

const CHARIZARD = {
  cardName: "Charizard", setName: "Base Set", cardNumber: "4/102",
  imageUrl: "https://img.example/4.png", condition: "Near Mint", price: 420,
  catalogCardId: "base1-4",
};

// --- fees: one shared formula, actuals win -------------------------------
check("estimate = 13.25% + 30¢", near(estimatedEbayFees(100), 13.55));
check("net falls back to the estimate", near(netAfterFees(100), 86.45));
check("recorded actual fee wins", near(netAfterFees(100, 5), 95));
check("a recorded fee of ZERO also wins (?? not ||)", near(netAfterFees(100, 0), 100));
check("estimate scales, flat fee doesn't", near(estimatedEbayFees(200) - estimatedEbayFees(100), 100 * EBAY_FEE_RATE));

// --- createCard defaults --------------------------------------------------
const card = await createCard(alice.id, CHARIZARD);
check("new card: ready, qty 1, pokemon by default",
  [card.status, card.quantity, card.game], ["ready", 1, "pokemon"]);
check("card kind defaults to 'card', productType null",
  [card.kind, card.productType], ["card", null]);
const box = await createCard(alice.id, { ...CHARIZARD, kind: "sealed", productType: "Booster Box", game: "mtg" });
check("sealed keeps productType, game honored", [box.kind, box.productType, box.game], ["sealed", "Booster Box", "mtg"]);
check("productType dropped when kind is 'card'",
  (await createCard(alice.id, { ...CHARIZARD, productType: "Booster Box" })).productType, null);

// --- ownership lives in the WHERE clause ---------------------------------
check("wrong user reads null", await getCardForUser(card.id, mallory.id), null);
check("wrong user updates nothing", await updateCard(card.id, mallory.id, { price: 1 }), null);
await deleteCard(card.id, mallory.id);
check("wrong user deletes nothing", (await getCardForUser(card.id, alice.id))?.price, 420);

// --- updateCard's cleanup rules ------------------------------------------
await setCardListingEnded(card.id, alice.id, 111);
check("ended stamp lands", (await getCardForUser(card.id, alice.id))?.ebayEndedAt, 111);
await updateCard(card.id, alice.id, { status: "listed", listedAt: 222 });
check("any status move settles the ended flag",
  (await getCardForUser(card.id, alice.id))?.ebayEndedAt, null);
check("a non-status patch leaves the ended flag alone", await (async () => {
  await setCardListingEnded(card.id, alice.id, 333);
  await updateCard(card.id, alice.id, { price: 425 });
  return (await getCardForUser(card.id, alice.id))?.ebayEndedAt;
})(), 333);

await updateCard(card.id, alice.id, { status: "sold", soldPrice: 447.99, soldAt: 444 });
await setCardSoldFees(card.id, alice.id, 59.66);
await db.prepare("UPDATE cards SET ebay_order_id = 'ORD-1', ebay_line_item_id = 'LI-1' WHERE id = ?").run(card.id);
check("sold row carries its fee", (await getCardForUser(card.id, alice.id))?.soldFees, 59.66);
await updateCard(card.id, alice.id, { status: "listed" });
check("leaving sold drops fees + order refs", await (async () => {
  const c = await getCardForUser(card.id, alice.id);
  return [c?.soldFees, c?.ebayOrderId, c?.ebayLineItemId];
})(), [null, null, null]);

// --- recordCopiesSold: full sale flips the row ---------------------------
const single = await recordCopiesSold(card.id, alice.id, 1, 447.99, 555, { orderId: "ORD-2", lineItemId: "LI-2" });
check("full sale: same row goes sold with the eBay refs",
  [single?.sold.id === card.id, single?.sold.status, single?.sold.soldPrice, single?.sold.ebayOrderId, single?.remaining],
  [true, "sold", 447.99, "ORD-2", null]);
check("overbuy clamps to a full sale",
  (await recordCopiesSold(box.id, alice.id, 99, 10, 556))?.remaining, null);

// --- recordCopiesSold: partial sale splits -------------------------------
const stack = await createCard(alice.id, { ...CHARIZARD, cardName: "Pikachu", price: 12 });
await updateCard(stack.id, alice.id, { status: "listed", quantity: 3 });
const partial = await recordCopiesSold(stack.id, alice.id, 1, 12, 777, { orderId: "ORD-3", lineItemId: "LI-3" });
check("partial: a NEW sold row for the bought copies",
  [partial?.sold.id !== stack.id, partial?.sold.status, partial?.sold.quantity, partial?.sold.soldPrice, partial?.sold.ebayOrderId],
  [true, "sold", 1, 12, "ORD-3"]);
check("partial: listed row stays live, decremented",
  [partial?.remaining?.id, partial?.remaining?.status, partial?.remaining?.quantity],
  [stack.id, "listed", 2]);
check("both rows in the ledger afterwards",
  (await listCardsForUser(alice.id)).filter((c) => c.cardName === "Pikachu").length, 2);

// --- getPlatformStats: actual fees + estimate blend ----------------------
// Sold rows right now: card (447.99, fees NULL after the re-sale above? no —
// re-sold via recordCopiesSold with no fee sync yet), box (10, fees NULL),
// partial sold row (12, fees NULL). Give one of them an actual fee.
await setCardSoldFees(card.id, alice.id, 60);
const stats = await getPlatformStats();
const expectedEstimate = 60 + (10 + 12) * EBAY_FEE_RATE + 2 * EBAY_FLAT_FEE;
check("stats: gross sums sold prices", near(stats.grossRevenue, 447.99 + 10 + 12));
check("stats: fees = actuals + estimate for unfetched", near(stats.estimatedFees, expectedEstimate));
check("stats: net = gross - fees", near(stats.netRevenue, stats.grossRevenue - stats.estimatedFees));
check("stats: counts", [stats.soldCount >= 3, stats.listedCount >= 1], [true, true]);

// --- wishlist: dedupe, backfill, alert re-arm ----------------------------
const LUGIA = {
  id: "neo1-9", name: "Lugia", englishName: null, setName: "Neo Genesis",
  number: "9/111", imageSmall: "https://img.example/lugia.png", imageLarge: "", game: "pokemon", prices: [],
};
const w1 = await addToWishlist(alice.id, LUGIA, "en", 100);
const w2 = await addToWishlist(alice.id, LUGIA, "en", 999);
check("adding twice is a silent no-op (same row back)", [w1.id === w2.id, w2.price], [true, 100]);
check("wishlist has one row", (await listWishlist(alice.id)).length, 1);

await db.prepare("UPDATE wishlist_items SET card_id = NULL, game = NULL WHERE id = ?").run(w1.id);
check("legacy row learns card_id on re-add", await (async () => {
  const w = await addToWishlist(alice.id, LUGIA, "en", 100);
  return [w.cardId, w.game];
})(), ["neo1-9", "pokemon"]);

await setWishlistAlert(w1.id, alice.id, 80);
await db.prepare("UPDATE wishlist_items SET alerted_at = 123 WHERE id = ?").run(w1.id);
check("changing the target re-arms a fired alert", await (async () => {
  const w = await setWishlistAlert(w1.id, alice.id, 70);
  return [w?.alertPrice, w?.alertedAt];
})(), [70, null]);
check("clearing the alert", (await setWishlistAlert(w1.id, alice.id, null))?.alertPrice, null);

await removeFromWishlist(w1.id, mallory.id);
check("wrong user can't remove wishlist rows", (await listWishlist(alice.id)).length, 1);
await removeFromWishlist(w1.id, alice.id);
check("owner can", (await listWishlist(alice.id)).length, 0);

// --- price checks: the 1-hour dedupe window + backfill -------------------
const { logPriceCheck, listPriceChecks, deletePriceCheck } = await import(at("lib/server/priceChecks.ts"));
const LUGIA_CARD = { ...LUGIA, prices: [{ source: "tcgplayer", variant: "holofoil", label: "Holo", market: 100, currency: "USD" }] };
const pc1 = await logPriceCheck(alice.id, LUGIA_CARD, "en");
const pc2 = await logPriceCheck(alice.id, LUGIA_CARD, "en");
check("re-check within the hour refreshes, not stacks",
  [pc1.id === pc2.id, (await listPriceChecks(alice.id)).length], [true, 1]);
check("re-check backfills card_id/game/image onto legacy rows", await (async () => {
  await db.prepare("UPDATE price_checks SET card_id = NULL, game = NULL, image_url = NULL WHERE id = ?").run(pc1.id);
  const w = await logPriceCheck(alice.id, LUGIA_CARD, "en");
  return [w.cardId, w.game, w.imageUrl];
})(), ["neo1-9", "pokemon", "https://img.example/lugia.png"]);
check("a different card is a new row", await (async () => {
  await logPriceCheck(alice.id, { ...LUGIA_CARD, id: "base1-4", name: "Charizard", number: "4/102" }, "en");
  return (await listPriceChecks(alice.id)).length;
})(), 2);
await deletePriceCheck(pc1.id, mallory.id);
check("wrong user can't delete a lookup", (await listPriceChecks(alice.id)).length, 2);

console.log(failures === 0 ? "\nAll ledger/fee checks passed" : `\n${failures} ledger/fee check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
