/**
 * "Post cards" on /admin/prices (lib/server/postCheck.ts, 10-18). Run: npm run test:postcheck
 *
 * Pins: each registered video's cards are listed with their price and an eBay SOLD link (raw only, the finish
 * word for a 1st Edition), a "Looks right" mark is kept per day, a card with a binding eBay sold check reads as
 * fixed, and a slot whose hour has passed is marked past (its video is not remade).
 *
 * Throwaway db: chdir to a temp dir before any import.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-postcheck-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { postSlots, setMark, slotAt, postSoldUrl } = await import(at("lib/server/postCheck.ts"));
const { putCheck, storedRaw, isOffCheck } = await import(at("lib/server/checkedPrices.ts"));
const { db } = await import(at("lib/db.ts"));
const { encodePrices } = await import(at("lib/priceSeries.ts"));
const { setSetting } = await import(at("lib/server/settings.ts"));
const { tiktokKey } = await import(at("lib/socialTiktok.ts"));
const { etDay } = await import(at("lib/time.ts"));
const { todayUtc } = await import(at("lib/priceSeries.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const url = decodeURIComponent(postSoldUrl({ name: "Brock's Ninetales", number: "3", setName: "Gym Challenge (1st Edition)", variant: "1stEditionHolofoil" }));
check("eBay sold link: name, number, set, 1st edition, no slabs, sold only", [url.includes("Brock's Ninetales 3 Gym Challenge 1st edition"), url.includes("-psa"), url.includes("LH_Sold=1")], [true, true, true]);

// Noon Eastern on a fixed day: 7am has posted, 1pm and 7pm have not.
const NOON = Date.parse("2026-10-18T16:00:00Z");
const DAY = etDay(NOON);
check("7am has posted by noon", slotAt("morning", DAY) <= NOON, true);
check("1pm has not", slotAt("midday", DAY) > NOON, true);

const cards = [
  { cardId: "xy0-26", name: "Snorlax", number: "26", setName: "Kalos Starter Set", variant: "normal", to: 64.88 },
  { cardId: "swsh4-138", name: "Rayquaza", number: "138", setName: "Vivid Voltage", variant: "holofoil", to: 22.68 },
  { cardId: "bw10-97", name: "Genesect-EX", number: "97", setName: "Plasma Blast", variant: "holofoil", to: 284.8 },
];
await setSetting(tiktokKey("midday", DAY), JSON.stringify({ title: "Pokémon movers of the week", game: "pokemon", cards }));
await setMark(DAY, "pokemon", "swsh4-138", "holofoil", true);
await putCheck({ game: "pokemon", cardId: "xy0-26", variant: "normal", usd: 43, n: 3, day: todayUtc(NOON), note: "test" });

const slots = await postSlots(NOON);
const midday = slots.find((s) => s.day === DAY && s.slot === "midday");
check("six slots listed (today + tomorrow)", slots.length, 6);
check("the 1pm video's cards, in order", midday.cards.map((c) => c.cardId), ["xy0-26", "swsh4-138", "bw10-97"]);
check("statuses: fixed / looks right / to check", midday.cards.map((c) => c.status), ["fixed", "ok", "unchecked"]);
check("the fixed card carries its sold price", midday.cards[0].fixedUsd, 43);
check("1pm is not past at noon", midday.past, false);
check("7am is past at noon", slots.find((s) => s.day === DAY && s.slot === "morning").past, true);
check("labelled Today 1pm", midday.label, "Today 1pm");

await setMark(DAY, "pokemon", "swsh4-138", "holofoil", false);
check("undo drops the mark", (await postSlots(NOON)).find((s) => s.day === DAY && s.slot === "midday").cards[1].status, "unchecked");

// "Fix" with a sold price that agrees with our own number is a "Looks right" (a check there would retire itself at
// once and the row would read unchecked: 10-18 Mew δ $400 vs TCGplayer $410.42).
await db
  .prepare("INSERT INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day) VALUES (?, ?, ?, 'tcgplayer', 'USD', ?, ?, ?)")
  .run("pop5-3", "pokemon", "normal", "2026-10-15", encodePrices([395, 410.42, null]), "2026-10-17");
check("our stored number = the last priced day", await storedRaw("pokemon", "pop5-3", "normal"), 410.42);
check("no stored series = null", await storedRaw("pokemon", "pop5-3", "holofoil"), null);
check("sold $400 agrees with $410.42 (no fix)", isOffCheck(410.42, 400), false);
check("sold $43 does not agree with $64.88 (fix)", isOffCheck(64.88, 43), true);

console.log(failures === 0 ? "\nall green" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
