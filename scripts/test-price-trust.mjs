/**
 * The price guard (lib/server/priceTrust.ts). Run: npm run test:pricetrust
 *
 * Pure function, real series: the fixtures are the 09-30 production rows
 * (run-length encoded, [price, days]) for the three named junk cards and for
 * expensive cards that must survive, plus small hand-built series for each
 * test and threshold. Every "must survive" card is a real card a collector
 * would call correctly priced.
 */
const { priceTrust, stepJump, STEP_JUMP, isRoundPrice, isVintage, PRICE_TRUST } = await import(new URL("../src/lib/server/priceTrust.ts", import.meta.url).href);

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const expand = (rle) => rle.flatMap(([v, n]) => Array(n).fill(v));
const last = (a) => a.filter((v) => v != null).at(-1);
const judge = (series, extra = {}) => priceTrust({ to: last(series), prices: series, ...extra });
const verdict = (series, extra) => {
  const r = judge(series, extra);
  return [r.ok, r.reason];
};
/** A liquid series: moves every day (a real market), ending on `to`. */
const liquid = (to, days = 60) => Array.from({ length: days }, (_, i) => Math.round((to * (1 + ((i * 7) % 5) / 100) - (i % 3)) * 100) / 100).concat(to);

// ---- real 09-30 rows (PokÃ©mon, tcgplayer USD, oldest first, ending on 09-30)
const RAYQUAZA = expand([[101.83, 12], [104.42, 44], [104.66, 13], [107.19, 10], [536.45, 7], [599.46, 3], [679.27, 12], [null, 2], [679.27, 4], [767.94, 1], [1035.13, 9], [1013.27, 19]]); // Call of Legends col1-20 holofoil
const DEOXYS = expand([[174.15, 10], [180, 2], [240, 14], [500, 9], [310, 14], [500, 52], [null, 2], [500, 33]]); // col1-SL1 holofoil
const PIKACHU_PROMO = expand([[999.95, 101], [null, 2], [999.95, 24], [499.99, 9]]); // Black Star promo basep-1 holofoil
const CHARIZARD_BASE = expand([[595.18, 7], [556.84, 4], [572.51, 1], [572.03, 1], [535.22, 2], [580.29, 1], [572.03, 5], [614.49, 2], [627.74, 1], [619.22, 3], [630.39, 11], [644.27, 3], [659.81, 2], [674.34, 1], [694.08, 1], [720.34, 5], [728.31, 6], [773.51, 4], [729.08, 1], [798.38, 2], [800.43, 14], [818.65, 7], [825.38, 4], [845.87, 2], [852.43, 3], [855.52, 8], [null, 2], [855.52, 1], [868.56, 5], [897.19, 7], [869.02, 4], [882.02, 5], [919.98, 3], [944.53, 8]]); // base1-4 holofoil
const UMBREON_VMAX = expand([[2080.84, 1], [2005.12, 1], [2086.96, 1], [2145, 1], [2171, 3], [2015.76, 1], [2022.33, 1], [2089.84, 1], [2005.2, 3], [1954.94, 1], [2103.75, 2], [2261.15, 1], [2181.59, 2], [2261.15, 2], [2181.59, 1], [2261.15, 3], [2292.45, 4], [2271.3, 2], [2205.25, 2], [2206.06, 3], [2276.45, 1], [2210.46, 1], [2144.7, 1], [2210.46, 3], [2276.45, 3], [2204.86, 1], [2204.05, 1], [2242.1, 3], [2320.5, 1], [2318.54, 2], [2332.5, 1], [2336.54, 1], [2351.56, 1], [2396.28, 7], [2242.68, 3], [2137.76, 1], [2396.28, 3], [2404.28, 3], [2416.28, 3], [2319.52, 3], [2416.28, 2], [2396.32, 2], [2327.51, 3], [2335.47, 1], [2259.47, 2], [2244.47, 4], [2328.86, 2], [2410.66, 6], [null, 2], [2380.34, 3], [2235.94, 1], [2380.34, 3], [2310.34, 1], [2298.34, 1], [2368.34, 8], [2300.34, 1], [2302.74, 1], [2299.94, 1], [2283.14, 1], [null, 5], [2368.94, 1], [2299.94, 1], [2214.79, 4], [2283.9, 1]]); // swsh7-215 holofoil
const CHARIZARD_GX = expand([[2326.04, 1], [null, 7], [2144.51, 1], [2547.73, 1], [2546.06, 3], [2323.46, 1], [2824.95, 1], [2493.7, 1], [3194.93, 1], [2472.45, 2], [2782.8, 2], [2474.95, 1], [2782.8, 2], [2785.66, 4], [2785.65, 2], [3194.93, 2], [2785.65, 4], [3194.93, 1], [2492.44, 3], [2463.08, 2], [2796.93, 1], [2968.65, 2], [2636.32, 5], [3411.76, 1], [3624.37, 4], [3202.57, 3], [3278.76, 8], [3783.56, 9], [3957.34, 1], [3510.17, 3], [3957.34, 4], [3215.7, 4], [3157.93, 5], [3215.17, 1], [2776.94, 2], [4166.89, 6], [null, 2], [3783.92, 3], [3833.92, 1], [4271.62, 13], [3837.67, 2], [4271.62, 1], [3784.54, 2], [null, 4], [4499.66, 2], [3913.85, 5]]); // sm9-170 holofoil, no Cardmarket price
const UMBREON_COL1 = expand([[135.06, 6], [154.3, 5], [151.09, 3], [154.3, 36], [173.37, 6], [172.83, 45], [null, 2], [187.26, 3], [162.59, 4], [187.26, 14], [172.83, 7], [198.26, 5]]); // Call of Legends col1-22 holofoil
const M_RAYQUAZA = expand([[343.6, 9], [357.92, 9], [369.45, 4], [373.02, 2], [384.42, 6], [386.45, 3], [397.12, 17], [386.45, 15], [396.92, 1], [406.36, 5], [441.13, 1], [434.72, 5], [427.54, 15], [450.05, 1], [443.61, 6], [436.64, 2], [null, 2], [436.64, 1], [491.57, 6], [499.82, 3], [499.83, 12], [499.82, 2], [null, 1], [499.82, 6], [519.12, 1], [527.73, 1]]); // xy6-105 holofoil, no Cardmarket price
const STEEL_LEGEND = expand([[449.49, 3], [449.23, 16], [463.88, 11], [493.44, 56], [539.75, 10], [569.44, 5], [null, 2], [569.44, 4], [715.55, 1], [569.44, 23], [560.92, 5]]); // hgss4-94 holofoil, no Cardmarket price

