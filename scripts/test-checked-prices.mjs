/**
 * Hand eBay sold checks that fix a caught price (lib/server/checkedPrices.ts). Run: npm run test:checked
 *
 * Pins: TCGplayer's number is replaced only while it is more than 25% off the
 * checked price and the check is at most 30 days old; the trailing wrong
 * stretch of a series is fixed and nothing before it; the nightly writer and a
 * saved lookup both store the checked price; the check retires itself once
 * TCGplayer is back within 25%; live rows on their way to a screen show the
 * checked price with `ebayChecked` and no flag.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-checked-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { checkedValue, correctTail, putCheck, activeChecks, clearCheckedMemo, CHECKED_MAX_DAYS } = await import(at("lib/server/checkedPrices.ts"));
const { upsertSeriesRows } = await import(at("lib/server/priceBulkWrite.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { withPriceFlags, clearTrustMemo } = await import(at("lib/server/priceTrustSite.ts"));
const { addDays, todayUtc, encodePrices, decodePrices } = await import(at("lib/priceSeries.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const TODAY = todayUtc();
const C = { game: "pokemon", cardId: "xy0-26", variant: "normal", usd: 43, n: 3, day: TODAY, note: "test" };

console.log("pure rule");
check("$64.88 vs a $43 check -> $43", checkedValue(64.88, C, TODAY), 43);
check("$50 is within 25% of $43 -> kept", checkedValue(50, C, TODAY), 50);
check("$30 is more than 25% under $43 -> $43", checkedValue(30, C, TODAY), 43);
check("no check -> kept", checkedValue(64.88, undefined, TODAY), 64.88);
check(`a check ${CHECKED_MAX_DAYS + 1} days old no longer binds`, checkedValue(64.88, { ...C, day: addDays(TODAY, -(CHECKED_MAX_DAYS + 1)) }, TODAY), 64.88);
check("a check dated in the future does not bind yet", checkedValue(64.88, { ...C, day: addDays(TODAY, 1) }, TODAY), 64.88);

const start = addDays(TODAY, -6);
const tail = correctTail(start, [42, 44, null, 60, 63, 64, 64.88], C, TODAY);
check("only the trailing wrong stretch is fixed", tail.prices, [42, 44, null, 43, 43, 43, 43]);
check("the raw last point and its day ride along", [tail.raw, tail.rawDay], [64.88, TODAY]);
check("a series that is fine is left alone", correctTail(start, [42, 44, 45], C, TODAY).changed, false);
check("a stretch already fixed: a re-run touches today only", correctTail(start, [42, 43, 43, 66], C, TODAY).prices, [42, 43, 43, 43]);
check("never further back than 30 days before the check", correctTail(addDays(TODAY, -40), Array(41).fill(70), C, TODAY).prices.filter((v) => v === 43).length, CHECKED_MAX_DAYS + 1);

console.log("writers");
await putCheck(C);
await upsertSeriesRows([
  { cardId: "xy0-26", game: "pokemon", variant: "normal", source: "tcgplayer", currency: "USD", startDay: start, prices: encodePrices([42, 44, 45, 60, 63, 64, 64.88]), updatedDay: TODAY },
  { cardId: "xy0-26", game: "pokemon", variant: "normal", source: "cardmarket", currency: "EUR", startDay: start, prices: encodePrices([30, 31, 32, 60, 63, 64, 64.88]), updatedDay: TODAY },
  { cardId: "base1-4", game: "pokemon", variant: "holofoil", source: "tcgplayer", currency: "USD", startDay: start, prices: encodePrices([400, 410, 420, 430, 440, 450, 460]), updatedDay: TODAY },
]);
const read = async (id, variant, source) => decodePrices((await db.prepare("SELECT prices FROM price_series WHERE card_id = ? AND variant = ? AND source = ?").get(id, variant, source)).prices);
check("the nightly write stores the checked price over the wrong stretch", await read("xy0-26", "normal", "tcgplayer"), [42, 44, 45, 43, 43, 43, 43]);
check("another source's series is not touched", (await read("xy0-26", "normal", "cardmarket")).slice(-1), [64.88]);
check("an unchecked card is not touched", (await read("base1-4", "holofoil", "tcgplayer")).slice(-1), [460]);
const row = await db.prepare("SELECT tcg_usd, tcg_day, off_day FROM price_checked WHERE card_id = 'xy0-26'").get();
check("TCGplayer's raw number is noted on the check, still on", [row.tcg_usd, row.tcg_day, row.off_day], [64.88, TODAY, null]);

await recordPoint("xy0-26", "pokemon", "normal", "tcgplayer", "USD", 65.5, TODAY);
check("a saved lookup stores the checked price too", (await read("xy0-26", "normal", "tcgplayer")).slice(-1), [43]);
await recordPoint("xy0-26", "pokemon", "normal", "tcgplayer", "USD", 46, TODAY);
check("a lookup within 25% stores TCGplayer's own number", (await read("xy0-26", "normal", "tcgplayer")).slice(-1), [46]);

console.log("live rows");
clearTrustMemo();
const card = (market) => ({ id: "xy0-26", game: "pokemon", name: "Snorlax", setName: "Kalos Starter Set", setSeries: "XY", number: "26", rarity: null, imageSmall: "", imageLarge: "", englishName: null, prices: [{ source: "tcgplayer", variant: "normal", label: "Normal", currency: "USD", market, low: null, high: null }] });
const [fixed] = await withPriceFlags([card(64.88)], TODAY);
check("a live $64.88 row shows the checked $43", fixed.prices[0].market, 43);
check("…marked ebayChecked with TCGplayer's number, no flag", [fixed.prices[0].ebayChecked?.was, fixed.prices[0].untrusted ?? null], [64.88, null]);
const [fine] = await withPriceFlags([card(45)], TODAY);
check("a live row within 25% is TCGplayer's own number", [fine.prices[0].market, fine.prices[0].ebayChecked ?? null], [45, null]);

console.log("retiring");
await upsertSeriesRows([{ cardId: "xy0-26", game: "pokemon", variant: "normal", source: "tcgplayer", currency: "USD", startDay: start, prices: encodePrices([42, 44, 45, 43, 43, 43, 47]), updatedDay: TODAY }]);
const once = await db.prepare("SELECT tcg_usd, off_day FROM price_checked WHERE card_id = 'xy0-26'").get();
check("one day back within 25% notes it, the check stays on (10-21 Base Set Charizard)", [once.tcg_usd, once.off_day], [47, null]);
const NEXT = addDays(TODAY, 1);
const rowidOf = async () => (await db.prepare("SELECT rowid AS r FROM price_series WHERE card_id = 'xy0-26' AND variant = 'normal' AND source = 'tcgplayer'").get()).r;
const rowidBefore = await rowidOf();
await upsertSeriesRows([{ cardId: "xy0-26", game: "pokemon", variant: "normal", source: "tcgplayer", currency: "USD", startDay: start, prices: encodePrices([42, 44, 45, 43, 43, 43, 47, 46]), updatedDay: NEXT }]);
// 10-23: REPLACE deleted and re-inserted the row (a new rowid, every index rewritten: Turso bills each); the upsert updates it in place.
check("the daily write updates the series row in place (same rowid)", await rowidOf(), rowidBefore);
const off = await db.prepare("SELECT tcg_usd, off_day FROM price_checked WHERE card_id = 'xy0-26'").get();
check("a second day back within 25% retires the check", [off.tcg_usd, off.off_day], [46, NEXT]);
clearCheckedMemo();
check("a retired check is no longer read", (await activeChecks()).size, 0);
check("the points it fixed stay fixed", await read("xy0-26", "normal", "tcgplayer"), [42, 44, 45, 43, 43, 43, 47, 46]);

// The 10-19/10-20 shape: $600 check, TCGplayer $724.99 (in band) one day, $954.65 the next -> still on, the $954.65 fixed.
await putCheck({ ...C, cardId: "base1-4", variant: "holofoil", usd: 600 });
const s2 = addDays(TODAY, -2);
await upsertSeriesRows([{ cardId: "base1-4", game: "pokemon", variant: "holofoil", source: "tcgplayer", currency: "USD", startDay: s2, prices: encodePrices([600, 600, 724.99]), updatedDay: TODAY }]);
await upsertSeriesRows([{ cardId: "base1-4", game: "pokemon", variant: "holofoil", source: "tcgplayer", currency: "USD", startDay: s2, prices: encodePrices([600, 600, 724.99, 954.65]), updatedDay: NEXT }]);
const flip = await db.prepare("SELECT tcg_usd, off_day FROM price_checked WHERE card_id = 'base1-4'").get();
check("in band one day, out the next: the check stays on and fixes the jump", [flip.off_day, flip.tcg_usd, (await read("base1-4", "holofoil", "tcgplayer")).slice(-2)], [null, 954.65, [724.99, 600]]);

await putCheck({ ...C, cardId: "gym2-3-1st", variant: "1stEditionHolofoil", usd: 200 });
await upsertSeriesRows([{ cardId: "gym2-3-1st", game: "pokemon", variant: "1stEditionHolofoil", source: "tcgplayer", currency: "USD", startDay: start, prices: encodePrices([200, 200, 261]), updatedDay: addDays(TODAY, 1) }]);
const kept = await db.prepare("SELECT tcg_usd, off_day FROM price_checked WHERE card_id = 'gym2-3-1st'").get();
check("a row whose last point is not the day written does not note or retire", [kept.tcg_usd, kept.off_day], [null, null]);

console.log("stopped lines");
// 10-21 Copycat RP01-EN092: the Yu-Gi-Oh! line stopped, so the app card has no TCGplayer row at all; a binding check prints.
await putCheck({ ...C, game: "yugioh", cardId: "ygo-78162", variant: "normal", usd: 544.99, n: 1 });
clearTrustMemo();
const copycat = (prices) => ({ id: "ygo-78162", game: "yugioh", name: "Copycat", setName: "Retro Pack", setSeries: "", number: "RP01-EN092", rarity: null, imageSmall: "", imageLarge: "", englishName: null, prices });
const [cc] = await withPriceFlags([copycat([])], TODAY);
check("no TCGplayer row + a binding check: the checked price as the card's row", [cc.prices.length, cc.prices[0]?.market, cc.prices[0]?.variant, cc.prices[0]?.ebayChecked?.n], [1, 544.99, "normal", 1]);
const [other] = await withPriceFlags([{ ...copycat([]), id: "ygo-564239" }], TODAY);
check("…another card (the 2020 reprint) gets nothing from it", other.prices.length, 0);
const [stale] = await withPriceFlags([copycat([])], addDays(TODAY, CHECKED_MAX_DAYS + 1));
check("…and a check past CHECKED_MAX_DAYS prints nothing", stale.prices.length, 0);

console.log(failures === 0 ? "\nall green" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
