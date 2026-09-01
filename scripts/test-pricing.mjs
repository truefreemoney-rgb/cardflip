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
  buildListing,
  buildSealedListing,
  canBeFirstEdition,
  canPriceListing,
  describeItemCondition,
  ebaySoldSearchUrl,
  firstEditionPrice,
  formatMoney,
  pickPrice,
  quoteForItem,
  quotePrice,
} from "../src/lib/listing.ts";
import {
  gradeLabel,
  gradesFor,
  makeSealedProduct,
  parseGradeQuery,
  setLogoFromCardImage,
} from "../src/lib/grading.ts";

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
check("euros", formatMoney(4184.6, "EUR"), "€4,184.60");
check("thousands grouped", formatMoney(1499, "USD"), "$1,499.00");
check("small values unchanged", formatMoney(9.5, "USD"), "$9.50");
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

console.log("\n1st Edition is opt-in, never the silent default:");
{
  // A Jungle holo as pokemontcg.io actually prices it: both printings, with
  // the 1st Edition several times the unlimited copy the seller is holding.
  const jungle = {
    ...card([usd(37.57, "unlimitedHolofoil"), usd(122.03, "1stEditionHolofoil")]),
    setName: "Jungle",
  };
  check(
    "default quote is the unlimited printing",
    pickPrice(jungle)?.variant,
    "unlimitedHolofoil",
  );
  check(
    "the 1st Edition price is there when asked for",
    firstEditionPrice(jungle)?.market,
    122.03,
  );
  check(
    "and drives the quote as an override",
    quotePrice(jungle, "Near Mint", "market", "1stEditionHolofoil")?.base,
    122.03,
  );
  check(
    "non-holos use the bare 1stEdition key",
    firstEditionPrice({
      ...jungle,
      prices: [usd(0.3, "unlimited"), usd(3.94, "1stEdition")],
    })?.market,
    3.94,
  );
}

console.log("\nWhich cards get the 1st Edition toggle:");
check("Base Set Charizard does", canBeFirstEdition(card([])), true);
check(
  "Base Set Machamp does not — every starter deck copy has the stamp",
  canBeFirstEdition({ ...card([]), name: "Machamp" }),
  false,
);
check(
  "the Machamp carve-out is Base Set only",
  canBeFirstEdition({ ...card([]), name: "Machamp", setName: "Neo Genesis" }),
  true,
);
check(
  "sets that never had a 1st Edition run do not",
  canBeFirstEdition({ ...card([]), setName: "Base Set 2" }),
  false,
);
check(
  "every WotC set with a 1st Edition run is covered",
  [
    "Base Set", "Jungle", "Fossil", "Team Rocket", "Gym Heroes",
    "Gym Challenge", "Neo Genesis", "Neo Discovery", "Neo Revelation",
    "Neo Destiny",
  ].map((setName) => canBeFirstEdition({ ...card([]), setName })),
  Array(10).fill(true),
);

console.log("\nGrading scales are each grader's real ladder, not a merged one:");
check("PSA has no 9.5", gradesFor("PSA").includes("9.5"), false);
check("PSA's only half grade is 1.5", gradesFor("PSA").includes("1.5"), true);
check("CGC half-grades the ladder", gradesFor("CGC").includes("8.5"), true);
check("CGC tops out at Pristine", gradesFor("CGC")[0], "10 Pristine");
check("labels read like the slab", gradeLabel({ company: "CGC", grade: "9.5" }), "CGC 9.5");

console.log("\nA slab's grade replaces the condition flow:");
{
  const item = {
    kind: "card",
    card: card([usd(100)]),
    condition: "Heavily Played",
    strategy: "quick",
    variant: null,
    firstEdition: false,
    grading: { company: "PSA", grade: "10" },
    priceOverride: null,
  };
  check(
    "no condition or strategy multiplier touches a graded quote",
    quoteForItem(item)?.suggested,
    100,
  );
  check(
    "the ledger stores the grade as the condition",
    describeItemCondition(item),
    "PSA 10",
  );
  check(
    "raw items still store their condition",
    describeItemCondition({ ...item, grading: null }),
    "Heavily Played",
  );

  const listing = buildListing(card([usd(100)]), 100, "Near Mint", undefined, {
    grading: { company: "PSA", grade: "10" },
  });
  check(
    "the grade is in the title, the condition is not",
    [listing.title.includes("PSA 10"), listing.title.includes("Near Mint")],
    [true, false],
  );
  check(
    "sold comps search the grade",
    ebaySoldSearchUrl(card([]), { grading: { company: "PSA", grade: "10" } }).includes(
      "PSA+10",
    ),
    true,
  );
}

