/**
 * The price guard on the site (lib/server/priceTrustSite.ts). Run: npm run test:sitetrust
 *
 * Pins the policy layered over the bare rule (test:pricetrust owns the rule):
 * the held variant is judged on its own series, siblings only for Pokemon's
 * default printing, Magic's referee is the finish's own EUR, the young games
 * (Lorcana, One Piece, Yu-Gi-Oh) count hard verdicts only, a live price that
 * differs from the series is judged as today's point, and the OLD side of a
 * move is judged strictest. The loader runs against a throwaway db: flagged
 * cards come back in one batch, normal cards are absent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-sitetrust-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { judgeSeries, judgeStale, siteTrust, siteTrustFull, withPriceFlags, loadTrustData, clearTrustMemo, trustKey, marketPriceFlagged, heldTrustOrOpen } = await import(at("lib/server/priceTrustSite.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { addDays, todayUtc, encodePrices } = await import(at("lib/priceSeries.ts"));
const { PRICE_FLAG_NOTE, priceStaleNote } = await import(at("lib/priceFlag.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const TODAY = todayUtc();
const flatPrices500 = (n) => Array(n).fill(500);
const expand = (rle) => rle.flatMap(([v, n]) => Array(n).fill(v));
/** A liquid series: moves every day (a real market), ending on `to`. */
const liquid = (to, days = 60) => Array.from({ length: days }, (_, i) => Math.round((to * (1 + ((i * 7) % 5) / 100) - (i % 3)) * 100) / 100).concat(to);
/** A series that ends today. */
const ser = (variant, prices) => ({ variant, startDay: addDays(TODAY, -(prices.length - 1)), prices });
const data = (game, series, extra = {}) => ({ game, series, cmEur: null, eur: null, released: "", ...extra });
const verdict = (d, opts) => { const f = judgeSeries(d, opts); return f ? [f.hard, f.reason] : null; };

// Real 09-30 rows (Pokemon, tcgplayer USD, oldest first): the three named junk cards' shapes.
const RAYQUAZA = expand([[101.83, 12], [104.42, 44], [104.66, 13], [107.19, 10], [536.45, 7], [599.46, 3], [679.27, 12], [null, 2], [679.27, 4], [767.94, 1], [1035.13, 9], [1013.27, 19]]);
const DEOXYS = expand([[174.15, 10], [180, 2], [240, 14], [500, 9], [310, 14], [500, 52], [null, 2], [500, 33]]);

