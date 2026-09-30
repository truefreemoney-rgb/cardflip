/**
 * The price guard (lib/server/priceTrust.ts). Run: npm run test:pricetrust
 *
 * Pure function, real series: the fixtures are the 09-30 production rows
 * (run-length encoded, [price, days]) for the three named junk cards and for
 * expensive cards that must survive, plus small hand-built series for each
 * test and threshold. Every "must survive" card is a real card a collector
 * would call correctly priced.
 */
const { priceTrust, isRoundPrice, PRICE_TRUST } = await import(new URL("../src/lib/server/priceTrust.ts", import.meta.url).href);

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

// ---- real 09-30 rows (Pokémon, tcgplayer USD, oldest first, ending on 09-30)
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
check("Eevee, McDonald's 2019 #12: $25.92 vs EUR 3.71, one priced day", verdict([25.92], { refEur: 3.71 }), [false, "cardmarket 6.4x"]);

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
check("5x fails even for a liquid card", judge(liquid(60), { refEur: 10 }).ok, false); // 60 / 11 = 5.45x
check("just under 5x is inconclusive, not a fail", judge(liquid(50), { refEur: 10 }).ok); // 50 / 11 = 4.5x
check("under 3x agrees and stops: flat, round and $500 no longer matter", judge(Array(90).fill(500), { refEur: 200 }).ok); // 500 / 220 = 2.3x
check("a EUR 0.02 second-source price is a glitch, not a referee", judge(liquid(30), { refEur: 0.02 }).ok);
check("a 3-5x gap alone never fails ($152.90, liquid)", judge(liquid(152.9), { refEur: 35 }).ok); // 150 / 38.5 = 3.9x
check("a 3-5x gap next to one sign does ($150, thin)", verdict([...Array(29).fill(148), 150], { refEur: 35 })[0], false);
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

console.log("test 4: stuck listing (>= $100)");
const flat = (v, days) => [...liquid(v * 0.9, 20).slice(0, 20), ...Array(days).fill(v)];
check("$121 flat 45 days fails", verdict(flat(121, 45)), [false, "flat 45d"]);
check("$121 flat 44 days is only thin: one sign at $100-$499 is fine", judge(flat(121, 44)).ok);
check("$80 flat 200 days is cheap and low-risk", judge(flat(80, 200)).ok);
check("calendar days, not points: a null gap still counts", verdict([...liquid(120, 20), 121, ...Array(20).fill(null), 121, ...Array(30).fill(null), 121], {})[0], false);

console.log("test 5: graded evidence ($100+)");
check("$250 with one sign (round) passes", judge([...liquid(240, 40), 250]).ok);
check("$250 with two signs (round + thin) fails", verdict([...Array(40).fill(200), 250]), [false, "thin, round"]);
check("$600 needs only one (round)", judge([...liquid(590, 40), 600]).ok, false);
check("$600 liquid, not round: passes", judge([...liquid(590, 40), 603.17]).ok);
check("under 14 priced days is a sign (new + round at $250)", verdict([200, 210, 230, 250], {})[0], false);
check("a 2x rise that held is a sign (spike + round at $300)", verdict([...liquid(140, 30), 300, 300], {})[0], false);
check("a 2x sibling is a sign (sibling + round at $250 vs $120)", judge([...liquid(240, 40), 250], { siblings: [120] }).ok, false);
check("under $100 no soft sign applies", judge([...Array(40).fill(90), 95]).ok);

console.log("isRoundPrice");
check("$1,013.27 is not round", isRoundPrice(1013.27), false);
check("$500 and $499.99 and $999.95 are", [isRoundPrice(500), isRoundPrice(499.99), isRoundPrice(999.95)], [true, true, true]);
check("$749.98, $1,249.94 (x4.94) and $2,500.99 are not", [isRoundPrice(749.98), isRoundPrice(1249.94), isRoundPrice(2500.99)], [false, false, false]);
check("under $100 never round", isRoundPrice(99.99), false);
check("thresholds are the calibrated ones", [PRICE_TRUST.refFail, PRICE_TRUST.refClear, PRICE_TRUST.spikeRise, PRICE_TRUST.spikeHold, PRICE_TRUST.siblingFail, PRICE_TRUST.stuckDays, PRICE_TRUST.softNeed, PRICE_TRUST.softNeedBig], [5, 3, 3, 3, 3, 45, 2, 1]);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
