/**
 * The Printing dropdown's rows come from our own price_series when the
 * upstream (pokemontcg.io) has none — or is too slow to answer.
 * Run: npm run test:printings
 *
 * Pins (09-28, twice in one day): Harlequin 083/086 White Flare has normal /
 * reverse / Poké Ball pattern rows in price_series and NO upstream join, so
 * splitFirstEditionPrices must hand back every own variant. The morning fix
 * did that only on the fast path; the search route's slow-upstream fallback
 * shipped ONE held price and the dropdown vanished (Chris: "why is the
 * dropdown gone"). The route's fallback now runs this same merge, so this is
 * the invariant to keep: a card with no prices in gets all its own printings
 * out, and a card that already has one keeps it and gains the rest.
 *
 * Same throwaway-db trick as test-cards.mjs: chdir to a temp dir before any
 * import so `data/cardflip.db` lands there.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-printings-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { splitFirstEditionPrices } = await import(at("lib/server/enCards.ts"));
const { upsertSeriesRows } = await import(at("lib/server/priceBulkWrite.ts"));
const { encodePrices } = await import(at("lib/priceSeries.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const day = "2026-09-01";
const row = (cardId, variant, series) => ({
  cardId,
  game: "pokemon",
  variant,
  source: "tcgplayer",
  currency: "USD",
  startDay: day,
  prices: encodePrices(series),
  updatedDay: "2026-09-28",
});
await upsertSeriesRows([
  row("sv10.5w-083", "normal", [0.17, 0.18, null, 0.18]),
  row("sv10.5w-083", "reverseHolofoil", [0.18, 0.19, null]),
  row("sv10.5w-083", "pokeBallPattern", [0.37]),
  // A series whose every point is null must not produce a row.
  row("sv10.5w-083", "holofoil", [null, null]),
  // Euro rows belong to Cardmarket and never to the dropdown.
  { ...row("sv10.5w-083", "normal", [0.15]), source: "cardmarket", currency: "EUR" },
]);

const harlequin = {
  id: "sv10.5w-083",
  name: "Harlequin",
  setName: "White Flare",
  setSeries: "",
  number: "083",
  rarity: null,
  imageSmall: "",
  imageLarge: "",
  englishName: null,
  prices: [],
};
const variants = (cards) => cards[0].prices.map((p) => `${p.variant}=${p.market}`).sort();

console.log("Own printings fill a card the upstream left unpriced:");
check(
  "normal + reverse + Poké Ball pattern, last non-null point each, no all-null or EUR rows",
  variants(await splitFirstEditionPrices([harlequin])),
  ["normal=0.18", "pokeBallPattern=0.37", "reverseHolofoil=0.19"],
);
check(
  "labels read as the dropdown shows them",
  (await splitFirstEditionPrices([harlequin]))[0].prices.map((p) => p.label).sort(),
  ["Normal", "Poké Ball Pattern", "Reverse Holofoil"],
);

console.log("\nAn upstream price is kept, the rest are added:");
const upstream = {
  ...harlequin,
  prices: [{ source: "tcgplayer", variant: "normal", label: "Normal", currency: "USD", market: 0.2, low: null, high: null }],
};
check(
  "upstream normal wins, own reverse + pattern join it",
  variants(await splitFirstEditionPrices([upstream])),
  ["normal=0.2", "pokeBallPattern=0.37", "reverseHolofoil=0.19"],
);

console.log("\nA card with no series of its own is untouched:");
check("empty in, empty out", (await splitFirstEditionPrices([{ ...harlequin, id: "sv10.5w-001" }]))[0].prices, []);

console.log("\nOne batch, many cards:");
const both = await splitFirstEditionPrices([harlequin, { ...harlequin, id: "sv10.5w-001" }]);
check("each card gets its own rows only", [both[0].prices.length, both[1].prices.length], [3, 0]);

if (failures) {
  console.log(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll own-printings checks passed.");
process.exit(0);
