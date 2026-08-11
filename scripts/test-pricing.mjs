/**
 * Exercises currency handling in the pricing model.
 * Run: npm run test:pricing
 *
 * The bug this pins: Cardmarket quotes euros, every price was rendered with a
 * "$", and quotePrice fed whatever it picked straight into a USD eBay asking
 * price. A Base Set Charizard showed "Cardmarket $4184.60" — a euro figure
 * wearing a dollar sign, one dropdown click away from becoming the listing.
 */
import {
  canPriceListing,
  formatMoney,
  pickPrice,
  quotePrice,
} from "../src/lib/listing.ts";

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const usd = (market, variant = "holofoil") => ({
  source: "tcgplayer",
  currency: "USD",
  variant,
  label: "Holofoil",
  market,
  low: null,
  high: null,
});

const eur = (market) => ({
  source: "cardmarket",
  currency: "EUR",
  variant: "average",
  label: "Average (EUR)",
  market,
  low: null,
  high: null,
});

const card = (prices) => ({
  id: "x",
  name: "Charizard",
  setName: "Base Set",
  setSeries: "",
  number: "4",
  rarity: null,
  imageSmall: "",
  imageLarge: "",
  englishName: null,
  prices,
});

console.log("\nMoney renders in its own currency:");
check("dollars", formatMoney(818.65, "USD"), "$818.65");
check("euros", formatMoney(4184.6, "EUR"), "€4184.60");
check("defaults to USD", formatMoney(10), "$10.00");
check("absent", formatMoney(null, "EUR"), "—");

console.log("\nOnly dollar prices can set a dollar asking price:");
check("USD qualifies", canPriceListing(usd(10)), true);
check("EUR does not", canPriceListing(eur(10)), false);

console.log("\npickPrice never returns a euro price:");
check(
  "prefers the USD row when both exist",
  pickPrice(card([eur(4184.6), usd(818.65)]))?.currency,
  "USD",
);
check(
  "euro-only card has no listing price at all",
  pickPrice(card([eur(4184.6)])),
  null,
);

console.log("\nThe regression: a euro figure must never become the listing price:");
{
  // The exact shape that produced "Cardmarket $4184.60" next to TCGplayer $818.65.
  const real = card([usd(818.65), eur(4184.6)]);
  const quote = quotePrice(real, "Near Mint", "market");
  check("quotes the dollar price", quote?.base, 818.65);
  check("and reports it as USD", quote?.price.currency, "USD");

  // Selecting the Cardmarket row in the Printing dropdown used to hand
  // quotePrice a euro number to treat as dollars.
  const overridden = quotePrice(real, "Near Mint", "market", "average");
  check("a euro override falls back to the dollar price", overridden?.base, 818.65);
  check("rather than 4184.60", overridden?.base === 4184.6, false);
}

console.log("\nA euro-only card yields no quote, rather than a wrong one:");
check(
  "no quote",
  quotePrice(card([eur(4184.6)]), "Near Mint", "market"),
  null,
);

console.log("\nCondition and strategy still apply to dollar prices:");
{
  const q = quotePrice(card([usd(100)]), "Lightly Played", "market");
  check("100 at Lightly Played (0.85)", q?.suggested, 85);
}

console.log(
  failures === 0
    ? "\nAll pricing checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