console.log("the three named junk cards");
check("Rayquaza col1-20 $1,013: Cardmarket EUR 45 says 20x", verdict(RAYQUAZA, { refEur: 45.13, siblings: [303.32] }), [false, "cardmarket 20.4x"]);
check("Rayquaza with no second source: x5 in a day and never came back", verdict(RAYQUAZA)[1].startsWith("spike 5.0x still 9.5x"));
check("Rayquaza with only its sibling: the reverse holo is a third of it", verdict(RAYQUAZA.slice(0, -1), { siblings: [303.32] })[0], false);
check("Deoxys col1-SL1: a round $500 for 87 days is a listing", verdict(DEOXYS), [false, "flat 87d"]);
check("Pikachu promo basep-1 holofoil $499.99 vs Cardmarket EUR 18.44 (24.6x)", verdict(PIKACHU_PROMO, { refEur: 18.44, siblings: [40.91, 90.46] }), [false, "cardmarket 24.6x"]);
check("the same promo without Cardmarket: 5.5x its own 1st-edition holo", verdict(PIKACHU_PROMO.slice(-9), { siblings: [40.91, 90.46] }), [false, "sibling 5.5x"]);
check("Eevee, McDonald's 2019 #12: $25.92 vs EUR 3.71, one priced day", verdict([25.92], { refEur: 3.71 }), [false, "thin, cardmarket 6.4x"]);

console.log("real expensive cards that must survive");
check("Base Set Charizard $944 (Cardmarket agrees, 0.2x)", judge(CHARIZARD_BASE, { refEur: 4184.6 }).ok);
check("Base Set Charizard with no second source: it moves every few days", judge(CHARIZARD_BASE).ok);
check("Umbreon VMAX alt art $2,284, Cardmarket agrees", judge(UMBREON_VMAX, { refEur: 1579.48 }).ok);
check("Charizard GX rainbow $3,914, no Cardmarket: a liquid market", judge(CHARIZARD_GX).ok);
check("Umbreon col1-22 $198 (Cardmarket 2.3x, reverse holo $135)", verdict(UMBREON_COL1, { refEur: 77.57, siblings: [134.97] }), [true, "cardmarket 2.3x agrees"]);
check("M Rayquaza EX xy6-105 $528, no Cardmarket: priced daily", judge(M_RAYQUAZA).ok);
check("Steel Legend hgss4-94 $561, no Cardmarket: one 1.26x step is not a spike", judge(STEEL_LEGEND).ok);

