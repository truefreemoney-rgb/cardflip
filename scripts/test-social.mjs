/**
 * Social autopilot content engine (lib/server/social.ts). Run: npm run test:social
 *
 * Pins: movers rank by |%| over 7 days and skip cheap cards; the other game
 * never leaks in; stale series (not updated in 3 days) never post; card of
 * the day is the same pick for the same day and never a cheap card; captions
 * carry no exclamation marks and end on cardflip.io.
 *
 * Same throwaway-db trick as test-cards.mjs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-social-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { topMovers, cardOfTheDay, socialDrafts, moversCaption, setSpotlight, setCaption } = await import(at("lib/server/social.ts"));
const { addDays } = await import(at("lib/priceSeries.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const TODAY = "2026-09-10";
const day = (back) => addDays(TODAY, -back);

async function catalog(id, name, num) {
  await db.prepare(
    "INSERT INTO en_cards (id, name, set_id, set_name, local_id, image_url, synced_at) VALUES (?, ?, 'sv1', 'Scarlet & Violet', ?, ?, 0)",
  ).run(id, name, num, `https://assets.tcgdex.net/en/sv/sv1/${num}/low.webp`);
}
async function series(id, from, to, { stale = false } = {}) {
  await recordPoint(id, "pokemon", "normal", "tcgplayer", "USD", from, day(7));
  // the new price holds 3 days (HELD_DAYS), the way a real move does
  for (const back of stale ? [4] : [2, 1, 0]) await recordPoint(id, "pokemon", "normal", "tcgplayer", "USD", to, day(back));
}

await catalog("sv1-1", "Sprigatito", "1");     await series("sv1-1", 0.2, 0.6);          // +200% but cheap: skipped
await catalog("sv1-2", "Miraidon ex", "81");   await series("sv1-2", 10, 15);            // +50%
await catalog("sv1-3", "Koraidon ex", "125");  await series("sv1-3", 40, 20);            // -50%
await catalog("sv1-4", "Gardevoir ex", "86");  await series("sv1-4", 20, 24);            // +20%
await catalog("sv1-5", "Arcanine ex", "32");   await series("sv1-5", 30, 30.1);          // flat: skipped
await catalog("sv1-6", "Old holo", "999");     await series("sv1-6", 10, 100, { stale: true }); // stale: skipped
await catalog("sv1-8", "Grass Energy", "88");  await recordPoint("sv1-8", "pokemon", "normal", "tcgplayer", "USD", 10, day(7)); for (const b of [3, 2, 1]) await recordPoint("sv1-8", "pokemon", "normal", "tcgplayer", "USD", 10, day(b)); await recordPoint("sv1-8", "pokemon", "normal", "tcgplayer", "USD", 74.99, day(0)); // one-day spike: skipped
await catalog("sv1-9", "Pikachu", "25");       await series("sv1-9", 12, 15.6);         // +30%
// priced only twice this week (day 7 = $10, day 3 = $14, nothing since): the $14 carries forward and holds
await catalog("sv1-10", "Sparse", "60");      await recordPoint("sv1-10", "pokemon", "normal", "tcgplayer", "USD", 10, day(7)); await recordPoint("sv1-10", "pokemon", "normal", "tcgplayer", "USD", 14, day(3));
// last priced a month ago and once today: no week-ago price, so no move (a stale point must not stand in for last week)
await catalog("sv1-11", "Ancient", "61");     await recordPoint("sv1-11", "pokemon", "normal", "tcgplayer", "USD", 10, day(30)); await recordPoint("sv1-11", "pokemon", "normal", "tcgplayer", "USD", 40, day(0));
await catalog("sv1-7", "Pricey", "250");       await recordPoint("sv1-7", "pokemon", "normal", "tcgplayer", "USD", 80, day(0)); // no 7d point: COTD only
await db.prepare("INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, image_url, synced_at) VALUES (?, ?, 'dmu', 'Dominaria United', '107', 'https://cards.scryfall.io/normal/x.jpg', 0)").run("mtg-1", "Sheoldred");
await recordPoint("mtg-1", "mtg", "normal", "tcgplayer", "USD", 5, day(7));
await recordPoint("mtg-1", "mtg", "normal", "tcgplayer", "USD", 50, day(0)); // other game

console.log("topMovers");
const movers = await topMovers("pokemon", TODAY);
check("ranked by |%|, cheap/flat/stale/spike/other game skipped", movers.map((m) => m.cardId), ["sv1-2", "sv1-3", "sv1-10", "sv1-9", "sv1-4"]);
check("gainers only for the 1pm post", (await topMovers("pokemon", TODAY, { direction: "up" })).map((m) => m.cardId), ["sv1-2", "sv1-10", "sv1-9", "sv1-4"]);
check("a month-old point never stands in for last week's price", movers.some((m) => m.cardId === "sv1-11"), false);
check("a one-day spike is not a move (Grass Energy +650%)", movers.some((m) => m.cardId === "sv1-8"), false);
check("pct signed", movers.map((m) => Math.round(m.pct)), [50, -50, 40, 30, 20]);
check("art upgraded to high.webp", movers[0].imageUrl.endsWith("/high.webp"));
check("catalog fields joined", [movers[0].name, movers[0].number], ["Miraidon ex", "81"]);

console.log("cardOfTheDay");
const a = await cardOfTheDay("pokemon", TODAY);
const b = await cardOfTheDay("pokemon", TODAY);
check("same day, same pick", a?.cardId, b?.cardId);
check("never a cheap card", a && a.to >= 15);
const picks = new Set();
for (let i = 0; i < 30; i++) picks.add((await cardOfTheDay("pokemon", day(i)))?.cardId);
check("the pool cycles across days", picks.size > 1);
check("card with no 7d point is flat, not NaN", Number.isFinite((await cardOfTheDay("pokemon", TODAY))?.pct));

console.log("captions / drafts");
const drafts = await socialDrafts("pokemon", TODAY);
check("two drafts: movers + set spotlight", drafts.map((d) => d.kind), ["movers", "set"]);

console.log("setSpotlight");
const spot = await setSpotlight("pokemon", TODAY);
check("one set, its five priciest fresh cards, dearest first", [spot?.setName, spot?.cards.map((c) => c.cardId)], ["Scarlet & Violet", ["sv1-7", "sv1-11", "sv1-5", "sv1-4", "sv1-3"]]);
check("same day, same set", (await setSpotlight("pokemon", TODAY))?.setId, spot?.setId);
check("caption names the set and every card, no exclamation marks", [spot && setCaption("pokemon", spot).includes("Scarlet & Violet"), spot?.cards.every((c) => setCaption("pokemon", spot).includes(c.name)), spot && setCaption("pokemon", spot).includes("!")], [true, true, false]);
const wide = await setSpotlight("pokemon", TODAY, { minCards: 9 });
const spike = wide?.cards.find((c) => c.cardId === "sv1-8");
check("a one-day spike ranks on the week's median, no % claimed (Pikachu Star $3,217 → $900)", [spike?.to, spike?.unsettled, spike?.pct, wide?.cards.indexOf(spike)], [10, true, 0, 8]);
check("spike line in the caption carries no week claim", setCaption("pokemon", wide).includes("Grass Energy #88: $10.00\n"));
check("a set short of priced cards is never picked", await setSpotlight("pokemon", TODAY, { minCards: 10 }), null);
check("Magic has no set spotlight", await setSpotlight("mtg", TODAY), null);
for (const d of drafts) {
  check(`${d.kind}: no exclamation marks`, d.caption.includes("!"), false);
  check(`${d.kind}: ends on cardflip.io`, d.caption.trimEnd().endsWith("cardflip.io"));
  check(`${d.kind}: image path carries day`, d.imagePath.includes(`day=${TODAY}`));
}
check("movers caption lists every mover", movers.every((m) => moversCaption("pokemon", movers).includes(m.name)));
check("thin data → no drafts at all (no movers, no set)", (await socialDrafts("mtg", TODAY)).map((d) => d.kind), []);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
