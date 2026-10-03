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
// 10-03 Lugia 1st Edition: $1,085 for weeks, $164.80 for five days around a week ago, $1,135 since. A dip unwinding, not +589%.
// (1st Edition, so a $1,000+ price that rarely changes is its normal state for the guard, as the real card's is; the old
// level ends 18 days back, outside the old price's own week, exactly the shape the week-before-the-week rule misses.)
await catalog("sv2-15", "Lugia", "9"); for (let b = 70; b >= 18; b -= 2) await recordPoint("sv2-15", "pokemon", "1stEditionHolofoil", "tcgplayer", "USD", 1085, day(b)); for (const b of [8, 7, 6, 5, 4]) await recordPoint("sv2-15", "pokemon", "1stEditionHolofoil", "tcgplayer", "USD", 164.8, day(b)); for (const b of [2, 1, 0]) await recordPoint("sv2-15", "pokemon", "1stEditionHolofoil", "tcgplayer", "USD", 1134.85, day(b));
check("a dip unwinding is not a gain (Lugia $164.80 → $1,135 after weeks at $1,085)", (await topMovers("pokemon", TODAY, { direction: "up", limit: 20 })).some((m) => m.cardId === "sv2-15"), false);
// The same shape ending at a NEW level ($100 → $45 → $70) is still a move: today is nowhere near the old level.
await catalog("sv2-16", "Real mover", "10"); for (let b = 70; b >= 18; b -= 2) await recordPoint("sv2-16", "pokemon", "normal", "tcgplayer", "USD", 100, day(b)); for (const b of [8, 7, 6, 5, 4]) await recordPoint("sv2-16", "pokemon", "normal", "tcgplayer", "USD", 45, day(b)); for (const b of [2, 1, 0]) await recordPoint("sv2-16", "pokemon", "normal", "tcgplayer", "USD", 70, day(b));
check("…but a rise to a NEW level after a dip still counts", (await topMovers("pokemon", TODAY, { direction: "up", limit: 20 })).some((m) => m.cardId === "sv2-16"), true);
// A real riser would join every list below; the checks there pin the older fixture, so it leaves.
await db.prepare("DELETE FROM price_series WHERE card_id = 'sv2-16'").run(); await db.prepare("DELETE FROM en_cards WHERE id = 'sv2-16'").run();
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

// The night-rendered 7am video names the day's set (10-01: the pool changed size overnight and the sites posted another set).
{
  const { setSetting: put2 } = await import(at("lib/server/settings.ts"));
  const D = addDays(PIN, 1); // no day plan
  const row = (v) => put2(`social_tiktok:morning:${D}`, v == null ? "" : JSON.stringify(v));
  await db.prepare("UPDATE price_series SET prices = '[120]' WHERE card_id = 'base4-5' AND source = 'cardmarket'").run();
  const hashed = (await setSpotlight("pokemon", D))?.setId;
  const other = hashed === "col1" ? "base4" : "col1";
  await row({ kind: "set", cards: [{ cardId: `${other}-1` }] });
  check("two sets qualify, and the set on the day's rendered video beats the hash", [["col1", "base4"].includes(hashed), (await setSpotlight("pokemon", D))?.setId], [true, other]);
  await row({ kind: "set", cards: [{ cardId: "gone9-1" }] });
  check("a rendered set that no longer qualifies falls back to the hash", (await setSpotlight("pokemon", D))?.setId, hashed);
  await row({ kind: "movers", cards: [{ cardId: `${other}-1` }] });
  check("a row that is not a set video is ignored", (await setSpotlight("pokemon", D))?.setId, hashed);
  await put2(`social_tiktok:morning:${D}`, "{not json");
  check("a broken row is ignored", (await setSpotlight("pokemon", D))?.setId, hashed);
  await put2(`social_tiktok:morning:${PIN}`, JSON.stringify({ kind: "set", cards: [{ cardId: "col1-1" }] }));
  check("the day plan's set still wins over the rendered one", (await setSpotlight("pokemon", PIN))?.setId, "base4");
  await put2(`social_tiktok:morning:${PIN}`, "");
  await row(null);
  await db.prepare("UPDATE price_series SET prices = '[20]' WHERE card_id = 'base4-5' AND source = 'cardmarket'").run();
}

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