console.log("test 1: the second source decides when it is there");
check("under $10 nothing is checked", verdict([9, 9, 9], { refEur: 0.5 }), [true, ""]);
check("5x alone no longer fails a liquid card (10-06: Europe runs cheaper on old US holos)", judge(liquid(60), { refEur: 10 }).ok); // 60 / 11 = 5.45x
check("just under 5x is inconclusive, not a fail (from $100)", judge(liquid(117.3), { refEur: 24 }).ok); // 117.3 / 26.4 = 4.4x
check("under $100 a 3-10x gap needs another sign: liquid passes, 10x+ fails, thin fails", [judge(liquid(50), { refEur: 10 }).ok, judge(liquid(50), { refEur: 12.5 }).ok, judge(liquid(50), { refEur: 4.5 }).ok, verdict([...Array(29).fill(49), 50], { refEur: 10 })[0]], [true, true, false, false]); // 4.5x, 3.6x, 10.1x, thin 4.5x
check("under 3x agrees and stops: flat, round and $500 no longer matter", judge(Array(90).fill(500), { refEur: 200 }).ok); // 500 / 220 = 2.3x
check("a EUR 0.02 second-source price is a glitch, not a referee", judge(liquid(30), { refEur: 0.02 }).ok);
check("a 3-5x gap alone never fails ($152.90, liquid)", judge(liquid(152.9), { refEur: 35 }).ok); // 150 / 38.5 = 3.9x
check("a 3-5x gap next to one sign does ($150, thin)", verdict([...Array(29).fill(148), 150], { refEur: 35 })[0], false);
console.log("10-06: a Cardmarket gap is one soft sign, never a verdict below 10x");
const CRESSELIA = [...liquid(17, 120).slice(0, 120).map((v, i) => (i % 9 === 0 ? 17.65 : 16.8 + (i % 4) * 0.1)), 17.23]; // dp4-2 holofoil: steady 140 days
check("Cresselia dp4-2 $17.23 vs EUR 2.85 (5.5x), steady series: ok", judge(CRESSELIA, { refEur: 2.85 }).ok);
const CRESSELIA_LVX = [...Array(60).fill(44.72), 48.54, 48.54, 54.83, 57.86, 57.86, 61.39, 61.39, 61.39, 61.39, 61.39, 61.39].map((v, i) => v + (i % 5) * 0.2).concat(61.39);
check("Cresselia LV.X dp4-103 $61.39 vs EUR 11.30 (5x), steady: ok", judge(CRESSELIA_LVX, { refEur: 11.3 }).ok);
check("a thin series with a 5x gap still flags ($17, flat 25 days)", verdict([...liquid(17, 30), ...Array(25).fill(17)], { refEur: 2.85 })[0], false);
check("a 3-day-old series with a 5x gap still flags", verdict([17.1, 17.2, 17.23], { refEur: 2.85 })[0], false);
check("a 12x gap on a steady series still fails, hard", [judge(liquid(60), { refEur: 4.5 }).ok, judge(liquid(60), { refEur: 4.5 }).hard], [false, true]); // 60 / 4.95 = 12.1x
check("a 12x gap at $250 on a steady series still fails, hard", [judge(liquid(250), { refEur: 19 }).ok, judge(liquid(250), { refEur: 19 }).hard], [false, true]); // 250 / 20.9 = 12.0x
check("$500+ does not need the gap: one sign is enough", judge([...Array(29).fill(597), 600]).ok, false);

console.log("test 2: a spike that never came back (>= $50)");
const spike = (before, after, days = 20) => [...liquid(before, 20).slice(0, 20), ...Array(days).fill(after).map((v, i) => v + (i % 2))];
check("$40 -> $130 in a step and still there fails", judge(spike(40, 130)).ok, false);
check("a 2x step is not a hard spike ($40 -> $95)", judge(spike(40, 95)).ok);
check("a spike that came back is fine ($40 -> $200 -> $45)", judge([...liquid(40, 20).slice(0, 20), 200, 200, 45, 44, 46, 45]).ok);
check("under $50 the spike test does not apply ($12 -> $45)", judge(spike(12, 45)).ok);