console.log("Pokemon: the rule as the site reads it");
check("Rayquaza $1,013 vs Cardmarket EUR 45: flagged, proved wrong", verdict(data("pokemon", [ser("holofoil", RAYQUAZA)], { cmEur: 45.13 })), [true, "cardmarket 20.4x"]);
// 10-06: a Cardmarket gap below 10x is one soft sign, never a verdict on a solid US series (Great Encounters, Cardmarket 'average' = the wrong figure for the printing).
check("Cresselia dp4-2 $17.23 vs EUR 2.85 (5.5x), steady 140 days: shown", verdict(data("pokemon", [ser("holofoil", liquid(17.23, 139)), ser("reverseHolofoil", liquid(18.7, 139))], { cmEur: 2.85, released: "2008-02-13" })), null);
check("Cresselia LV.X dp4-103 $61.39 vs EUR 11.30 (4.9x), steady: shown", verdict(data("pokemon", [ser("holofoil", liquid(61.39, 139))], { cmEur: 11.3, released: "2008-02-13" })), null);
check("a thin 3-priced-day series with a 5x gap still flags (soft)", verdict(data("pokemon", [ser("holofoil", [17.1, 17.2, 17.23])], { cmEur: 2.85 })), [false, "thin, cardmarket 5.5x"]);
check("a steady $60 at 12x still flags, hard", verdict(data("pokemon", [ser("holofoil", liquid(60, 139))], { cmEur: 4.5 }))?.[0], true);
// 10-06: TCGdex's Cardmarket avg (cmEurAlt) is a second reading; the one nearer the price referees.
check("a thin 5x gap clears when TCGdex's reading agrees (LV.X EUR 49.70)", verdict(data("pokemon", [ser("holofoil", [61.1, 61.2, 61.39])], { cmEur: 11.3, cmEurAlt: 49.7 })), null);
check("... a junk TCGdex reading never opens a gap the old one cleared", verdict(data("pokemon", [ser("holofoil", liquid(36.21, 139))], { cmEur: 30, cmEurAlt: 426.5 })), null);
check("... and both readings far off still flag, hard", verdict(data("pokemon", [ser("holofoil", liquid(60, 139))], { cmEur: 4.5, cmEurAlt: 3 }))?.[0], true);
check("... and an agreeing TCGdex reading never vouches: the $1,013 Rayquaza spike stays hidden (TCGdex EUR 2,216)", verdict(data("pokemon", [ser("holofoil", RAYQUAZA)], { cmEur: 45.13, cmEurAlt: 2216.42 }))?.[0], true);
{
  const { refereeCandidates } = await import(at("lib/server/pokemonPriceRefresh.ts"));
  const s = (v) => ({ prices: encodePrices([v]) });
  const tcg = new Map([["a|holofoil", s(61.39)], ["a|reverseHolofoil", s(5)], ["b|holofoil", s(20)], ["c|normal", s(8)], ["d|holofoil", s(40)]]);
  const cm = new Map([["a|average", s(11.3)], ["b|average", s(15)], ["c|average", s(1)], ["d|average", s(2)]]);
  check("referee candidates: disputed $10+ default printings, then cards already holding a reading", refereeCandidates(tcg, cm, new Map([["b|average", s(18)], ["d|average", s(30)]])), ["a", "d", "b"]);
}
check("Rayquaza with no second source: the spike never came back", verdict(data("pokemon", [ser("holofoil", RAYQUAZA)]))?.[1]?.startsWith("spike"), true);
// 10-02: flat is a NOTE, not a hide. Deoxys shows $500 with "Market hasn't updated this in 3 months"; judgeSeries (the hide) says fine.
check("Deoxys: a round $500 for 87 days is stale, not hidden", verdict(data("pokemon", [ser("holofoil", DEOXYS)])), null);
check("... judgeStale carries the days", judgeStale(data("pokemon", [ser("holofoil", DEOXYS)])), { days: 87 });
check("... a moving market has no stale note", judgeStale(data("pokemon", [ser("holofoil", liquid(300))])), null);
check("... a hidden price has no stale note either (Rayquaza)", judgeStale(data("pokemon", [ser("holofoil", RAYQUAZA)], { cmEur: 45.13 })), null);
check("the note wording: months from two months, weeks under", [priceStaleNote(128), priceStaleNote(87), priceStaleNote(45), priceStaleNote(60)], ["Market hasn't updated this in 4 months", "Market hasn't updated this in 3 months", "Market hasn't updated this in 6 weeks", "Market hasn't updated this in 2 months"]);
// Charizard Plasma Storm 136 (bw8-136), the case that made the rule: $1,150 flat 128 days, Cardmarket EUR 302.44 (3.5x), eBay NM sold $1,276-$1,651.
const CHARIZARD_PLASMA = [...liquid(1100, 30), ...Array(128).fill(1150)];
check("Charizard bw8-136: shown", verdict(data("pokemon", [ser("holofoil", CHARIZARD_PLASMA)], { cmEur: 302.44, released: "2013-02-06" })), null);
check("... with the 128-day note", judgeStale(data("pokemon", [ser("holofoil", CHARIZARD_PLASMA)], { cmEur: 302.44, released: "2013-02-06" })), { days: 128 });
// 10-07: the variant's own cheapest live listing (listing_lows) reaches the rule: Lugia ex10-105 $2,500 flat 49 days, a copy listed at $1,200.
const LUGIA_EX = [...liquid(2400, 30), ...Array(49).fill(2500)];
check("Lugia ex10-105: the cheapest listing hides the frozen price", verdict(data("pokemon", [ser("holofoil", LUGIA_EX)], { lows: { holofoil: 1200 } })), [true, "flat 49d, 2.1x the cheapest listing"]);
check("... and it is no longer a stale note", judgeStale(data("pokemon", [ser("holofoil", LUGIA_EX)], { lows: { holofoil: 1200 } })), null);
check("... another printing's listing does not speak for it", judgeStale(data("pokemon", [ser("holofoil", LUGIA_EX)], { lows: { reverseHolofoil: 1200 } })), { days: 49 });
check("... nor clears a stale note (Charizard bw8-136, TCGdex EUR 378.97)", judgeStale(data("pokemon", [ser("holofoil", CHARIZARD_PLASMA)], { cmEur: 302.44, cmEurAlt: 378.97, released: "2013-02-06" })), { days: 128 });
check("a liquid $300 card is fine", verdict(data("pokemon", [ser("holofoil", liquid(300))])), null);
check("a $12 card is never looked at", verdict(data("pokemon", [ser("normal", [12, 12, 12])], { cmEur: 0.5 })), null);
check("soft signs only come back as unverified (hard false)", verdict(data("pokemon", [ser("holofoil", liquid(499.99, 8))])), [false, "round, 9 priced days"]);
check("a card with no series at all is not judged on soft signs", verdict(data("pokemon", []), { liveUsd: 250, variant: "holofoil", exact: true }), null);
check("... but a second source that says 5x still proves it wrong", verdict(data("pokemon", [], { cmEur: 20 }), { liveUsd: 250, variant: "holofoil", exact: true })?.[0], true);