console.log("step-jump rule (10-01): a lone one-day step out of a long flat stretch is no mover, a staircase is");
// Skuntank ru1-13 shape: $52 for 4 months, one overnight step to $89.98, +71% and held. Gardevoir ex1-7 shape: a climb in stairs, last step +36% but the price had been moving.
const SKUNTANK = expand([[52.2, 70], [52.37, 6], [52.07, 4], [null, 2], [52.07, 14], [52.53, 4], [52.67, 7], [52.37, 3], [89.98, 3]]);
const GARDEVOIR = expand([[50, 60], [57.14, 5], [64.79, 2], [69.15, 3], [null, 2], [71.84, 15], [75.19, 14], [78.4, 3], [106.3, 3]]);
warnings.length = 0;
await real("ru1-13", "Skuntank", "13", "ru1", "Pokémon Rumble", SKUNTANK);
await real("ru1-14", "Skuntank confirmed", "14", "ru1", "Pokémon Rumble", SKUNTANK, { eur: 70 });
await real("ex1-7", "Gardevoir", "7", "ex1", "Ruby & Sapphire", GARDEVOIR);
const stepGains = (await topMovers("pokemon", PIN, { direction: "up", limit: 30 })).map((m) => m.cardId);
check("Skuntank (no Cardmarket) is out of the gains, its Cardmarket-confirmed twin and Gardevoir stay", [stepGains.includes("ru1-13"), stepGains.includes("ru1-14"), stepGains.includes("ex1-7")], [false, true, true]);
check("the next mover takes its place: Gardevoir still ranks by its move", stepGains.indexOf("ex1-7") > stepGains.indexOf("ru1-14"), true);
check("the log names the step-jump card", warnings.some((w) => w.includes("gains left out") && w.includes("ru1-13 step 1.7x")), true);
check("only movers read it: the price guard still vouches for the $89.98 (card pages and stage keep it)", (await trustedUsdPrices(["ru1-13"])).prices.get("ru1-13")?.price, 89.98);
check("a fall is not read by it: the drops post is untouched", (await topMovers("pokemon", PIN, { direction: "down", limit: 30 })).some((m) => m.cardId === "ru1-13"), false);

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
const nine = await setSpotlight("pokemon", D2, { leadFirst: false }); // these days fall after JUMPS_FROM: the guard tests read the value order, the lead rule has its own section below
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
check("a card proved wrong does not block its set", (await setSpotlight("pokemon", D4, { leadFirst: false }))?.cards.map((c) => c.cardId), ["zz7-4", "zz7-3", "zz7-2", "zz7-1", "zz7-5"]);

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

// ---- 10-01: the standing 7pm "biggest price jump in each game" and the 7am set spotlight's lead -------------------
console.log("10-01: each game's biggest weekly jump (7pm) and the set spotlight's lead (7am)");
const SOC = await import(at("lib/server/social.ts"));
const { isJump } = SOC;
const PL = await import(at("lib/socialPlan.ts"));
const { setSetting } = await import(at("lib/server/settings.ts"));
const J = "2026-11-20";
const wk = (from, to) => [...liquid(from, 40), from, (from + to) / 2, to, to, to, to, to, to]; // a settled price, a gradual week, a new price that holds six days
const flat = (v) => Array(48).fill(v);
// The ru1-13 shape: $52 for months, one overnight step to $89.98: +71%, the biggest raw gain of the week, and no mover.
const STEP = expand([[52.2, 70], [52.37, 6], [52.07, 4], [null, 2], [52.07, 14], [52.53, 4], [52.67, 7], [52.37, 3], [89.98, 3]]);
await real("jp1-1", "Riser A", "1", "jp1", "Jump Set", wk(50, 70), { end: J });
await real("jp1-2", "Riser B", "2", "jp1", "Jump Set", wk(36, 45), { end: J });
await real("jp1-3", "Step Jumper", "3", "jp1", "Jump Set", STEP, { end: J });
await real("jp1-4", "Faller", "4", "jp1", "Jump Set", wk(80, 60), { end: J });
await real("jp1-5", "Flat Five", "5", "jp1", "Jump Set", flat(55.5), { end: J });
await real("jp1-6", "Cheap Six", "6", "jp1", "Jump Set", flat(12), { end: J });
const jmtg = async (id, name, usd, series) => {
  await db.prepare("INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, image_url, rarity, price_usd, price_eur, synced_at) VALUES (?, ?, 'jms', 'Jump Masters', '7', 'https://cards.scryfall.io/normal/j.jpg', 'rare', ?, NULL, 0)").run(id, name, usd);
  await put(id, "mtg", "nonfoil", "tcgplayer", "USD", series, J);
};
await jmtg("mtg-j1", "Jump Mage", 64, wk(40, 64));                 // +60%
await jmtg("mtg-j2", "Slow Mage", 21.6, wk(20, 21.6));              // +8%
await jmtg("mtg-j3", "Step Mage", 90, [...Array.from({ length: 70 }, (_, i) => (i % 2 ? 50.6 : 50.1)), 90, 90, 90]); // +80% in one step out of 70 quiet days: no mover
for (const key of ["magic_public", "lorcana_public", "onepiece_public", "yugioh_public"]) await setSetting(key, "1");
const stg = (name, setName, number, price, extra = {}) => ({ name, setName, number, imageUrl: `https://img.example/${encodeURIComponent(name)}.png`, price, ...extra });
const STAGES = {
  "stage:v8:pokemon": [stg("Charizard ex", "Obsidian Flames", "125", 48.5, { lead: true })],
  "stage:v14:mtg": [stg("Sol Ring", "Commander Masters", "410", 32.1, { lead: true })],
  "stage:v14:lorcana": [stg("Elsa", "The First Chapter", "42", 61, { lead: true })],
  "stage:v14:onepiece": [stg("Portgas.D.Ace", "Premium Booster", "P-055", 75, { lead: true })],
  "stage:v14:yugioh": [stg("Dark Magician", "Legend of Blue Eyes (Worldwide English)", "LOB-005", 55.25, { lead: true })],
};
for (const [key, cards] of Object.entries(STAGES)) await db.prepare("INSERT OR REPLACE INTO card_cache (key, payload, cached_at) VALUES (?, ?, ?)").run(key, JSON.stringify(cards), Date.now());

