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
const { topMovers, cardOfTheDay, socialDrafts, moversCaption, setSpotlight, setCaption, markFeatured, recentlyFeatured } = await import(at("lib/server/social.ts"));
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
await catalog("sv1-8", "Grass Energy", "88");  await recordPoint("sv1-8", "pokemon", "normal", "tcgplayer", "USD", 10, day(7)); for (const b of [3, 2, 1]) await recordPoint("sv1-8", "pokemon", "normal", "tcgplayer", "USD", 10, day(b)); await recordPoint("sv1-8", "pokemon", "normal", "tcgplayer", "USD", 24.99, day(0)); // one-day spike: skipped
await catalog("sv1-9", "Pikachu", "25");       await series("sv1-9", 12, 15.6);         // +30%
// priced only twice this week (day 7 = $10, day 3 = $14, nothing since): the $14 carries forward and holds
await catalog("sv1-10", "Sparse", "60");      await recordPoint("sv1-10", "pokemon", "normal", "tcgplayer", "USD", 10, day(7)); await recordPoint("sv1-10", "pokemon", "normal", "tcgplayer", "USD", 14, day(3));
// last priced a month ago and once today: no week-ago price, so no move (a stale point must not stand in for last week)
await catalog("sv1-11", "Ancient", "61");     await recordPoint("sv1-11", "pokemon", "normal", "tcgplayer", "USD", 10, day(30)); await recordPoint("sv1-11", "pokemon", "normal", "tcgplayer", "USD", 40, day(0));
await catalog("sv1-7", "Pricey", "250");       await recordPoint("sv1-7", "pokemon", "normal", "tcgplayer", "USD", 80, day(0)); // no 7d point: COTD only
// 09-30 junk movers. Team Aqua's Corphish: a settled $8.64 common "up 479%" to $49.99 — under the floor on one end: skipped.
await catalog("sv2-12", "Corphish", "51");     for (const b of [13, 12, 11, 10, 9, 8, 7]) await recordPoint("sv2-12", "pokemon", "normal", "tcgplayer", "USD", 8.64, day(b)); for (const b of [2, 1, 0]) await recordPoint("sv2-12", "pokemon", "normal", "tcgplayer", "USD", 49.99, day(b));
// Fighting Energy: $10 all along, a two-day $37.49 spike a week ago, $10 again — the "drop" is the spike ending: skipped.
await catalog("sv2-13", "Fighting Energy", "93"); for (const b of [13, 12, 11, 10, 9]) await recordPoint("sv2-13", "pokemon", "normal", "tcgplayer", "USD", 11, day(b)); for (const b of [8, 7]) await recordPoint("sv2-13", "pokemon", "normal", "tcgplayer", "USD", 37.49, day(b)); for (const b of [2, 1, 0]) await recordPoint("sv2-13", "pokemon", "normal", "tcgplayer", "USD", 11, day(b));
await db.prepare("INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, image_url, synced_at) VALUES (?, ?, 'dmu', 'Dominaria United', '107', 'https://cards.scryfall.io/normal/x.jpg', 0)").run("mtg-1", "Sheoldred");
await recordPoint("mtg-1", "mtg", "normal", "tcgplayer", "USD", 5, day(7));
await recordPoint("mtg-1", "mtg", "normal", "tcgplayer", "USD", 50, day(0)); // other game

