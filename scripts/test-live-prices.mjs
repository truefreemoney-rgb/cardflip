/**
 * Inventory live prices (lib/server/livePrices.ts). Run: npm run test:liveprices
 *
 * Pins: a draft whose price the seller never touched is rewritten to today's
 * market through its condition; a hand-set price (price_locked) is reported
 * but never rewritten; a listed row is reported but never rewritten; sold
 * rows and rows without a catalog id are skipped; unchanged rows come back
 * applied = false; the PATCH-side lock flag round-trips through updateCard.
 * The site price guard (priceTrustSite): a card whose market the rule flags is
 * reported with a flag and no suggestion, its stored draft price and its scan
 * price is left alone, an unlocked draft's market-written price is blanked to 0,
 * and a locked or listed flagged row keeps its price.
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
const { costCoveredPrice } = await import(at("lib/fees.ts"));
const { db } = await import(at("lib/db.ts"));
const { addDays, todayUtc } = await import(at("lib/priceSeries.ts"));
const { liquidPrices, flatPrices, junkPrices, recordSeries } = await import("./lib/liquid-series.mjs");

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
// $100+ needs a real history: a one-point series is "unverified" to the price guard.
await recordSeries(recordPoint, addDays, todayUtc(), "base1-4", "pokemon", "holofoil", liquidPrices(100));
// Junk: a round $500 for 87 days (Deoxys), and a healthy $300 card.
await recordSeries(recordPoint, addDays, todayUtc(), "junk-deoxys", "pokemon", "holofoil", junkPrices(500)); // hidden: a 5x spike that never came back
await recordSeries(recordPoint, addDays, todayUtc(), "stale-deoxys", "pokemon", "holofoil", flatPrices(500, 87)); // stale (10-02): shown with a note
await recordSeries(recordPoint, addDays, todayUtc(), "fine-300", "pokemon", "holofoil", liquidPrices(300));

const draft = await mk({ price: 12.5, catalogCardId: "base1-58" });
const played = await mk({ price: 12.5, catalogCardId: "base1-58", condition: "Lightly Played" });
const locked = await mk({ price: 9, catalogCardId: "base1-58" });
await updateCard(locked.id, user.id, { price: 9, priceLocked: true });
const listed = await mk({ price: 30, catalogCardId: "base1-4" });
await updateCard(listed.id, user.id, { status: "listed", listedAt: Date.now() });
const sold = await mk({ price: 30, catalogCardId: "base1-4" });
await updateCard(sold.id, user.id, { status: "sold", soldPrice: 30, soldAt: Date.now() });
const orphan = await mk({ price: 3 });
// Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD): the market ask now carries the costs, so an already-current row sits at the covered price.
const current = await mk({ price: costCoveredPrice(20), catalogCardId: "base1-58" });
// A row from before scan_price existed: nulled, to be backfilled from the series on its scan day.
const old = await mk({ price: 12.5, catalogCardId: "base1-58", condition: "Lightly Played" });
await db.prepare("UPDATE cards SET scan_price = NULL WHERE id = ?").run(old.id);
// Magic foil (09-28): the row keeps the finish it was scanned as; the refresh
// must price it off the foil series, not the default nonfoil one.
await recordPoint("mtg-bolt", "mtg", "nonfoil", "tcgplayer", "USD", 2);
await recordPoint("mtg-bolt", "mtg", "foil", "tcgplayer", "USD", 50);
const foil = await mk({ price: 1, catalogCardId: "mtg-bolt", game: "mtg", cardName: "Lightning Bolt", variant: "foil" });
const plain = await mk({ price: 1, catalogCardId: "mtg-bolt", game: "mtg", cardName: "Lightning Bolt" });

const junkDraft = await mk({ price: 480, catalogCardId: "junk-deoxys", cardName: "Deoxys" });
const junkLocked = await mk({ price: 450, catalogCardId: "junk-deoxys", cardName: "Deoxys" });
await updateCard(junkLocked.id, user.id, { price: 450, priceLocked: true });
const junkListed = await mk({ price: 500, catalogCardId: "junk-deoxys", cardName: "Deoxys" });
await updateCard(junkListed.id, user.id, { status: "listed", listedAt: Date.now() });
const junkOld = await mk({ price: 480, catalogCardId: "junk-deoxys", cardName: "Deoxys" });
await db.prepare("UPDATE cards SET scan_price = NULL WHERE id = ?").run(junkOld.id);
const fine = await mk({ price: 250, catalogCardId: "fine-300", cardName: "Fine" });
const staleDraft = await mk({ price: 480, catalogCardId: "stale-deoxys", cardName: "Stale" });
// The scanner saves its quick-sale price (88% of market) with the market ask beside it (10-01: a flat
// $10,000 Charizard read "added at $8,799.99, up 13.6%").
// Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD): the scanner saves the market ask (costs included) as the scan price.
const quickScan = await mk({ price: 17.59, scanPrice: costCoveredPrice(20), catalogCardId: "base1-58" });

console.log("askingPriceFor");
// Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
check("NM = market plus fees and postage", askingPriceFor(20, "Near Mint"), costCoveredPrice(20));
check("LP applies the condition multiplier", askingPriceFor(20, "Lightly Played"), costCoveredPrice(Math.round(20 * CONDITION_MULTIPLIER["Lightly Played"] * 100) / 100));
check("unknown condition counts as NM", askingPriceFor(20, "Slabbed"), costCoveredPrice(20));
check("no market → 0", askingPriceFor(0, "Near Mint"), 0);

console.log("refreshLivePrices");
const out = await refreshLivePrices(user.id);
const by = Object.fromEntries(out.map((p) => [p.cardId, p]));
const pick = (p, keys) => (p ? Object.fromEntries(keys.map((k) => [k, p[k]])) : p);
check("untouched draft rewritten to today's market", pick(by[draft.id], ["applied", "suggested", "previous"]), { applied: true, suggested: costCoveredPrice(20), previous: 12.5 });
check("… and the ledger row moved", (await getCardForUser(draft.id, user.id)).price, costCoveredPrice(20));
check("LP draft goes through its condition", by[played.id]?.suggested, costCoveredPrice(17));
check("hand-set price reported, not rewritten", pick(by[locked.id], ["applied", "market"]), { applied: false, market: 20 });
check("… ledger untouched", (await getCardForUser(locked.id, user.id)).price, 9);
check("listed row reported, not rewritten", pick(by[listed.id], ["applied", "suggested"]), { applied: false, suggested: costCoveredPrice(100) });
check("… ledger untouched", (await getCardForUser(listed.id, user.id)).price, 30);
check("sold row skipped", sold.id in by, false);
check("row without a catalog id skipped", orphan.id in by, false);
check("already-current row: applied = false", by[current.id]?.applied, false);
check("lock flag round-trips", (await getCardForUser(locked.id, user.id)).priceLocked, true);
check("fresh rows are unlocked", (await getCardForUser(draft.id, user.id)).priceLocked, false);
check("scan price stored on create", (await getCardForUser(draft.id, user.id)).scanPrice, 12.5);
check("scanned reported from the stored value", by[draft.id]?.scanned, 12.5);
const quickRow = await getCardForUser(quickScan.id, user.id);
check("quick-sale scan: the market ask is the scan price, so a flat market shows no move", [quickRow.scanPrice, quickRow.price], [costCoveredPrice(20), costCoveredPrice(20)]);
check("older row: scanned backfilled from the series on its scan day (LP)", by[old.id]?.scanned, costCoveredPrice(17));
check("… and persisted", (await getCardForUser(old.id, user.id)).scanPrice, costCoveredPrice(17));
check("variant stored on create and read back", (await getCardForUser(foil.id, user.id)).variant, "foil");
check("Magic foil row refreshes off the foil series", by[foil.id]?.suggested, costCoveredPrice(50));
// $2 is a cheap card: value + fees + postage on top (09-30), same rule as the scanner.
check("… the nonfoil copy of the same card stays on nonfoil", by[plain.id]?.suggested, askingPriceFor(2, "Near Mint"));
check("variant PATCH: null clears it", await updateCard(plain.id, user.id, { variant: "etched" }).then(() => updateCard(plain.id, user.id, { variant: null })).then((c) => c?.variant ?? null), null);
// The "Added At" price belongs to one price series: a finish change or a printing swap clears it (10-01:
// a nonfoil $2.13 scan price beside a $5.15 foil price read as a 141% gain), the next refresh backfills it.
{
  const swap = await mk({ price: 3, scanPrice: 3, catalogCardId: "mtg-bolt", game: "mtg", cardName: "Lightning Bolt" });
  check("scan price survives an unrelated patch", (await updateCard(swap.id, user.id, { costBasis: 1 }))?.scanPrice, 3);
  check("finish change clears the scan price", (await updateCard(swap.id, user.id, { variant: "foil" }))?.scanPrice ?? null, null);
  await db.prepare("UPDATE cards SET scan_price = 3 WHERE id = ?").run(swap.id);
  check("same finish again keeps it", (await updateCard(swap.id, user.id, { variant: "foil" }))?.scanPrice, 3);
  check("printing swap clears the scan price", (await updateCard(swap.id, user.id, { catalogCardId: "base1-58" }))?.scanPrice ?? null, null);
}

console.log("the price guard");
check("flagged draft: reported with the flag and no suggestion; its market-written price is blanked (applied)", pick(by[junkDraft.id], ["applied", "suggested", "market"]), { applied: true, suggested: 0, market: 500 });
check("... the flag says why", [by[junkDraft.id]?.flag?.hard, by[junkDraft.id]?.flag?.reason.startsWith("spike")], [true, true]);
check("stale draft (flat $500 for 87 days): suggested and applied as usual, no flag, the note rides along", pick(by[staleDraft.id], ["flag", "market", "stale"]), { market: 500, stale: { days: 87 } });
check("... its suggestion is the normal market ask", by[staleDraft.id]?.suggested > 0, true);
check("... the stored 480 is blanked to 0 (the seller never typed it), and stays 0 on the next load", [(await getCardForUser(junkDraft.id, user.id)).price, (await refreshLivePrices(user.id)).find((p) => p.cardId === junkDraft.id)?.applied], [0, false]);
check("flagged locked and listed rows are flagged too and keep their price", [by[junkLocked.id]?.flag?.hard, by[junkListed.id]?.flag?.hard, (await getCardForUser(junkLocked.id, user.id)).price, (await getCardForUser(junkListed.id, user.id)).price], [true, true, 450, 500]);
check("flagged row: no scan-price backfill", [by[junkOld.id]?.scanned, (await getCardForUser(junkOld.id, user.id)).scanPrice], [null, null]);
check("a normal $300 card: suggested as before, no flag", pick(by[fine.id], ["applied", "suggested", "flag"]), { applied: true, suggested: costCoveredPrice(300) });
check("... and its draft price moved", (await getCardForUser(fine.id, user.id)).price, costCoveredPrice(300));

console.log(failures === 0 ? "\nAll live-price checks passed." : `\n${failures} live-price check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