check("the rule is on from 10-01 and not before (a re-render of an old day is unchanged)", [PL.jumpsOn("2026-09-30"), PL.jumpsOn("2026-10-01"), PL.jumpsOn("2026-11-02")], [false, true, true]);
const rawUp = await topMovers("pokemon", J, { direction: "up", limit: 10 });
check("the step jump (+71%, the biggest raw gain) is not a mover, so it can never be a game's jump", [rawUp.some((m) => m.cardId === "jp1-3"), rawUp[0]?.cardId], [false, "jp1-1"]);
const g1 = await SOC.gameJumps(J);
check("one card per public game; jumps first, biggest move first (Magic +60%, Pokémon +40%), then the lead cards in the site's order", g1.map((l) => l.game), ["mtg", "pokemon", "lorcana", "onepiece", "yugioh"]);
check("Pokémon's is its top gainer, not its most valuable card and not the step jump", [g1[1].cardId, g1[1].name, g1[1].from, g1[1].price, Math.round(g1[1].pct)], ["jp1-1", "Riser A", 50, 70, 40]);
check("Magic's: the +60% nonfoil, never the +80% step", [g1[0].cardId, Math.round(g1[0].pct)], ["mtg-j1", 60]);
check("a game with no price history yet (Lorcana, One Piece, Yu-Gi-Oh began 09-30) keeps its lead card, with no move claimed", g1.slice(2).map((l) => [l.name, l.price, isJump(l), l.pct ?? null]), [["Elsa", 61, false, null], ["Portgas.D.Ace", 75, false, null], ["Dark Magician", 55.25, false, null]]);
check("the picture draws the jump's art (Pokémon high.webp, Magic large)", [g1[1].imageUrl.endsWith("/high.webp"), g1[0].imageUrl.includes("/large/")], [true, true]);
check("gameGainer: only the games the movers read (Pokémon, Magic)", [(await SOC.gameGainer("lorcana", J)) === null, (await SOC.gameGainer("pokemon", J))?.cardId], [true, "jp1-1"]);

