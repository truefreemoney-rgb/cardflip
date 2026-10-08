/**
 * Second price sources (lib/server/priceBackups.ts). Run: npm run test:pricebackups
 *
 * Pins: TCGdex → pokemontcg.io id mapping (renamed sets, zero padding kept
 * only on non-numeric ids); pokemontcg.io prices land in our variant names,
 * 1st Edition keys on the "-1st" twin, nothing under 5¢ for a new series,
 * nothing twice for a card tcgcsv already wrote; YGOPRODeck printings match
 * on collector number + rarity (case-insensitive), a code with one rarity
 * matches without it, a code with two rarities needs the rarity, "-1st"
 * twins get no point.
 */
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { pokemontcgIoId, pokemontcgIoUpserts, ygoprodeckPriceMap, ygoprodeckPoints } = await import(at("lib/server/priceBackups.ts"));
const { decodePrices } = await import(at("lib/priceSeries.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

check("ids: renamed set + padding dropped", [pokemontcgIoId("sv03-001"), pokemontcgIoId("base1-4"), pokemontcgIoId("sv03.5-012"), pokemontcgIoId("swsh12pt5-TG04"), pokemontcgIoId("lc-3")], ["sv3-1", "base1-4", "sv3pt5-12", "swsh12pt5-TG04", "base6-3"]);

const day = "2026-10-08";
const io = new Map([["sv3-6", "sv03-006"], ["base1-4", "base1-4"]]);
const twins = new Set(["base1-4-1st"]);
const existing = new Map([["sv03-006|normal", { startDay: "2026-10-01", prices: JSON.stringify([0.1, 0.11, 0.12, 0.12, 0.12, 0.12, 0.12]) }]]);
const touched = new Set(["sv03-006|reverseHolofoil"]);
const ups = pokemontcgIoUpserts(
  [
    { id: "sv3-6", tcgplayer: { prices: { normal: { market: 0.13 }, reverseHolofoil: { market: 0.2 }, holofoil: { market: 0.02 } } } },
    { id: "base1-4", tcgplayer: { prices: { holofoil: { market: 928.32 }, "1stEditionHolofoil": { market: 5000 }, unlimitedNormal: { market: null } } } },
    { id: "zzz-1", tcgplayer: { prices: { normal: { market: 9 } } } },
  ],
  io, twins, existing, touched, day,
);
check("pokemon: normal extends the series, reverse skipped (tcgcsv wrote it), 2¢ holo skipped as new, 1st Edition → twin, unknown id skipped",
  ups.map((u) => [u.cardId, u.variant, decodePrices(u.prices).at(-1)]),
  [["sv03-006", "normal", 0.13], ["base1-4", "holofoil", 928.32], ["base1-4-1st", "1stEditionHolofoil", 5000]]);
check("pokemon: extended series keeps its start day and gets today's point", [ups[0].startDay, decodePrices(ups[0].prices).length], ["2026-10-01", 8]);

const prices = ygoprodeckPriceMap([
  { card_sets: [{ set_code: "SUDA-EN049", set_rarity: "Quarter Century Secret Rare", set_price: "74.49" }, { set_code: "SUDA-EN049", set_rarity: "Secret Rare", set_price: "20" }] },
  { card_sets: [{ set_code: "ysds-en029", set_rarity: "Common", set_price: "0.12" }, { set_code: "ZZZ-EN001", set_rarity: "Rare", set_price: "0" }] },
]);
const pts = ygoprodeckPoints(
  [
    { id: "ygo-610873", collector_number: "SUDA-EN049", rarity: "Quarter Century Secret Rare" },
    { id: "ygo-610873-1st", collector_number: "SUDA-EN049", rarity: "Quarter Century Secret Rare" },
    { id: "ygo-610874", collector_number: "SUDA-EN049", rarity: "Ultra Rare" },
    { id: "ygo-26399", collector_number: "YSDS-EN029", rarity: "common" },
    { id: "ygo-26400", collector_number: "YSDS-EN029", rarity: null },
    { id: "ygo-1", collector_number: "ZZZ-EN001", rarity: "Rare" },
  ],
  prices,
);
check("yugioh: exact rarity match, twin skipped, wrong rarity on a two-rarity code skipped, case-insensitive, single-rarity code matches without rarity, $0 skipped",
  pts.map((p) => [p.id, p.usd]), [["ygo-610873", 74.49], ["ygo-26399", 0.12], ["ygo-26400", 0.12]]);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