console.log("held variant and siblings");
{
  const d = data("pokemon", [ser("normal", liquid(20)), ser("holofoil", liquid(90))]);
  check("default variant judged on the normal line", verdict(d), null);
  // The stale note follows the same variant policy as the hide (Deoxys is the stale fixture since 10-02; Rayquaza the hidden one).
  check("the held holofoil is judged on ITS line, not the default", judgeStale(data("pokemon", [ser("normal", liquid(20)), ser("holofoil", DEOXYS)]), { variant: "holofoil" }), { days: 87 });
  check("... the hide too", verdict(data("pokemon", [ser("normal", liquid(20)), ser("holofoil", RAYQUAZA)]), { variant: "holofoil" })?.[1]?.startsWith("spike"), true);
  check("... while the default normal line of the same card stays fine", [verdict(data("pokemon", [ser("normal", liquid(20)), ser("holofoil", DEOXYS)])), judgeStale(data("pokemon", [ser("normal", liquid(20)), ser("holofoil", DEOXYS)]))], [null, null]);
  check("a held variant with no line of its own falls back to the default", judgeStale(data("pokemon", [ser("holofoil", DEOXYS)]), { variant: "reverseHolofoil" }), { days: 87 });
  check("... unless the caller asks for that printing exactly", [verdict(data("pokemon", [ser("holofoil", DEOXYS)]), { variant: "reverseHolofoil", exact: true }), judgeStale(data("pokemon", [ser("holofoil", DEOXYS)]), { variant: "reverseHolofoil", exact: true })], [null, null]);
  // Aquapolis-style: the reverse holo is $336 while Cardmarket's one average (the plain card) is EUR 28: 10.7x, and real.
  const aqua = data("pokemon", [ser("normal", liquid(177)), ser("reverseHolofoil", liquid(336))], { cmEur: 28.42 });
  check("the Cardmarket average does not referee a reverse holo (it is the plain card's price)", verdict(aqua, { variant: "reverseHolofoil" }), null);
  check("... while it still referees the default printing of the same card", verdict(data("pokemon", [ser("normal", liquid(177)), ser("reverseHolofoil", liquid(336))], { cmEur: 10 }), { variant: "normal" })?.[0], true);
  check("a reverse holo is still judged on its own series (flat round $500 for 87 days: stale)", judgeStale(data("pokemon", [ser("normal", liquid(20)), ser("reverseHolofoil", DEOXYS)], { cmEur: 28.42 }), { variant: "reverseHolofoil" }), { days: 87 });
  check("... and hidden on its own series too (a spike)", verdict(data("pokemon", [ser("normal", liquid(20)), ser("reverseHolofoil", RAYQUAZA)], { cmEur: 28.42 }), { variant: "reverseHolofoil" })?.[0], true);
  const sib = data("pokemon", [ser("normal", liquid(160)), ser("holofoil", liquid(40))]);
  check("sibling anchor on the default: $160 normal vs a $40 holo is 4x", verdict(sib), [true, "sibling 4.0x"]);
  check("no sibling test for a non-default printing (a holo is 3x its reverse legitimately)", verdict(data("pokemon", [ser("holofoil", liquid(120)), ser("reverseHolofoil", liquid(30))]), { variant: "reverseHolofoil" }), null);
  check("Magic foil at 3x+ its nonfoil is normal", verdict(data("mtg", [ser("nonfoil", liquid(60)), ser("foil", liquid(240))]), { variant: "foil" }), null);
  check("Lorcana foil at 3x+ its normal is normal", verdict(data("lorcana", [ser("normal", liquid(60, 20)), ser("foil", liquid(240, 20))]), { variant: "foil" }), null);
}