console.log("fallback: never empty");
const J5 = addDays(J, 21);
await real("jq5-1", "Small Gain", "1", "jq5", "Small Set", wk(40, 41.2), { end: J5 }); // +3%
const lead5 = await SOC.gameLeads(J5);
check("a +3% week is no jump: every game keeps its lead card, the list IS today's leads", [(await SOC.gameJumps(J5)).map((l) => [l.game, l.name, l.price]), (await SOC.gameJumps(J5)).some(isJump)], [lead5.map((l) => [l.game, l.name, l.price]), false]);
const J6 = addDays(J, 40);
check("a day with no fresh series at all: five lead cards, nothing skipped", (await SOC.gameJumps(J6)).map((l) => l.game), ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"]);

console.log("caption, title, tags, no-repeat");
check("title: some games jumped, some kept a lead card", SOC.gamesTitle(g1), "Biggest price jumps this week");
const cap = SOC.gamesCaption(g1, "Which game are you collecting?");
const capLines = cap.split("\n");
check("each game's line: Card (Set #n): $X, +Y% this week; a lead card says its price today", capLines.slice(2, 7), [
  "Magic: Jump Mage (Jump Masters #7): $64.00, +60% this week",
  "Pokémon: Riser A (Jump Set #1, Holo): $70.00, +40% this week",
  "Lorcana: Elsa (The First Chapter #42): $61.00 today",
  "One Piece: Portgas.D.Ace (Premium Booster P-055): $75.00 today",
  "Yu-Gi-Oh: Dark Magician (Legend of Blue Eyes LOB-005): $55.25 today",
]);
check("the intro names the games that jumped and the ones that did not", capLines[0], "The biggest price jumps this week in Magic and Pokémon, and one card from Lorcana, One Piece and Yu-Gi-Oh at today's price, from CardFlip's own price history.");
check("the question sits after the card lines, before the sign-off; no exclamation marks", [capLines[8], capLines[10], cap.includes("!")], ["Which game are you collecting?", "Scan a card, see what it's worth. cardflip.io", false]);
check("short caption: name and move per game, then the question, then the address", SOC.gamesShortCaption(g1, "Which game are you collecting?").split("\n"), [
  "Biggest price jumps this week", "Magic: Jump Mage +60%", "Pokémon: Riser A +40%", "Lorcana: Elsa $61.00", "One Piece: Portgas.D.Ace $75.00", "Yu-Gi-Oh: Dark Magician $55.25", "", "Which game are you collecting?", "", "Scan a card, see what it's worth. cardflip.io",
]);
const allJ = ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"].map((game, i) => ({ game, name: `Card ${i}`, setName: "Set", number: String(i + 1), price: 10 * (i + 1), imageUrl: "", cardId: `c${i}`, from: 5 * (i + 1), pct: 100 }));
check("every game jumped: 'Biggest price jump in every game this week'", [SOC.gamesTitle(allJ), SOC.gamesCaption(allJ).startsWith("The biggest price jump in every game this week, from CardFlip's own price history.")], ["Biggest price jump in every game this week", true]);
check("no jump anywhere: the old all-games caption and title, as before", [SOC.gamesTitle(lead5), SOC.gamesCaption(lead5).startsWith("One scanner, five card games."), SOC.gamesCaption(lead5).includes("In the picture, one card from each game")], ["One scanner, five card games", true, true]);
const dj = (await SOC.socialDrafts("pokemon", J)).find((d) => d.kind === "games");
check("the games draft carries the jumps: title, the jump cards for the no-repeat list, at most five tags, the question", [dj.title, dj.cardIds, dj.featured, dj.hashtags, dj.question === PL.questionFor("games", J), dj.caption.includes(dj.question)], ["Biggest price jumps this week", ["mtg-j1", "jp1-1"], { mtg: ["mtg-j1"], pokemon: ["jp1-1"] }, ["PokemonTCG", "MTG", "DisneyLorcana", "OPTCG", "Yugioh"], true, true]);
const dOld = (await SOC.socialDrafts("pokemon", PIN)).find((d) => d.kind === "games");
check("before 10-01 the games draft is the old one (lead cards, no ids)", [dOld.title, dOld.cardIds, dOld.featured ?? null, dOld.caption.startsWith("One scanner, five card games.")], ["One scanner, five card games", [], null, true]);
await markFeatured("pokemon", "jumps", addDays(J, -1), ["jp1-1"]);
const g2 = await SOC.gameJumps(J);
check("no-repeat: a card that led yesterday's 7pm post sits out (Pokémon moves to the next gainer, Magic is untouched)", [g2.find((l) => l.game === "pokemon").cardId, g2.find((l) => l.game === "mtg").cardId, g2[0].game], ["jp1-2", "mtg-j1", "mtg"]);
check("…its own list: the 1pm gains list is not touched", [(await recentlyFeatured("pokemon", "movers", J)).has("jp1-1"), (await recentlyFeatured("pokemon", "jumps", J)).has("jp1-1")], [false, true]);

console.log("set spotlight: lead with the card that rose");
const spotJ = await setSpotlight("pokemon", J);
check("the biggest riser among the five leads, the rest keep their value order", [spotJ.setId, spotJ.leadId, spotJ.cards.map((c) => c.cardId)], ["jp1", "jp1-1", ["jp1-1", "jp1-3", "jp1-4", "jp1-5", "jp1-2"]]);
check("a ru1-13-shaped step jump (+71%, the biggest raw move in the set) never leads", [spotJ.cards.find((c) => c.cardId === "jp1-3").pct > 70, spotJ.leadId === "jp1-3"], [true, false]);
check("each card keeps its place by value (the video's label), the lead's real % is printed", [spotJ.cards.map((c) => c.rank), Math.round(spotJ.cards[0].pct)], [[2, 1, 3, 4, 5], 40]);
check("the faller is never the lead while the set has risers", spotJ.cards[0].pct > 0 && spotJ.cards.find((c) => c.cardId === "jp1-4").pct < 0, true);
const spotOld = await setSpotlight("pokemon", J, { leadFirst: false });
check("leadFirst off (a day before 10-01) = today's order, no lead", [spotOld.leadId ?? null, spotOld.cards.map((c) => c.cardId)], [null, ["jp1-3", "jp1-1", "jp1-4", "jp1-5", "jp1-2"]]);
check("the post still lists the set's five most valuable cards, only the order moved", [...spotJ.cards.map((c) => c.cardId)].sort(), [...spotOld.cards.map((c) => c.cardId)].sort());
const setPost = (await SOC.socialDrafts("pokemon", J)).find((d) => d.kind === "set");
check("the set caption lists the riser first and carries the set question", [setPost.caption.split("\n")[2].startsWith("Riser A #1 Holo: $70.00, +40% this week"), setPost.question === PL.questionFor("set", J, "Jump Set"), setPost.caption.includes(setPost.question)], [true, true, true]);
// Nothing rose: today's order. Falls and flats only.
const J2 = addDays(J, 7);
for (const [n, v] of [[1, wk(100, 90)], [2, flat(80)], [3, wk(75, 70)], [4, flat(60)], [5, flat(50)]]) await real(`jq1-${n}`, `Down Or Flat ${n}`, String(n), "jq1", "Quiet Set", v, { end: J2 });
const spotQ = await setSpotlight("pokemon", J2);
check("a set that is flat or down keeps today's order and invents no lead", [spotQ.setId, spotQ.leadId ?? null, spotQ.cards.map((c) => c.cardId)], ["jq1", null, ["jq1-1", "jq1-2", "jq1-3", "jq1-4", "jq1-5"]]);
// Ties go to the more valuable card.
const J3 = addDays(J, 14);
for (const [n, v] of [[1, wk(80, 96)], [2, wk(40, 48)], [3, flat(60)], [4, flat(55)], [5, flat(50)], [6, flat(20)]]) await real(`jr1-${n}`, `Tie ${n}`, String(n), "jr1", "Tie Set", v, { end: J3 });
const spotT = await setSpotlight("pokemon", J3);
check("two cards up the same 20%: the more valuable one leads", [spotT.leadId, spotT.cards.map((c) => c.cardId)], ["jr1-1", ["jr1-1", "jr1-3", "jr1-4", "jr1-5", "jr1-2"]]);

// A small rise (+3%) is no cover: with a steady card leading on value the order stays. A faller never leads while the set has a riser, even a small one.
const J7 = addDays(J, 28);
for (const [n, v] of [[1, [...liquid(100.5, 40), ...Array(8).fill(100.5)]], [2, wk(80, 82.4)], [3, flat(60)], [4, flat(55)], [5, flat(50)]]) await real(`js1-${n}`, `Small ${n}`, String(n), "js1", "Small Set", v, { end: J7 });
const spotS = await setSpotlight("pokemon", J7);
check("a +3% riser under a steady leader is no jump: today's order, no lead", [spotS.setId, spotS.leadId ?? null, spotS.cards.map((c) => c.cardId)], ["js1", null, ["js1-1", "js1-2", "js1-3", "js1-4", "js1-5"]]);
const J8 = addDays(J, 35);
for (const [n, v] of [[1, wk(124.5, 119.5)], [2, wk(88, 90)], [3, flat(70)], [4, flat(60)], [5, flat(50)]]) await real(`js2-${n}`, `Fell ${n}`, String(n), "js2", "Fell Set", v, { end: J8 });
const spotF = await setSpotlight("pokemon", J8);
check("the most valuable card FELL 4% and another rose 2.3%: the riser leads, so the cover is not red", [spotF.setId, spotF.leadId, spotF.cards.map((c) => c.cardId), Math.round(spotF.cards[1].pct)], ["js2", "js2-2", ["js2-2", "js2-1", "js2-3", "js2-4", "js2-5"], -4]);
const J9 = addDays(J, 42);
for (const [n, v] of [[1, wk(124.5, 119.5)], [2, wk(92, 90)], [3, flat(70)], [4, flat(60)], [5, flat(50)]]) await real(`js3-${n}`, `Down ${n}`, String(n), "js3", "Down Set", v, { end: J9 });
const spotD = await setSpotlight("pokemon", J9);
check("nothing in the set rose: today's order, even though the leader fell (no gain is invented)", [spotD.setId, spotD.leadId ?? null, spotD.cards.map((c) => c.cardId)], ["js3", null, ["js3-1", "js3-2", "js3-3", "js3-4", "js3-5"]]);

console.log("one question per post, rotating by day");
const kinds = ["movers", "dips", "set", "games"];
for (const kind of kinds) {
  const days = Array.from({ length: 30 }, (_, i) => addDays("2026-10-01", i));
  const qs = days.map((d) => PL.questionFor(kind, d, "Base Set 2"));
  check(`${kind}: never the same question two days running, every question gets its turn in a cycle, same day = same question`, [qs.every((q, i) => i === 0 || q !== qs[i - 1]), new Set(qs.slice(0, 3)).size >= 2, new Set(qs).size === PL.QUESTIONS[kind].length, PL.questionFor(kind, days[4], "Base Set 2") === qs[4]], [true, true, true, true]);
  check(`${kind}: plain text, no emoji, no link, no comment bait`, qs.every((q) => /^[A-Za-z0-9 ',?-]+\?$/.test(q) && !/comment|link|follow|share|tag a|http|cardflip/i.test(q) && q.length <= 60), true);
}
check("a set question can name the set", [0, 1, 2, 3, 4, 5].some((i) => PL.questionFor("set", addDays("2026-10-01", i), "Base Set 2").includes("Base Set 2")), true);
check("hashtags: five games = the five game tags, four = four plus #TCG, one = its own two and the general ones, never more than five", [PL.gamesTags(["pokemon", "mtg", "lorcana", "onepiece", "yugioh"]), PL.gamesTags(["pokemon", "mtg", "lorcana", "yugioh"]), PL.gamesTags(["pokemon"]), PL.PLAN_TAGS.games.length], [["PokemonTCG", "MTG", "DisneyLorcana", "OPTCG", "Yugioh"], ["PokemonTCG", "MTG", "DisneyLorcana", "Yugioh", "TCG"], ["PokemonTCG", "TCG", "TradingCards", "CardCollector", "PokemonCards"], 5]);
check("a fan puts the biggest in the middle, on top", [PL.fanOrder(["a", "b", "c", "d", "e"]), PL.fanOrder(["a", "b", "c", "d"]), PL.fanOrder(["a"])], [["e", "c", "a", "b", "d"], ["c", "a", "b", "d"], ["a"]]);

console.log("the 7pm jump is not a 1pm card again (10-02: Dark Porygon2 led both videos)");
check("the rule is on from 10-02 and not before", [PL.freshJumpsOn("2026-10-01"), PL.freshJumpsOn("2026-10-02"), PL.freshJumpsOn(undefined)], [false, true, false]);
const JF = addDays(J, 200);
const rises = [75, 70, 65, 60, 57.5, 55]; // +50% … +10%: five fill the 1pm gains post, the sixth is left for 7pm
for (const [i, to] of rises.entries()) await real(`jr7-${i + 1}`, `Climber ${i + 1}`, String(i + 1), "jr7", "Climb Set", wk(50, to), { end: JF });
const noon7 = await topMovers("pokemon", JF, { direction: "up" });
const g7 = (await SOC.gameJumps(JF)).find((l) => l.game === "pokemon");
check("the 1pm shows the five biggest gainers; the 7pm jump is the next one, not the 1pm's No. 1", [noon7.map((m) => m.cardId), g7.cardId, Math.round(g7.pct)], [["jr7-1", "jr7-2", "jr7-3", "jr7-4", "jr7-5"], "jr7-6", 10]);
const JG = addDays(J, 260);
for (const [i, to] of [75, 70, 65].entries()) await real(`jr8-${i + 1}`, `Lone ${i + 1}`, String(i + 1), "jr8", "Lone Set", wk(50, to), { end: JG });
const g8 = (await SOC.gameJumps(JG)).find((l) => l.game === "pokemon");
check("every gainer is in the 1pm: the 7pm keeps the top one (a repeated gain beats a card with no move)", [g8.cardId, isJump(g8)], ["jr8-1", true]);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