console.log("test 3: sibling anchor (>= $50)");
check("3x every other variant fails ($60 vs $15)", judge(liquid(60), { siblings: [15] }).ok, false);
check("the HIGHEST other variant is the anchor ($60 vs $15 and $45)", judge(liquid(60), { siblings: [15, 45] }).ok);
check("under $50 it does not apply ($40 vs $10)", judge(liquid(40), { siblings: [10] }).ok);

console.log("test 4: stuck listing (>= $100) = a NOTE since 10-02 (ok false for the social picks, hard false + stale days for the screens)");
const flat = (v, days) => [...liquid(v * 0.9, 20).slice(0, 20), ...Array(days).fill(v)];
check("$121 flat 45 days is stale", verdict(flat(121, 45)), [false, "flat 45d"]);
check("... hard false, stale = the days: the screens show $121 with the note", [judge(flat(121, 45)).hard, judge(flat(121, 45)).stale], [false, 45]);
check("$121 flat 44 days is only thin: one sign at $100-$499 is fine", judge(flat(121, 44)).ok);
check("$80 flat 200 days is cheap and low-risk", judge(flat(80, 200)).ok);
check("calendar days, not points: a null gap still counts", verdict([...liquid(120, 20), 121, ...Array(20).fill(null), 121, ...Array(30).fill(null), 121], {})[0], false);
check("Deoxys: stale, not wrong (hard false, 87 days)", [judge(DEOXYS).hard, judge(DEOXYS).stale], [false, 87]);
// Charizard Plasma Storm 136 (bw8-136), 10-02: TCGplayer $1,150 flat 128 days, Cardmarket EUR 302.44 (3.5x). eBay sold (read 10-02): raw
// median $745, Near Mint $1,276-$1,651, so $1,150 is a fair NM price. The hide buried it; now it shows with the note and the gap named.
const CHARIZARD_PLASMA = [...liquid(1100, 30), ...Array(128).fill(1150)];
check("Charizard bw8-136 $1,150 flat 128d, Cardmarket 3.5x: shown with the note", judge(CHARIZARD_PLASMA, { refEur: 302.44 }), { ok: false, hard: false, stale: 128, reason: "flat 128d, cardmarket 3.5x" });
check("... the soft signs (round $1,150, thin) do not pile on top of stale", judge(CHARIZARD_PLASMA).hard, false);
check("... a 5x Cardmarket gap no longer hides it by itself (note stays), 12x still does", [judge(CHARIZARD_PLASMA, { refEur: 200 }).stale, judge(CHARIZARD_PLASMA, { refEur: 80 }).hard], [128, true]);
check("... and a spike that never came back still hides it (test 2 runs first)", [judge(RAYQUAZA).hard, judge(RAYQUAZA).stale], [true, undefined]);
check("... and a 3x sibling still hides it (test 3 runs first)", judge(CHARIZARD_PLASMA, { siblings: [300] }).hard, true);
check("the stale note is for a CURRENT price only: as an OLD price flat is still wrong", judge(flat(121, 45), { old: true }), { ok: false, hard: true, reason: "flat 45d" });
// 10-07: Lugia ex Unseen Forces 105 (ex10-105): TCGplayer market $2,500 flat 49 days while the cheapest listing sat at $1,200
// (PriceCharting ungraded $841). The market price is the last sale; a live listing under it says the frozen number is wrong.
const LUGIA_EX = [...liquid(2400, 30), ...Array(49).fill(2500)];
check("Lugia ex10-105 $2,500 flat 49d, cheapest listing $1,200: hidden, hard", judge(LUGIA_EX, { listingLowUsd: 1200 }), { ok: false, hard: true, reason: "flat 49d, 2.1x the cheapest listing" });
check("... exactly 1.5x the cheapest listing hides it too", judge(LUGIA_EX, { listingLowUsd: 2500 / 1.5 }).hard, true);
check("... under 1.5x keeps the note (a played copy listed a bit lower is normal)", judge(LUGIA_EX, { listingLowUsd: 1700 }).stale, 49);
check("... listings ABOVE the frozen price keep the note (nobody undercuts it)", judge(CHARIZARD_PLASMA, { listingLowUsd: 1400 }).stale, 128);
check("... no listing reading = the note as before", judge(LUGIA_EX, { listingLowUsd: null }).stale, 49);
check("a price that is NOT stale ignores the cheapest listing (a liquid market price is a real one)", judge([...liquid(2400, 60), 2512.37], { listingLowUsd: 900 }).ok, true);
check("the cheapest listing never touches an OLD price's reading (already wrong at 30 days)", judge(flat(121, 45), { old: true, listingLowUsd: 50 }).reason, "flat 45d");
// 10-07 test 3b: Skyridge Charizard ecard3-146. Holofoil $10,000 is hidden at 3.3x its Reverse Holofoil; the reverse, $2,999.99
// unmoved 44 days, was still printed. Two printings 3x apart with neither trading say nothing.
const SKY_REVERSE = Array(44).fill(2999.99);
check("Skyridge Charizard reverse $2,999.99 flat 44d, default at $10,000: hidden, hard", judge(SKY_REVERSE, { anchorFor: 10000 }), { ok: false, hard: true, reason: "flat 44d, a sibling at 3.3x" });
const not3b = (t) => !/a sibling at/.test(t.reason);
check("... the same anchor that trades is not touched by 3b (it vouches for itself)", not3b(judge([...liquid(2900, 60), 2999.99], { anchorFor: 10000, vintage: true })), true);
check("... nor one flat under 21 days", not3b(judge([...liquid(2900, 60), ...Array(15).fill(2999.99)], { anchorFor: 10000, vintage: true })), true);
check("... a default under 3x it says nothing (keeps the stale note)", judge(Array(50).fill(2999.99), { anchorFor: 8000 }).stale, 50);
check("... under $100 is not looked at", judge(Array(44).fill(60), { anchorFor: 400 }).ok, true);
check("... never on an OLD price (that reading is its own)", not3b(judge(Array(25).fill(2999.99), { anchorFor: 10000, old: true })), true);