console.log("topMovers");
const movers = await topMovers("pokemon", TODAY);
check("ranked by |%|, cheap/flat/stale/spike/other game skipped", movers.map((m) => m.cardId), ["sv1-2", "sv1-3", "sv1-10", "sv1-9", "sv1-4"]);
check("gainers only for the 1pm post", (await topMovers("pokemon", TODAY, { direction: "up" })).map((m) => m.cardId), ["sv1-2", "sv1-10", "sv1-9", "sv1-4"]);
check("a month-old point never stands in for last week's price", movers.some((m) => m.cardId === "sv1-11"), false);
check("a one-day spike is not a move (Grass Energy +650%)", movers.some((m) => m.cardId === "sv1-8"), false);
check("a cheap card jumping past the floor is not a move (Corphish $8.64 → $49.99)", movers.some((m) => m.cardId === "sv2-12"), false);
// The real 09-30 shape: the plain card is $1.02 and only the REVERSE HOLO jumped. The plain print must still speak for the card.
await catalog("sv2-14", "Corphish plain", "51"); for (const b of [13, 10, 7, 4, 2, 1, 0]) await recordPoint("sv2-14", "pokemon", "normal", "tcgplayer", "USD", 1.02, day(b));
for (const b of [13, 10, 7]) await recordPoint("sv2-14", "pokemon", "reverseHolofoil", "tcgplayer", "USD", 12, day(b)); for (const b of [2, 1, 0]) await recordPoint("sv2-14", "pokemon", "reverseHolofoil", "tcgplayer", "USD", 49.99, day(b));
check("a pricey reverse holo never stands in for its cheap plain card", (await topMovers("pokemon", TODAY, { limit: 20 })).some((m) => m.cardId === "sv2-14"), false);
check("a spike unwinding is not a drop (Fighting Energy $37.49 → $11)", (await topMovers("pokemon", TODAY, { direction: "down", limit: 20 })).some((m) => m.cardId === "sv2-13"), false);
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

console.log("no-repeat rule (gains/drops)");
await markFeatured("pokemon", "movers", day(1), ["sv1-2"]);
check("a card in yesterday's gains post sits out today's", (await socialDrafts("pokemon", TODAY)).find((d) => d.kind === "movers")?.cardIds, ["sv1-10", "sv1-9", "sv1-4"]);
check("per kind: the drops post is not affected", (await recentlyFeatured("pokemon", "dips", TODAY)).size, 0);
await markFeatured("pokemon", "movers", TODAY, ["sv1-9"]);
check("a same-day entry does not count (re-render today stays stable)", (await recentlyFeatured("pokemon", "movers", TODAY)).has("sv1-9"), false);
await markFeatured("pokemon", "movers", day(8), ["sv1-4"]);
check("falls off after 7 days", (await recentlyFeatured("pokemon", "movers", TODAY)).has("sv1-4"), false);
check("the picture reads the same exclusion", (await topMovers("pokemon", TODAY, { direction: "up", exclude: await recentlyFeatured("pokemon", "movers", TODAY) })).map((m) => m.cardId), ["sv1-10", "sv1-9", "sv1-4"]);

