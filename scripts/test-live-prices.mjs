/**
 * Inventory live prices (lib/server/livePrices.ts). Run: npm run test:liveprices
 *
 * Pins: a draft whose price the seller never touched is rewritten to today's
 * market through its condition; a hand-set price (price_locked) is reported
 * but never rewritten; a listed row is reported but never rewritten; sold
 * rows and rows without a catalog id are skipped; unchanged rows come back
 * applied = false; the PATCH-side lock flag round-trips through updateCard.
 *
 * Same throwaway-db trick as test-quota.mjs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-liveprices-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { createUser } = await import(at("lib/server/users.ts"));
const { createCard, updateCard, getCardForUser } = await import(at("lib/server/cards.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { refreshLivePrices } = await import(at("lib/server/livePrices.ts"));
const { askingPriceFor, CONDITION_MULTIPLIER } = await import(at("lib/listing.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const user = await createUser("L", "live@example.com", "hunter22");
const base = {
  cardName: "Pikachu",
  setName: "Base Set",
  cardNumber: "58",
  imageUrl: "",
  condition: "Near Mint",
  game: "pokemon",
};
const mk = (extra) => createCard(user.id, { ...base, ...extra });

// Catalog: one card at $20 today, another at $100.
await recordPoint("base1-58", "pokemon", "normal", "tcgplayer", "USD", 20);
await recordPoint("base1-4", "pokemon", "holofoil", "tcgplayer", "USD", 100);

const draft = await mk({ price: 12.5, catalogCardId: "base1-58" });
const played = await mk({ price: 12.5, catalogCardId: "base1-58", condition: "Lightly Played" });
const locked = await mk({ price: 9, catalogCardId: "base1-58" });
await updateCard(locked.id, user.id, { price: 9, priceLocked: true });
const listed = await mk({ price: 30, catalogCardId: "base1-4" });
await updateCard(listed.id, user.id, { status: "listed", listedAt: Date.now() });
const sold = await mk({ price: 30, catalogCardId: "base1-4" });
await updateCard(sold.id, user.id, { status: "sold", soldPrice: 30, soldAt: Date.now() });
const orphan = await mk({ price: 3 });
const current = await mk({ price: 20, catalogCardId: "base1-58" });

console.log("askingPriceFor");
check("NM = market rounded", askingPriceFor(20, "Near Mint"), 20);
check("LP applies the condition multiplier", askingPriceFor(20, "Lightly Played"), Math.round(20 * CONDITION_MULTIPLIER["Lightly Played"] * 100) / 100);
check("unknown condition counts as NM", askingPriceFor(20, "Slabbed"), 20);
check("no market → 0", askingPriceFor(0, "Near Mint"), 0);

console.log("refreshLivePrices");
const out = await refreshLivePrices(user.id);
const by = Object.fromEntries(out.map((p) => [p.cardId, p]));
const pick = (p, keys) => (p ? Object.fromEntries(keys.map((k) => [k, p[k]])) : p);
check("untouched draft rewritten to today's market", pick(by[draft.id], ["applied", "suggested", "previous"]), { applied: true, suggested: 20, previous: 12.5 });
check("… and the ledger row moved", (await getCardForUser(draft.id, user.id)).price, 20);
check("LP draft goes through its condition", by[played.id]?.suggested, 17);
check("hand-set price reported, not rewritten", pick(by[locked.id], ["applied", "market"]), { applied: false, market: 20 });
check("… ledger untouched", (await getCardForUser(locked.id, user.id)).price, 9);
check("listed row reported, not rewritten", pick(by[listed.id], ["applied", "suggested"]), { applied: false, suggested: 100 });
check("… ledger untouched", (await getCardForUser(listed.id, user.id)).price, 30);
check("sold row skipped", sold.id in by, false);
check("row without a catalog id skipped", orphan.id in by, false);
check("already-current row: applied = false", by[current.id]?.applied, false);
check("lock flag round-trips", (await getCardForUser(locked.id, user.id)).priceLocked, true);
check("fresh rows are unlocked", (await getCardForUser(draft.id, user.id)).priceLocked, false);

console.log(failures === 0 ? "\nAll live-price checks passed." : `\n${failures} live-price check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