console.log("test 5: graded evidence ($100+)");
check("$250 with one sign (round) passes", judge([...liquid(240, 40), 250]).ok);
check("$250 with two signs (round + thin) fails", verdict([...Array(40).fill(200), 250]), [false, "thin, round"]);
check("$600 needs only one (round)", judge([...liquid(590, 40), 600]).ok, false);
check("$600 thin only (a flat 25 days, not round) fails: a modern card that trades that rarely is unverified", verdict([...liquid(590, 40), ...Array(25).fill(603.17)]), [false, "thin"]);
check("$600 liquid, not round: passes", judge([...liquid(590, 40), 603.17]).ok);
check("$600 with a strong sign alone fails (2x its sibling)", verdict([...liquid(590, 40), 603.17], { siblings: [300] })[0], false);
check("$600 with too few priced days alone fails (unverifiable)", verdict([560, 580, 603.17])[0], false);
check("under 14 priced days is a sign (new + round at $250)", verdict([200, 210, 230, 250], {})[0], false);
check("a 2x rise that held, older than 10 priced days, is a sign (spike + round at $300)", verdict([...liquid(140, 30), 300, ...Array.from({ length: 12 }, (_, i) => 300 + (i % 2) * 0.5), 300], {})[0], false);
check("a 2x sibling is a sign (sibling + round at $250 vs $120)", judge([...liquid(240, 40), 250], { siblings: [120] }).ok, false);
check("under $100 no soft sign applies", judge([...Array(40).fill(90), 95]).ok);

console.log("10-01 review: the price BEFORE the jump is a level, not a spike (short glitch-lows that recover)");
const LUGIA_1ST = expand([[1299.96, 21], [1599.98, 30], [1299.96, 48], [1100.75, 2], [null, 2], [1085.03, 17], [1079.79, 11], [164.8, 4], [1134.85, 1]]); // neo1-9-1st 1st Ed Holo: 164.80 for 4 days, back to 1,135
const HOOH_1ST = expand([[350, 2], [72, 2], [350, 14], [70.01, 4], [488.52, 17], [72, 10], [488.52, 52], [null, 2], [488.52, 33]]); // neo3-7-1st: flaps between 72 and 488, then sits at 488.52 for 87 days
check("1st Ed Lugia $1,135 after a 4-day $165 dip is not a spike (it traded there for a month)", judge(LUGIA_1ST).ok);
check("Rayquaza col1-20 is still a spike: it never traded near $536 before", verdict(RAYQUAZA.slice(0, 92))[1].startsWith("spike"));
check("1st Ed Ho-oh is out for what it is: no sale at $488.52 in 87 days, not a spike (stale, shown with the note)", [...verdict(HOOH_1ST), judge(HOOH_1ST).stale], [false, "flat 87d", 87]);
check("a glitch-low that recovers is not a spike at any price ($150 x60, $40 x5, $150)", judge([...Array(60).fill(0).map((_, i) => 150 + (i % 4)), ...Array(5).fill(40), 150]).ok);
check("one earlier blip does not turn a real spike into a recovery ($100 x60, $520 once, $100 x3, $530)", verdict([...liquid(100, 60), 520, 100, 100, 100, 530])[0], false);