// ---- the price guard (lib/server/priceTrust.ts, applied once in freshSeries): every pick reads the same clean Map.
// Its own day (09-30, the day the day plan pins the set "base4"): the fixtures above are stale by then, so only these rows are in the pool.
console.log("price guard (fixtures shaped like the 09-30 production rows)");
const { trustedUsdPrices } = await import(at("lib/server/priceTrustLoad.ts"));
const { getStageCards, getGameStageCards } = await import(at("lib/server/stageCards.ts"));
const { todayUtc } = await import(at("lib/priceSeries.ts"));
const PIN = "2026-09-30";
const pday = (back) => addDays(PIN, -back);
const warnings = [];
const realWarn = console.warn;
console.warn = (...a) => { warnings.push(a.join(" ")); };
const expand = (rle) => rle.flatMap(([v, n]) => Array(n).fill(v));
/** A liquid series: it moves every day, the way a real market does, ending on `to`. */
const liquid = (to, n = 60) => Array.from({ length: n }, (_, i) => Math.round((to * (1 + ((i * 7) % 5) / 100) - (i % 3)) * 100) / 100).concat(to);
/** A price_series row whose last point is `end` (default PIN), the way the price refresh leaves it. */
async function put(id, game, variant, source, currency, prices, end = PIN) {
  await db.prepare("INSERT INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, game, variant, source, currency, addDays(end, -(prices.length - 1)), JSON.stringify(prices), end);
}
async function real(id, name, num, setId, setName, usd, { eur = null, siblings = [], end = PIN } = {}) {
  await db.prepare("INSERT INTO en_cards (id, name, set_id, set_name, local_id, image_url, synced_at) VALUES (?, ?, ?, ?, ?, ?, 0)")
    .run(id, name, setId, setName, num, `https://assets.tcgdex.net/en/${setId}/${num}/low.webp`);
  await put(id, "pokemon", "holofoil", "tcgplayer", "USD", usd, end);
  for (const [variant, prices] of siblings) await put(id, "pokemon", variant, "tcgplayer", "USD", prices, end);
  if (eur != null) await put(id, "pokemon", "average", "cardmarket", "EUR", [eur], end);
}
const RAYQUAZA = expand([[101.83, 12], [104.42, 44], [104.66, 13], [107.19, 10], [536.45, 7], [599.46, 3], [679.27, 12], [null, 2], [679.27, 4], [767.94, 1], [1035.13, 9], [1013.27, 19]]);
const DEOXYS = expand([[174.15, 10], [180, 2], [240, 14], [500, 9], [310, 14], [500, 52], [null, 2], [500, 33]]);
const UMBREON = expand([[135.06, 6], [154.3, 5], [151.09, 3], [154.3, 36], [173.37, 6], [172.83, 45], [null, 2], [187.26, 3], [162.59, 4], [187.26, 14], [172.83, 7], [198.26, 5]]);
// Call of Legends analog: two junk cards (Rayquaza spike + 20x Cardmarket, Deoxys stuck at a round $500), Umbreon (Cardmarket agrees), a liquid card the second source calls 13x, and one it agrees with.
await real("col1-20", "Rayquaza", "20", "col1", "Call of Legends", RAYQUAZA, { eur: 45.13, siblings: [["reverseHolofoil", expand([[143.32, 100], [303.32, 13]])]] });
await real("col1-SL1", "Deoxys", "SL1", "col1", "Call of Legends", DEOXYS);
await real("col1-22", "Umbreon", "22", "col1", "Call of Legends", UMBREON, { eur: 77.57, siblings: [["reverseHolofoil", expand([[134.97, 40]])]] });
await real("col1-30", "Pikachu junk", "30", "col1", "Call of Legends", liquid(300), { eur: 20 });
await real("col1-31", "Pikachu real", "31", "col1", "Call of Legends", liquid(300), { eur: 250 });
for (const [n, p] of [[1, 30], [2, 40], [3, 60]]) await real(`col1-${n}`, `Legend ${n}`, String(n), "col1", "Call of Legends", liquid(p));
// The pinned set (dayPlan 09-30 = base4) drops below five clean cards once its junk goes: five cards >= $10, one a 6x Cardmarket gap.
for (const [n, p] of [[1, 20], [2, 25], [3, 35], [4, 45]]) await real(`base4-${n}`, `Base ${n}`, String(n), "base4", "Legendary Collection", liquid(p));
await real("base4-5", "Base junk", "5", "base4", "Legendary Collection", liquid(150), { eur: 20 });
// Sealed products sit in the same table with no catalog row: five of them made "tcgp-sealed" a set.
for (let n = 1; n <= 5; n++) await put(`tcgp-sealed-${n}`, "pokemon", "normal", "tcgplayer", "USD", liquid(50 + n));
// A card whose only price is an eBay graded row (sm3-150 PSA 10 shape) never posts.
await db.prepare("INSERT INTO en_cards (id, name, set_id, set_name, local_id, image_url, synced_at) VALUES ('sm3-150', 'Charizard GX', 'sm3', 'Burning Shadows', '150', 'https://assets.tcgdex.net/en/sm3/150/low.webp', 0)").run();
await put("sm3-150", "pokemon", "psa10", "ebay", "USD", liquid(2079));

const junk = new Set(["col1-20", "col1-SL1", "col1-30", "base4-5"]);
const guardSpot = await setSpotlight("pokemon", PIN);
check("the pinned set with junk in it does not qualify: Call of Legends, not Legendary Collection (and never 'tcgp-sealed')", guardSpot?.setId, "col1");
check("its top five: the Cardmarket-agreed Pikachu, Umbreon $198, then the liquid three; no spike, no stuck $500, no 13x", guardSpot?.cards.map((c) => c.cardId), ["col1-31", "col1-22", "col1-3", "col1-2", "col1-1"]);
check("the printed prices are the tested ones", guardSpot?.cards.map((c) => c.to), [300, 198.26, 60, 40, 30]);
check("the pinned set is used again once its fifth card is clean (Cardmarket agrees)", await (async () => { await db.prepare("UPDATE price_series SET prices = '[120]' WHERE card_id = 'base4-5' AND source = 'cardmarket'").run(); const id = (await setSpotlight("pokemon", PIN))?.setId; await db.prepare("UPDATE price_series SET prices = '[20]' WHERE card_id = 'base4-5' AND source = 'cardmarket'").run(); return id; })(), "base4");

// The pool the card of the day draws from: at $250 it is the two 300s, the Rayquaza, the Deoxys and the eBay-only card.
check("card of the day, priciest pool: only the Cardmarket-agreed $300", (await cardOfTheDay("pokemon", PIN, 250))?.cardId, "col1-31");
let cotdJunk = 0;
for (let i = 0; i < 3; i++) { const c = await cardOfTheDay("pokemon", addDays(PIN, i), 15); if (!c || junk.has(c.cardId) || c.cardId.startsWith("tcgp") || c.cardId === "sm3-150") cotdJunk++; }
check("card of the day, wide pool: never junk, sealed or an eBay-only row", cotdJunk, 0);
check("movers never read the junk either", (await topMovers("pokemon", PIN, { limit: 30 })).some((m) => junk.has(m.cardId)), false);

console.log("a doubling to $100+ needs Cardmarket to agree (priceTrust test 5, so gains, drops, spotlights and the card of the day all read it)");
// Machamp shape (Stormfront $64 -> $146 in a day, held, no second source) beside the same move Cardmarket confirms.
const jump = () => [...liquid(64, 50), 146, 147, 146, 148];
await real("hs2-1", "Machamp", "1", "hs2", "Stormfront", jump());
await real("hs2-2", "Machamp confirmed", "2", "hs2", "Stormfront", jump(), { eur: 110 });
await real("hs2-3", "Small gain", "3", "hs2", "Stormfront", [...liquid(64, 50), 96, 97, 96, 98]);
const gains = (await topMovers("pokemon", PIN, { direction: "up", limit: 30 })).map((m) => m.cardId);
check("unconfirmed doubling dropped, confirmed one kept, a 1.5x move to under $100 untouched", [gains.includes("hs2-1"), gains.includes("hs2-2"), gains.includes("hs2-3")], [false, true, true]);

console.log("the log says what the guard dropped, once per game and day");
warnings.length = 0;
const logDay = addDays(PIN, 3);
await topMovers("pokemon", logDay); await topMovers("pokemon", logDay, { direction: "up" }); await setSpotlight("pokemon", logDay); await cardOfTheDay("pokemon", logDay);
const guardLines = warnings.filter((w) => w.includes("price guard skipped"));
check("one line, with a count and a few ids", [guardLines.length, /skipped \d+ pokemon cards \((col1-20|col1-30|col1-SL1|base4-5) /.test(guardLines[0] ?? "")], [1, true]);
check("the loader the stage strip uses: junk rejected with its reason, real cards priced", await (async () => {
  const r = await trustedUsdPrices(["col1-20", "col1-SL1", "col1-22", "col1-1", "tcgp-sealed-1"], PIN);
  return [r.rejected.map((x) => x.id).sort(), r.prices.get("col1-22")?.price, r.prices.get("col1-1")?.variant];
})(), [["col1-20", "col1-SL1"], 198.26, "holofoil"]);

// ---- 10-01 review: every printed number is judged, not just today's
console.log("drops: the OLD price is judged too (it is printed: \"$1,013 -> $100\")");
// A junk plateau that has just corrected: Rayquaza-shaped, $1,013 for 30 days, now $100 with Cardmarket agreeing (EUR 90).
await real("zz1-1", "Corrected Rayquaza", "1", "zz1", "Review Set", [...Array(30).fill(1013.27), ...Array(5).fill(100)], { eur: 90 });
// A listing parked at $15.50 for two months, then $10 (Metagross ex8-11): the "drop" is a listing being updated.
await real("zz1-2", "Parked Metagross", "2", "zz1", "Review Set", [...Array(60).fill(15.5), ...Array(5).fill(10)]);
// A real drop: a liquid $200 card, now a settled $150.
await real("zz1-3", "Real drop", "3", "zz1", "Review Set", [...liquid(200, 40), ...Array(5).fill(150)]);
const dips = (await topMovers("pokemon", PIN, { direction: "down", limit: 30 })).map((m) => m.cardId);
check("the corrected junk plateau is not a drop (its $1,013 old price fails the guard)", dips.includes("zz1-1"), false);
check("a parked $15.50 listing is not a drop to $10", dips.includes("zz1-2"), false);
check("a real drop from a moving price still posts", dips.includes("zz1-3"), true);
check("no post prints the $1,013 old price, up or down", (await topMovers("pokemon", PIN, { limit: 50 })).every((m) => m.from < 1000), true);
// The card of the day states the week's move from the old price too: six corrected-junk cards and one clean card, one day of their own, so the pick can only be the clean one.
const D5 = addDays(PIN, 24);
for (let n = 1; n <= 6; n++) await real(`zz6-${n}`, `Corrected ${n}`, String(n), "zz6", "Review Set Six", [...Array(30).fill(1013.27), ...Array(5).fill(100)], { eur: 90, end: D5 });
await real("zz6-7", "Clean", "7", "zz6", "Review Set Six", liquid(100), { end: D5 });
check("the card of the day is never one whose week-ago price is junk", (await cardOfTheDay("pokemon", D5, 15))?.cardId, "zz6-7");

console.log("set spotlight: the printed median and week are judged; an unverified marquee card blocks its set");
const D2 = addDays(PIN, 6);
const setD2 = async (id, name, prices, extra = {}) => real(id, name, id.split("-")[1], "zz9", "Review Set Nine", prices, { end: D2, ...extra });
for (const [n, p] of [[1, 25], [2, 30], [3, 40], [4, 60], [5, 20]]) await setD2(`zz9-${n}`, `Clean ${n}`, liquid(p));
// Corrected TODAY: the point has not held, so the card would print the week's median, which is still the junk price.
await setD2("zz9-6", "Corrected today", [...Array(30).fill(1013.27), 100], { eur: 90 });
// Corrected a week ago and settled: the $100 is fine, the "week" it would claim starts at $1,013.27.
await setD2("zz9-7", "Corrected a week ago", [...Array(30).fill(1013.27), ...Array(7).fill(100)], { eur: 90 });
const nine = await setSpotlight("pokemon", D2);
check("the unsettled card whose median is the junk price is left out of the set", nine?.cards.some((c) => c.cardId === "zz9-6"), false);
check("its five: the settled corrected card on top, then the clean ones", nine?.cards.map((c) => c.cardId), ["zz9-7", "zz9-4", "zz9-3", "zz9-2", "zz9-1"]);
check("the corrected card shows today's $100 and claims no week (its old price is junk)", [nine?.cards[0].to, nine?.cards[0].from, nine?.cards[0].unsettled, nine?.cards[0].pct], [100, 100, true, 0]);
check("its caption says five of the most valuable, and claims no week for it", [setCaption("pokemon", nine).includes("Five of the most valuable Pokémon cards"), /Corrected a week ago #7 Holo: \$100\n/.test(setCaption("pokemon", nine))], [true, true]);
// A set whose marquee card the guard could not vouch for (thin + round at $250, unverified, not proved wrong) is not "the most valuable" post.
const D3 = addDays(PIN, 12);
const setD3 = async (id, name, prices, extra = {}) => real(id, name, id.split("-")[1], "zz8", "Review Set Eight", prices, { end: D3, ...extra });
for (const [n, p] of [[1, 25], [2, 30], [3, 40], [4, 60], [5, 20]]) await setD3(`zz8-${n}`, `Clean ${n}`, liquid(p));
await setD3("zz8-6", "Unverified marquee", [...Array(40).fill(200), 250]);
check("a set with an unverified card that would rank in its five is not spotlighted", await setSpotlight("pokemon", D3), null);
// A card the guard proved wrong (Cardmarket says 15x) has an unknown real price, not a high one: it does not block the set.
const D4 = addDays(PIN, 18);
for (const [n, p] of [[1, 25], [2, 30], [3, 40], [4, 60], [5, 20]]) await real(`zz7-${n}`, `Clean ${n}`, String(n), "zz7", "Review Set Seven", liquid(p), { end: D4 });
await real("zz7-6", "Junk marquee", "6", "zz7", "Review Set Seven", liquid(300), { eur: 18, end: D4 });
check("a card proved wrong does not block its set", (await setSpotlight("pokemon", D4))?.cards.map((c) => c.cardId), ["zz7-4", "zz7-3", "zz7-2", "zz7-1", "zz7-5"]);

console.log("Magic: Scryfall's EUR price is the referee");
const mtg = async (id, name, usd, eur, rarity = "") => {
  await db.prepare("INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, image_url, rarity, price_usd, price_eur, synced_at) VALUES (?, ?, 'lea', 'Alpha', '1', 'https://cards.scryfall.io/normal/y.jpg', ?, ?, ?, 0)").run(id, name, rarity, usd, eur);
  await put(id, "mtg", "nonfoil", "tcgplayer", "USD", liquid(usd));
};
await mtg("mtg-2", "Gloom", 400, 30);           // Alpha uncommon, 12x its Cardmarket price
await mtg("mtg-3", "Time Walk", 300, 250);      // agrees
check("card of the day, priciest pool: the 12x Alpha uncommon is out, Time Walk is the pick", (await cardOfTheDay("mtg", PIN, 250))?.cardId, "mtg-3");
await mtg("mtg-5", "Stage junk", 120, 10, "rare");
await mtg("mtg-6", "Stage real", 120, 100, "rare");
const stage = (await getGameStageCards("mtg")).cards.map((c) => c.name);
check("the all-games picture / stage: Magic rows pass the same referee", [stage.includes("Stage junk"), stage.includes("Stage real")], [false, true]);

// The homepage / scanner stage with Magic on reads mtgShowcase: the dearest printing per iconic name, which was the junk row.
const { mtgShowcase } = await import(at("lib/server/mtgCards.ts"));
await mtg("mtg-8", "Sol Ring", 400, 30);   // 12x
await mtg("mtg-9", "Sol Ring", 60, 50);    // agrees
await mtg("mtg-10", "Lightning Bolt", 45, 12); // 3.4x: under the 4x line, kept
await mtg("mtg-11", "Lightning Bolt", 70, 12); // 5.3x: junk
const shelf = new Map((await mtgShowcase(12)).map((c) => [c.name, c.prices.find((p) => p.source === "tcgplayer")?.market]));
check("the landing showcase takes the dearest printing Cardmarket does not call junk", [shelf.get("Sol Ring"), shelf.get("Lightning Bolt")], [60, 45]);

console.log("Pokémon stage strip: a junk price never reaches the pick");
// Eevee, McDonald's Collection 2019 #12: $25.92 against EUR 3.71, one priced day. Seven real icons keep the mirror path (no upstream call).
const now = todayUtc();
const icons = ["Charizard", "Pikachu", "Mewtwo", "Gengar", "Umbreon", "Blastoise", "Lucario"];
for (const [i, n] of icons.entries()) await real(`stg-${i}`, n, String(i), "stg", "Stage Set", liquid(30 + i), { eur: 25, end: now });
await real("mcd19-12", "Eevee", "12", "mcd19", "McDonald's Collection 2019", [25.92], { eur: 3.71, end: now });
await real("mcd19-13", "Eevee", "13", "mcd19", "McDonald's Collection 2019", liquid(20), { eur: 16, end: now });
await db.prepare("DELETE FROM card_cache WHERE key LIKE 'stage:%'").run(); // the drafts above already built (and cached) a stage list from the sparse fixtures
const stagePk = await getStageCards(false);
check("the Eevee at 6.4x Cardmarket is gone, the one Cardmarket agrees with stays", [stagePk.cards.some((c) => c.price === 25.92), stagePk.cards.some((c) => c.name === "Eevee" && c.price === 20)], [false, true]);
console.warn = realWarn;

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