console.log("Magic: the finish's own Cardmarket price is the referee");
{
  const d = data("mtg", [ser("nonfoil", liquid(150)), ser("foil", liquid(150))], { eur: { nonfoil: 120, foil: 12 } });
  check("nonfoil $150 vs EUR 120 agrees", verdict(d, { variant: "nonfoil" }), null);
  check("foil $150 vs foil EUR 12 is 11.4x: flagged", verdict(d, { variant: "foil" }), [true, "cardmarket 11.4x"]);
  check("etched reads the foil EUR too", verdict(data("mtg", [ser("etched", liquid(150))], { eur: { nonfoil: 120, foil: 12 } }), { variant: "etched" })?.[0], true);
  check("no Cardmarket price: a liquid Magic card is fine", verdict(data("mtg", [ser("nonfoil", liquid(150))])), null);
  check("Magic vintage: a flat round $10,000 pre-2010 print is what it looks like", verdict(data("mtg", [ser("nonfoil", Array(40).fill(10000))], { released: "1993-08-05" })), null);
}

console.log("Lorcana / One Piece / Yu-Gi-Oh: hard verdicts only until the series has history");
{
  const young = [ser("normal", [180, 182, 181, 183])];
  check("a young $183 card (thin, few priced days: soft signs only) is not flagged", verdict(data("yugioh", young)), null);
  check("young round $500 (soft) is not flagged", verdict(data("onepiece", [ser("normal", [500])])), null);
  check("young but hard (a doubling to $100+) still is", verdict(data("lorcana", [ser("normal", [40, 41, 42, 43, 44, 45, 46, 47, 150])]))?.[0], true);
  const old = data("lorcana", [ser("normal", Array(20).fill(500))]);
  check("with 14+ priced days the full rule applies (flat 20d round $500)", verdict(old)?.[0], false);
  check("a young game's stale note is not held back: it is not a verdict against the price", judgeStale(data("onepiece", [ser("normal", Array(50).fill(500))])), { days: 50 });
}

console.log("a live price for today");
{
  const d = data("pokemon", [ser("holofoil", liquid(120))]);
  check("a live price equal to the series changes nothing", verdict(d, { liveUsd: 120 }), null);
  check("a live junk spike is judged as today's point", verdict(d, { liveUsd: 1300 })?.[0], true);
  check("... judged for the row shown, not the series it fell back to", verdict(d, { variant: "holofoil", exact: true, liveUsd: 1300 })?.[0], true);
  check("no live price and no series is not flagged", verdict(data("pokemon", []), {}), null);
}

console.log("the OLD side of a move");
{
  const plateau = expand([[15.5, 40], [10, 5]]);
  const d = data("pokemon", [ser("normal", plateau)]);
  check("today's $10 is fine", verdict(d), null);
  check("the $15.50 a week ago parked flat for 40 days is stale as an OLD price", verdict(d, { old: { back: 5, value: 15.5 } }), [true, "flat 40d"]);
  const real = data("pokemon", [ser("holofoil", liquid(300))]);
  check("a liquid old price is fine", verdict(real, { old: { back: 7, value: 280 } }), null);
}