console.log("10-01 review: below $100 a 3-5x Cardmarket gap is not free");
check("bw11-RC7 Pikachu $97.72 vs EUR 23.56 (3.8x), 3 priced days in 27: unverifiable", verdict([97.11, ...Array(21).fill(null), 97.56, null, null, null, 97.72], { refEur: 23.56 }), [false, "thin, cardmarket 3.8x"]);
check("2019sm-6 Pikachu $36.82 vs EUR 8.64 (3.9x), 4 priced days", verdict([36.5, 36.6, 36.7, 36.82], { refEur: 8.64 })[0], false);
check("a soft failure says so (hard = false): the site can show 'unverified'", judge([36.5, 36.6, 36.7, 36.82], { refEur: 8.64 }).hard, false);
check("Rayquaza GX sm7-109 $37.59 vs EUR 7.52 (4.5x), liquid: a gap alone is one sign, not enough", judge(liquid(37.59), { refEur: 7.52 }).ok);
check("a liquid $60 at 3.6x still passes (the gap alone never fails)", judge(liquid(60), { refEur: 15 }).ok);
check("a 3.6x gap next to a flat 21+ days fails at $40", verdict([...liquid(40, 30), ...Array(22).fill(40)], { refEur: 10 })[0], false);

console.log("10-01 review: a vintage print is not junk for being thin or round (1st Editions, pre-2010 sets)");
check("$10,000 1st Ed Charizard (thin + round) is a vintage print: passes", judge([...Array(20).fill(9500), 10000], { vintage: true }).ok);
check("the same numbers on a modern card are unverified, not wrong", [judge([...Array(20).fill(9500), 10000]).ok, judge([...Array(20).fill(9500), 10000]).hard], [false, false]);
check("Magikarp & Wailord GX $882.13 (modern) flat 22 days, no second source: still unverified", verdict([...liquid(880, 40), ...Array(22).fill(882.13)]), [false, "thin"]);
check("vintage still needs to trade: flat 45 days is stale at any age (a note, not a hide)", [...verdict(Array(50).fill(1200.5), { vintage: true }), judge(Array(50).fill(1200.5), { vintage: true }).stale], [false, "flat 50d", 50]);
check("the excuse starts at $500: a vintage $250 that is thin and round still fails", verdict([...Array(40).fill(200), 250], { vintage: true })[0], false);
check("a second source that disagrees (3-5x) takes the excuse away ($949 vintage, thin, Cardmarket 4.0x)", verdict([...liquid(940, 40), ...Array(22).fill(949.79)], { vintage: true, refEur: 216 })[0], false);
check("a vintage sign that is not thin or round still counts (spike at $1,900)", verdict([...liquid(900, 30), 1900, 1900, ...Array(12).fill(1899.99)], { vintage: true })[0], false);
check("vintage does not excuse a sibling gap (3x its unlimited)", verdict([...liquid(900, 40), 903.17], { vintage: true, siblings: [300] })[0], false);
check("isVintage: 1st Edition, pre-2010 sets, in both date spellings", [isVintage("1stEditionHolofoil"), isVintage("holofoil", "2002-09-01"), isVintage("holofoil", "2009/12/31"), isVintage("holofoil", "2010-01-01"), isVintage("holofoil", "")], [true, true, true, false, false]);

