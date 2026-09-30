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
const { judgeSeries, siteTrust, withPriceFlags, loadTrustData, clearTrustMemo, trustKey } = await import(at("lib/server/priceTrustSite.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { addDays, todayUtc, encodePrices } = await import(at("lib/priceSeries.ts"));
const { PRICE_FLAG_NOTE } = await import(at("lib/priceFlag.ts"));
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
check("Rayquaza with no second source: the spike never came back", verdict(data("pokemon", [ser("holofoil", RAYQUAZA)]))?.[1]?.startsWith("spike"), true);
check("Deoxys: a round $500 for 87 days is a listing", verdict(data("pokemon", [ser("holofoil", DEOXYS)])), [true, "flat 87d"]);
check("a liquid $300 card is fine", verdict(data("pokemon", [ser("holofoil", liquid(300))])), null);
check("a $12 card is never looked at", verdict(data("pokemon", [ser("normal", [12, 12, 12])], { cmEur: 0.5 })), null);
check("soft signs only come back as unverified (hard false)", verdict(data("pokemon", [ser("holofoil", liquid(499.99, 8))])), [false, "round, 9 priced days"]);
check("a card with no series at all is not judged on soft signs", verdict(data("pokemon", []), { liveUsd: 250, variant: "holofoil", exact: true }), null);
check("... but a second source that says 5x still proves it wrong", verdict(data("pokemon", [], { cmEur: 20 }), { liveUsd: 250, variant: "holofoil", exact: true })?.[0], true);

console.log("held variant and siblings");
{
  const d = data("pokemon", [ser("normal", liquid(20)), ser("holofoil", liquid(90))]);
  check("default variant judged on the normal line", verdict(d), null);
  check("the held holofoil is judged on ITS line, not the default", verdict(data("pokemon", [ser("normal", liquid(20)), ser("holofoil", DEOXYS)]), { variant: "holofoil" }), [true, "flat 87d"]);
  check("... while the default normal line of the same card stays fine", verdict(data("pokemon", [ser("normal", liquid(20)), ser("holofoil", DEOXYS)])), null);
  check("a held variant with no line of its own falls back to the default", verdict(data("pokemon", [ser("holofoil", DEOXYS)]), { variant: "reverseHolofoil" }), [true, "flat 87d"]);
  check("... unless the caller asks for that printing exactly", verdict(data("pokemon", [ser("holofoil", DEOXYS)]), { variant: "reverseHolofoil", exact: true }), null);
  const sib = data("pokemon", [ser("normal", liquid(160)), ser("holofoil", liquid(40))]);
  check("sibling anchor on the default: $160 normal vs a $40 holo is 4x", verdict(sib), [true, "sibling 4.0x"]);
  check("no sibling test for a non-default printing (a holo is 3x its reverse legitimately)", verdict(data("pokemon", [ser("holofoil", liquid(120)), ser("reverseHolofoil", liquid(30))]), { variant: "reverseHolofoil" }), null);
  check("Magic foil at 3x+ its nonfoil is normal", verdict(data("mtg", [ser("nonfoil", liquid(60)), ser("foil", liquid(240))]), { variant: "foil" }), null);
  check("Lorcana foil at 3x+ its normal is normal", verdict(data("lorcana", [ser("normal", liquid(60, 20)), ser("foil", liquid(240, 20))]), { variant: "foil" }), null);
}

console.log("Magic: the finish's own Cardmarket price is the referee");
{
  const d = data("mtg", [ser("nonfoil", liquid(150)), ser("foil", liquid(150))], { eur: { nonfoil: 120, foil: 20 } });
  check("nonfoil $150 vs EUR 120 agrees", verdict(d, { variant: "nonfoil" }), null);
  check("foil $150 vs foil EUR 20 is 6.8x: flagged", verdict(d, { variant: "foil" }), [true, "cardmarket 6.8x"]);
  check("etched reads the foil EUR too", verdict(data("mtg", [ser("etched", liquid(150))], { eur: { nonfoil: 120, foil: 20 } }), { variant: "etched" })?.[0], true);
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
  const flags = await siteTrust([
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
  check("Deoxys holofoil flagged flat", flags.get(trustKey("junk-deoxys", "holofoil"))?.reason, "flat 87d");
  check("... its normal line is not", flags.has(trustKey("junk-deoxys", "normal")), false);
  check("Magic foil flagged on the foil EUR, nonfoil not", [flags.has(trustKey("mtg-junk", "foil")), flags.has(trustKey("mtg-junk", "nonfoil")), flags.has(trustKey("mtg-fine", "nonfoil"))], [true, false, false]);
  check("a card the price table has never seen is not flagged", flags.size, 3);
  const loaded = await loadTrustData([{ cardId: "ebay-only", game: "pokemon" }]);
  check("eBay series are not read by the rule", loaded.get("ebay-only").series.length, 0);

  console.log("withPriceFlags: cards on their way to a screen");
  const card = (id, prices, game) => ({ id, name: id, setName: "X", setSeries: "", number: "1", rarity: null, imageSmall: "", imageLarge: "", englishName: null, prices, ...(game ? { game } : {}) });
  const usd = (variant, market) => ({ source: "tcgplayer", variant, label: variant, currency: "USD", market, low: null, high: null });
  const eurRow = { source: "cardmarket", variant: "holofoil", label: "Cardmarket", currency: "EUR", market: 45.13, low: null, high: null };
  const input = [card("junk-rayquaza", [usd("holofoil", 1013.27), eurRow]), card("fine-umbreon", [usd("holofoil", 198)]), card("mtg-junk", [usd("nonfoil", 150), usd("foil", 150)], "mtg")];
  const before = JSON.stringify(input);
  const out = await withPriceFlags(input);
  check("the flagged USD row carries untrusted", out[0].prices[0].untrusted, { hard: true, reason: "cardmarket 20.4x" });
  check("the Cardmarket EUR row is never flagged", out[0].prices[1].untrusted === undefined);
  check("a normal card comes back as the same object", out[1] === input[1], true);
  check("Magic: only the flagged finish", out[2].prices.map((p) => !!p.untrusted), [false, true]);
  check("the input (and so the card cache behind it) is not mutated", JSON.stringify(input), before);
  check("note text is one sentence", PRICE_FLAG_NOTE, "This price looks off, check sold listings");
  check("no flagged card: same array back", (await withPriceFlags([input[1]]))[0] === input[1], true);
}

console.log(failures === 0 ? "\nAll site price-guard checks passed." : `\n${failures} site price-guard check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