console.log("loader: one batch, only flagged cards come back");
{
  const put = async (id, game, variant, prices, source = "tcgplayer", currency = "USD") => {
    await db.prepare(`INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, game, variant, source, currency, addDays(TODAY, -(prices.length - 1)), encodePrices(prices), TODAY);
  };
  await put("junk-rayquaza", "pokemon", "holofoil", RAYQUAZA);
  await put("junk-rayquaza", "pokemon", "average", [45.13], "cardmarket", "EUR");
  await put("fine-umbreon", "pokemon", "holofoil", liquid(198));
  await put("fine-umbreon", "pokemon", "average", [77.57], "cardmarket", "EUR");
  await put("junk-deoxys", "pokemon", "holofoil", DEOXYS);
  await put("junk-deoxys", "pokemon", "normal", liquid(30));
  await put("mtg-junk", "mtg", "foil", liquid(150));
  await put("mtg-junk", "mtg", "nonfoil", liquid(150));
  await put("mtg-fine", "mtg", "nonfoil", liquid(150));
  await put("ebay-only", "pokemon", "graded-psa-10", Array(60).fill(900), "ebay");
  for (const [id, rd] of [["junk-rayquaza", "2010-03-01"], ["fine-umbreon", "2010-03-01"], ["junk-deoxys", "2010-05-01"]]) {
    await db.prepare(`INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, synced_at) VALUES (?, ?, 'x', 'X', '1', ?, 0)`).run(id, id, rd);
  }
  for (const [id, eur, eurFoil] of [["mtg-junk", 120, 20], ["mtg-fine", 120, null]]) {
    await db.prepare(`INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, price_usd, price_eur, price_eur_foil, synced_at) VALUES (?, ?, 'x', 'X', '1', 150, ?, ?, 0)`).run(id, id, eur, eurFoil);
  }
  clearTrustMemo();
  const { flags, stale: staleMap } = await siteTrustFull([
    { cardId: "junk-rayquaza", game: "pokemon", variant: "holofoil" },
    { cardId: "fine-umbreon", game: "pokemon", variant: "holofoil" },
    { cardId: "junk-deoxys", game: "pokemon", variant: "holofoil" },
    { cardId: "junk-deoxys", game: "pokemon", variant: "normal" },
    { cardId: "mtg-junk", game: "mtg", variant: "foil" },
    { cardId: "mtg-junk", game: "mtg", variant: "nonfoil" },
    { cardId: "mtg-fine", game: "mtg", variant: "nonfoil" },
    { cardId: "no-series-anywhere", game: "pokemon", variant: "normal", liveUsd: 400 },
  ]);
  await put("sealed-pokemon-x-booster-box", "pokemon", "normal", flatPrices500(87));
  clearTrustMemo();
  check("a sealed product is never judged, however stuck its series", (await siteTrust([{ cardId: "sealed-pokemon-x-booster-box", game: "pokemon", variant: "normal" }])).size, 0);
  clearTrustMemo();
  check("Rayquaza flagged with its Cardmarket reason", flags.get(trustKey("junk-rayquaza", "holofoil")), { hard: true, reason: "cardmarket 20.4x" });
  check("Umbreon (Cardmarket agrees) is absent", flags.has(trustKey("fine-umbreon", "holofoil")), false);
  check("Deoxys holofoil is stale (87 days), not flagged", [flags.has(trustKey("junk-deoxys", "holofoil")), staleMap.get(trustKey("junk-deoxys", "holofoil"))], [false, { days: 87 }]);
  check("... its normal line is neither", [flags.has(trustKey("junk-deoxys", "normal")), staleMap.has(trustKey("junk-deoxys", "normal"))], [false, false]);
  check("Magic foil flagged on the foil EUR, nonfoil not", [flags.has(trustKey("mtg-junk", "foil")), flags.has(trustKey("mtg-junk", "nonfoil")), flags.has(trustKey("mtg-fine", "nonfoil"))], [true, false, false]);
  check("a card the price table has never seen is not flagged", flags.size, 2);
  check("only the one stale card", staleMap.size, 1);
  check("siteTrust (the hides alone) agrees", (await siteTrust([{ cardId: "junk-deoxys", game: "pokemon", variant: "holofoil" }, { cardId: "junk-rayquaza", game: "pokemon", variant: "holofoil" }])).size, 1);
  const loaded = await loadTrustData([{ cardId: "ebay-only", game: "pokemon" }]);
  check("eBay series are not read by the rule", loaded.get("ebay-only").series.length, 0);

  console.log("withPriceFlags: cards on their way to a screen");
  const card = (id, prices, game) => ({ id, name: id, setName: "X", setSeries: "", number: "1", rarity: null, imageSmall: "", imageLarge: "", englishName: null, prices, ...(game ? { game } : {}) });
  const usd = (variant, market) => ({ source: "tcgplayer", variant, label: variant, currency: "USD", market, low: null, high: null });
  const eurRow = { source: "cardmarket", variant: "holofoil", label: "Cardmarket", currency: "EUR", market: 45.13, low: null, high: null };
  const input = [card("junk-rayquaza", [usd("holofoil", 1013.27), eurRow]), card("fine-umbreon", [usd("holofoil", 198)]), card("mtg-junk", [usd("nonfoil", 150), usd("foil", 150)], "mtg"), card("junk-deoxys", [usd("holofoil", 500)])];
  const before = JSON.stringify(input);
  const out = await withPriceFlags(input);
  check("the flagged USD row carries untrusted", out[0].prices[0].untrusted, { hard: true, reason: "cardmarket 20.4x" });
  check("the stale USD row carries stale, not untrusted (Deoxys)", [out[3].prices[0].untrusted, out[3].prices[0].stale], [undefined, { days: 87 }]);
  check("the Cardmarket EUR row is never flagged", out[0].prices[1].untrusted === undefined);
  check("a normal card comes back as the same object", out[1] === input[1], true);
  check("Magic: only the flagged finish", out[2].prices.map((p) => !!p.untrusted), [false, true]);
  check("the input (and so the card cache behind it) is not mutated", JSON.stringify(input), before);
  check("note text is one sentence", PRICE_FLAG_NOTE, "This price looks off, check sold listings");
  check("no flagged card: same array back", (await withPriceFlags([input[1]]))[0] === input[1], true);

  console.log("marketPriceFlagged: a number about to be saved (a lookup's price, a watchlist baseline)");
  const umbreon = (market, extra = {}) => card("fine-umbreon", [{ ...usd("holofoil", market), ...extra }]);
  check("a live price far from the series (a cached or pokemontcg.io number a cent-exact match would miss) is flagged", await marketPriceFlagged(umbreon(900), 900), true);
  check("a normal live price is not", await marketPriceFlagged(umbreon(198), 198), false);
  check("a flag the client sent along is not evidence", await marketPriceFlagged(umbreon(198, { untrusted: { hard: true, reason: "forged" } }), 198), false);
  check("a number no row carries is matched to the series whose latest point it is (Rayquaza 1013.27)", await marketPriceFlagged(card("junk-rayquaza", []), 1013.27), true);
  check("... a stale number is saved (Deoxys 500: a note, not a flag)", await marketPriceFlagged(card("junk-deoxys", []), 500), false);
  check("... and a number nothing explains is not judged", await marketPriceFlagged(card("junk-deoxys", []), 123), false);
  check("no catalog id: nothing to judge", await marketPriceFlagged(card("", [usd("holofoil", 900)]), 900), false);
  check("a prices field that is not a list does not throw (the number is still matched to the series)", await marketPriceFlagged({ ...card("junk-rayquaza", []), prices: null }, 1013.27), true);

  console.log("loadTrustData: overlapping callers share one read");
  clearTrustMemo();
  let reads = 0;
  const realPrepare = db.prepare;
  db.prepare = (sql) => { if (String(sql).includes("FROM price_series")) reads++; return realPrepare(sql); };
  try {
    const ids = [{ cardId: "junk-deoxys", game: "pokemon" }, { cardId: "fine-umbreon", game: "pokemon" }];
    const [a, b, c] = await Promise.all([loadTrustData(ids), loadTrustData(ids), loadTrustData([ids[0]])]);
    check("three concurrent callers cost one series query", reads, 1);
    check("... and every caller gets its cards", [a.size, b.size, c.size], [2, 2, 1]);
    await loadTrustData(ids);
    check("a later call is served from the memo", reads, 1);
    clearTrustMemo();
    db.prepare = () => { throw new Error("db down"); };
    check("heldTrustOrOpen: a failed read is 'no verdicts', not a throw", (await heldTrustOrOpen([{ catalog_card_id: "junk-deoxys", variant: null, game: "pokemon" }])).flag({ catalog_card_id: "junk-deoxys", variant: null, game: "pokemon" }), null);
    let threw = false;
    try { await loadTrustData(ids); } catch { threw = true; }
    check("... while the strict loader still reports the failure, and clears its in-flight entry", [threw, (db.prepare = realPrepare, (await loadTrustData(ids)).size)], [true, 2]);
  } finally {
    db.prepare = realPrepare;
  }
}

console.log(failures === 0 ? "\nAll site price-guard checks passed." : `\n${failures} site price-guard check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