console.log("10-01 review: a fresh doubling to $100+ needs a second source");
const MACHAMP = expand([[64.05, 24], [64.44, 4], [64.76, 8], [64.67, 1], [64.55, 7], [63.96, 10], [null, 2], [64.32, 5], [80, 1], [64.32, 16], [64.42, 8], [145.85, 3]]); // dp7-98 holofoil
check("Machamp dp7-98 $64 -> $146 in one step 3 days ago, no Cardmarket: junk", verdict(MACHAMP)[1].startsWith("doubled 2.3x"));
check("the same move with Cardmarket agreeing (EUR 110) is a real one", judge(MACHAMP, { refEur: 110 }).ok);
check("a doubling older than 10 priced days is judged by the soft signs only", judge([...MACHAMP.slice(0, -3), ...liquid(146, 12)]).ok);
check("a recovery from a glitch-low is not a doubling (ecard1-4 Blastoise $400 -> $94 -> $251)", judge(expand([[400, 57], [400, 26], [251.55, 2], [94.22, 4], [251.55, 1]])).ok);

console.log("10-01 review: the OLD price of a move is judged strictly (old: true)");
const oldSide = (series, back = 7) => { const cut = series.slice(0, series.length - back); return priceTrust({ to: last(cut), prices: cut, old: true }); };
const METAGROSS = expand([[15.5, 5], [15.93, 2], [15.5, 7], [15.75, 22], [null, 14], [15.75, 2], [null, 10], [15.5, 20], [null, 9], [15.5, 1], [null, 5], [15.5, 4], [null, 2], [15.5, 3], [null, 4], [15.5, 21], [10, 5]]); // ex8-11 normal: parked at $15.50 for months, then $10
check("Metagross $15.50 -> $10: a $15.50 listing parked for 30+ days is no old price", [oldSide(METAGROSS).ok, oldSide(METAGROSS).reason.startsWith("flat")], [false, true]);
check("the same $15.50 as a current price is fine (the flat rule is for the old side, from $10)", judge(METAGROSS.slice(0, -5)).ok);
const TYRANITAR = expand([[670, 60], [507.5, 38], [null, 2], [507.5, 8], [345, 2], [662.25, 18], [345, 5]]); // neo4-113 unlimited holo: 345 -> 662.25 for 18 days -> 345
check("Shining Tyranitar $662 -> $345: the $662 was a plateau, thin, so not an old price", oldSide(TYRANITAR), { ok: false, hard: false, reason: "thin" });
check("old: thin alone fails from $500 even on a vintage print", priceTrust({ to: 662.25, prices: TYRANITAR.slice(0, -7), old: true, vintage: true }).ok, false);
check("the $345 side, printed as a current price: fine", judge(TYRANITAR).ok);
const BLASTOISE_ECARD = expand([[400, 15], [568, 13], [400, 3], [260.1, 4], [260, 9], [400, 57], [null, 2], [400, 26], [251.55, 2], [94.22, 4], [251.55, 1]]); // ecard1-4 holofoil
check("Blastoise ecard1-4 $400 -> $252: $400 sat for 85 days", oldSide(BLASTOISE_ECARD).reason, "flat 85d");
check("a moving old price passes as before ($944 Base Charizard a week ago)", oldSide(CHARIZARD_BASE, 0).ok);
check("under $10 nothing is checked, old or not", priceTrust({ to: 8, prices: Array(60).fill(8), old: true }).ok);