console.log("\nSealed product flows through the same listing shapes:");
{
  const set = { name: "Evolving Skies", releaseDate: "2021-08-27", logoUrl: "" };
  const box = makeSealedProduct(set, "Booster Box");
  check("product name reads naturally", box.name, "Evolving Skies Booster Box");
  check("no catalogue prices to mis-quote", box.prices, []);
  check(
    "sealed rows describe themselves as sealed",
    describeItemCondition({ kind: "sealed", grading: null, condition: "Near Mint" }),
    "Factory Sealed",
  );

  const listing = buildSealedListing(box, 120, "Booster Box");
  check(
    "title leads with the product and states sealed",
    listing.title,
    "Evolving Skies Booster Box Pokemon TCG Factory Sealed",
  );
  check(
    "boxes list in eBay's sealed-boxes category",
    buildSealedListing(box, 120, "Booster Box").categoryId,
    "261044",
  );
  check(
    "loose packs list in the sealed-packs category",
    buildSealedListing(makeSealedProduct(set, "Booster Pack"), 5, "Booster Pack")
      .categoryId,
    "183456",
  );
  check(
    "set logos derive from card image paths",
    setLogoFromCardImage("https://assets.tcgdex.net/en/swsh/swsh7/4/low.webp"),
    "https://assets.tcgdex.net/en/swsh/swsh7/logo.webp",
  );
  check(
    "sealed comp searches drop the singles category filter",
    ebaySoldSearchUrl(box, { sealed: true }).includes("_sacat"),
    false,
  );
}

console.log("\nTyped grades parse out of search queries:");
check(
  "grade + card split apart",
  parseGradeQuery("Charizard 4/102 PSA 10"),
  { rest: "Charizard 4/102", grading: { company: "PSA", grade: "10" } },
);
check(
  "grade can lead, casing and spacing forgiven",
  parseGradeQuery("psa10 charizard"),
  { rest: "charizard", grading: { company: "PSA", grade: "10" } },
);
check(
  "CGC half grades survive as typed",
  parseGradeQuery("Pikachu 25/102 cgc 9.5"),
  { rest: "Pikachu 25/102", grading: { company: "CGC", grade: "9.5" } },
);
check(
  "CGC Pristine normalizes to the ladder's label",
  parseGradeQuery("cgc 10 pristine charizard"),
  { rest: "charizard", grading: { company: "CGC", grade: "10 Pristine" } },
);
check(
  "PSA's only half step parses",
  parseGradeQuery("Charizard PSA 1.5"),
  { rest: "Charizard", grading: { company: "PSA", grade: "1.5" } },
);
check(
  "off-ladder grade leaves the query untouched (PSA has no 9.5)",
  parseGradeQuery("Charizard PSA 9.5"),
  { rest: "Charizard PSA 9.5", grading: null },
);
check(
  "plain card queries pass through",
  parseGradeQuery("Charizard 4/102"),
  { rest: "Charizard 4/102", grading: null },
);
check(
  "a bare number is not a grade",
  parseGradeQuery("151"),
  { rest: "151", grading: null },
);

console.log("\nThe chart's current-day point rebases the quote:");
{
  const day = (agoMs) => new Date(Date.now() - agoMs).toISOString().slice(0, 10);
  const DAY_MS = 86_400_000;
  const point = (price, over = {}) => ({
    price,
    day: day(0),
    variant: "holofoil",
    source: "tcgplayer",
    currency: "USD",
    ...over,
  });
  const ebayAsk = {
    source: "ebay", currency: "USD", variant: "ebayAverage",
    label: "eBay asking (58 listings)", market: 520.47, low: null, high: null,
  };
  const ebaySold = {
    source: "ebay", currency: "USD", variant: "ebaySoldAverage",
    label: "eBay sold (12 sales, 90d)", market: 480, low: null, high: null,
  };
  const card = { name: "Test", setName: "Test", prices: [ebayAsk, usd(486.2)] };

  check(
    "today's point outranks the default eBay-asking pick",
    quotePrice(card, "Near Mint", "market", undefined, point(472.63)),
    // Field order matters to the JSON compare — this is quotePrice's own build order.
    { price: { source: "tcgplayer", variant: "holofoil", label: "Holofoil", currency: "USD", market: 472.63, low: null, high: null }, base: 472.63, suggested: 472.63 },
  );
  check(
    "quick sale undercuts the same current number",
    quotePrice(card, "Near Mint", "quick", undefined, point(472.63)).suggested,
    // 472.63 * 0.88 = 415.91, charm-rounded down to .99
    414.99,
  );
  check(
    "real eBay sales still win over the chart",
    quotePrice({ ...card, prices: [ebaySold, ...card.prices] }, "Near Mint", "market", undefined, point(472.63)).base,
    480,
  );
  check(
    "an explicit same-series pick is refreshed to today",
    quotePrice(card, "Near Mint", "market", "holofoil", point(472.63)).base,
    472.63,
  );
  check(
    "an explicit pick of a DIFFERENT series is respected",
    quotePrice(card, "Near Mint", "market", "ebayAverage", point(472.63)).base,
    520.47,
  );
  check(
    "a stale point (8 days old) is history, not the current price",
    quotePrice(card, "Near Mint", "market", undefined, point(472.63, { day: day(8 * DAY_MS) })).base,
    520.47,
  );
  check(
    "a euro point never sets a dollar price",
    quotePrice(card, "Near Mint", "market", undefined, point(400, { currency: "EUR", source: "cardmarket", variant: "average" })).base,
    520.47,
  );
  check(
    "condition multiplier applies to the current point",
    quotePrice(card, "Lightly Played", "market", undefined, point(100)).suggested,
    85,
  );
  check(
    "no point → unchanged behaviour",
    quotePrice(card, "Near Mint", "market"),
    { price: ebayAsk, base: 520.47, suggested: 520.47 },
  );
}

console.log(
  failures === 0
    ? "\nAll pricing checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