console.log("10-01 review: the step-jump rule for movers (stepJump, not part of priceTrust)");
// ru1-13 PokÃ©mon Rumble Skuntank normal, 09-30: $52.07-$52.69 for 4+ months, then ONE overnight step to $89.98, flat since (+71%). priceTrust calls it fine (under $100, no 3x).
const SKUNTANK = expand([[52.2, 70], [52.37, 6], [52.07, 4], [null, 2], [52.07, 14], [52.53, 4], [52.67, 7], [52.37, 3], [89.98, 3]]);
// ex1-7 Ruby & Sapphire Gardevoir holofoil: a climb in stairs over four months, $75.19 -> $106.30 in the week. A genuine rise.
const GARDEVOIR = expand([[50, 60], [57.14, 5], [64.79, 2], [69.15, 3], [null, 2], [71.84, 15], [75.19, 14], [78.4, 3], [106.3, 3]]);
// Magic Library of Leng, Unlimited: $13.67 / $13.44 for a month and a half (a week with no points), then $23.75. Cardmarket EUR 8.
const LENG = expand([[14.27, 5], [14.23, 3], [null, 2], [13.67, 3], [null, 1], [13.67, 14], [null, 8], [13.44, 5], [23.75, 2]]);
const jumped = (prices, extra = {}) => stepJump({ prices, days: 7, ...extra });
check("Skuntank: ordinary to priceTrust (it is the mover rule that stops it)", judge(SKUNTANK).ok);
check("Skuntank $52 -> $90: one 1.7x step after 110 days flat, no Cardmarket at all", jumped(SKUNTANK), { jump: true, reason: "step 1.7x in one day after 110d flat" });
check("Gardevoir $75 -> $106: a staircase, the step comes after movement, not a flat stretch", jumped(GARDEVOIR).jump, false);
check("Library of Leng $13 -> $24 vs Cardmarket EUR 8: a lone step, nothing near it", jumped(LENG, { refEur: 8 }).jump);
check("a second source already near the new price confirms it (Cardmarket EUR 70 = $77 for Skuntank)", jumped(SKUNTANK, { refEur: 70 }).jump, false);
check("a second source far below does not (EUR 20 = $22)", jumped(SKUNTANK, { refEur: 20 }).jump);
check("a Cardmarket series that rose >= 10% over the window confirms it", jumped(SKUNTANK, { refEur: 20, refPrices: [...Array(30).fill(18), 19, 20, 21, 22, 22, 22, 22, 22] }).jump, false);
check("a Cardmarket series that sat still does not", jumped(SKUNTANK, { refEur: 20, refPrices: Array(40).fill(20) }).jump);
check("under 30 days of flat history there is nothing to call flat (a new card)", jumped(expand([[52.2, 20], [89.98, 3]])).jump, false);
check("the same step 29 days into the flat stretch is still too young, 30 is not", [jumped(expand([[52.2, 29], [89.98, 3]])).jump, jumped(expand([[52.2, 30], [89.98, 3]])).jump], [false, true]);
check("a +25% step is under the 30% bar", jumped(expand([[52.2, 90], [65.25, 3]])).jump, false);
check("a +30% step is the bar", jumped(expand([[50, 90], [65, 3]])).jump);
check("a step already given back is not the price now", jumped(expand([[52.2, 90], [89.98, 2], [55, 2]])).jump, false);
check("a step that landed before the window (10 days ago) is the old news the 7-day move no longer contains", jumped(expand([[52.2, 90], [89.98, 10]])).jump, false);
check("a drift of a few percent either way still counts as flat (+-3%)", jumped(expand([[52.2, 20], [53.5, 10], [51.0, 10], [52.2, 20], [89.98, 3]])).jump);
check("a wobble of 5% does not (the stretch breaks)", jumped(expand([[48, 20], [52.2, 10], [55, 10], [52.2, 20], [89.98, 3]])).jump, false);
check("a drop is never a step jump (the rule only reads rises)", jumped(expand([[89.98, 90], [52.2, 3]])).jump, false);
check("an ordinary liquid card is never flagged", jumped(liquid(90)).jump, false);
check("a card with no points is not flagged", [jumped([]).jump, jumped([null, null, 5]).jump], [false, false]);
check("thresholds are the calibrated ones", [STEP_JUMP.stepMin, STEP_JUMP.flatBand, STEP_JUMP.flatDays, STEP_JUMP.confirmLevel, STEP_JUMP.confirmMove], [1.3, 0.03, 30, 1.5, 0.1]);

console.log("isRoundPrice");
check("$1,013.27 is not round", isRoundPrice(1013.27), false);
check("$500 and $499.99 and $999.95 are", [isRoundPrice(500), isRoundPrice(499.99), isRoundPrice(999.95)], [true, true, true]);
check("$749.98, $1,249.94 (x4.94) and $2,500.99 are not", [isRoundPrice(749.98), isRoundPrice(1249.94), isRoundPrice(2500.99)], [false, false, false]);
check("under $100 never round", isRoundPrice(99.99), false);
check("thresholds are the calibrated ones", [PRICE_TRUST.refExtreme, PRICE_TRUST.refClear, PRICE_TRUST.spikeRise, PRICE_TRUST.spikeHold, PRICE_TRUST.siblingFail, PRICE_TRUST.stuckDays, PRICE_TRUST.staleOldDays, PRICE_TRUST.softNeed, PRICE_TRUST.softNeedBig], [10, 3, 3, 3, 3, 45, 30, 2, 1]);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
