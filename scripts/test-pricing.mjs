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
  askingPriceFor,
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
  floorNote,
} from "../src/lib/listing.ts";
import { costCoveredPrice } from "../src/lib/fees.ts";
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
  check("100 at Lightly Played (0.85)", q?.suggested, costCoveredPrice(85)); // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
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
    costCoveredPrice(100), // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
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

console.log("\neBay titles read like the big sellers' (09-28):");
{
  const harlequin = {
    ...card([usd(3, "pokeBallPattern")]),
    name: "Harlequin",
    setName: "White Flare",
    number: "083",
    setTotal: 86,
    rarity: "Uncommon",
  };
  check(
    "printing after the name, padded number, Holo + rarity, set, Pokemon Card NM",
    buildListing(harlequin, 3, "Near Mint", "Poké Ball Pattern").title,
    "Harlequin (Poke Ball Pattern) 083/086 Holo Uncommon White Flare Pokemon Card NM",
  );
  check(
    "a reverse holo names itself once, rarity stays plain",
    buildListing(harlequin, 3, "Lightly Played", "Reverse Holofoil").title,
    "Harlequin (Reverse Holo) 083/086 Uncommon White Flare Pokemon Card LP",
  );
  check(
    "a plain print earns no printing word and no Holo",
    buildListing(harlequin, 1, "Moderately Played", "Normal").title,
    "Harlequin 083/086 Uncommon White Flare Pokemon Card MP",
  );
  const umbreon = {
    ...card([usd(1400)]),
    name: "Umbreon ex",
    setName: "Prismatic Evolutions",
    number: "161",
    setTotal: 131,
    rarity: "Special Illustration Rare",
  };
  check(
    "a holo the rarity already announces gets no (Holo); secret number over the printed total; 81 chars → 'Card' dropped first",
    buildListing(umbreon, 1400, "Near Mint", "Holofoil").title,
    "Umbreon ex 161/131 Special Illustration Rare Prismatic Evolutions Pokemon NM",
  );
  check(
    "the same card in a shorter set keeps 'Card'",
    buildListing({ ...umbreon, setName: "Evolving Skies" }, 1400, "Near Mint", "Holofoil").title,
    "Umbreon ex 161/131 Special Illustration Rare Evolving Skies Pokemon Card NM",
  );
  check(
    "pokemontcg.io's 'Rare Holo' becomes eBay's 'Holo Rare'; old sets keep 4/102",
    buildListing({ ...card([usd(100)]), setTotal: 102, rarity: "Rare Holo" }, 100, "Near Mint", "Holofoil").title,
    "Charizard 4/102 Holo Rare Base Set Pokemon Card NM",
  );
  check(
    "1st Edition stays right after the name",
    buildListing({ ...card([usd(100)]), setTotal: 102, rarity: "Rare Holo" }, 100, "Near Mint", "1st Ed. Holofoil", {
      firstEdition: true,
    }).title,
    "Charizard 1st Edition 4/102 Holo Rare Base Set Pokemon Card NM",
  );
  check(
    "a slab's grade takes the condition's place",
    buildListing({ ...card([usd(100)]), setTotal: 102, rarity: "Rare Holo" }, 100, "Near Mint", "Holofoil", {
      grading: { company: "PSA", grade: "10" },
    }).title,
    "Charizard 4/102 Holo Rare Base Set Pokemon Card PSA 10",
  );
  const long = buildListing(
    {
      ...card([usd(50)]),
      name: "Iono's Bellibolt ex",
      setName: "Journey Together",
      number: "183",
      setTotal: 159,
      rarity: "Special Illustration Rare",
    },
    50,
    "Near Mint",
    "Holofoil",
  ).title;
  check(
    "still over 80 without 'Card': the set goes, never the number or the rarity",
    [long, long.length <= 80],
    ["Iono's Bellibolt ex 183/159 Special Illustration Rare Pokemon NM", true],
  );
  const longer = buildListing(
    {
      ...card([usd(50)]),
      name: "Lillie's Clefairy ex 1st Edition Something",
      setName: "Journey Together",
      number: "184",
      setTotal: 159,
      rarity: "Special Illustration Rare",
    },
    50,
    "Near Mint",
    "Holofoil",
  ).title;
  check(
    "still over 80: the set goes next, number + rarity survive",
    [longer.includes("184/159"), longer.includes("Special Illustration Rare"), longer.includes("Journey"), longer.length <= 80],
    [true, true, false, true],
  );
  check(
    "Damaged abbreviates to DMG",
    buildListing(harlequin, 1, "Damaged", "Normal").title.endsWith(" Pokemon Card DMG"),
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
    { price: { source: "tcgplayer", variant: "holofoil", label: "Holofoil", currency: "USD", market: 472.63, low: null, high: null }, base: 472.63, suggested: costCoveredPrice(472.63), floored: true, covers: 472.63 }, // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
  );
  check(
    "quick sale undercuts the same current number",
    quotePrice(card, "Near Mint", "quick", undefined, point(472.63)).suggested,
    // 472.63 * 0.88 = 415.91, charm-rounded down to .99, then fees + postage on top (Chris 10-08: COSTS_ON_EVERY_CARD)
    costCoveredPrice(414.99),
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
  // 09-30 cheap cards (Chris: "start with the total cost of fees and postage
  // then attach the tcg price of the card on top"): under $5 the suggested
  // price is the card's value + 13.25% + $0.30 + $0.75 postage, so the seller
  // keeps the full value. (1.03 + 0.30 + 0.75) / 0.8675 = 2.40.
  const cheapCard = { name: "Test", setName: "Test", prices: [usd(1.03)] };
  check(
    "cheap card: quick sale is priced to cover fees and postage",
    quotePrice(cheapCard, "Near Mint", "quick").suggested,
    2.4,
  );
  check(
    "cheap card: the cover-up is flagged",
    quotePrice(cheapCard, "Near Mint", "quick").floored,
    true,
  );
  check("cheap card: the note says what the seller keeps", quotePrice(cheapCard, "Near Mint", "quick").covers, 1.03);
  check(
    "Chris's example: a $1.50 card lists at $2.94 and nets $1.50",
    quotePrice({ name: "Test", setName: "Test", prices: [usd(1.5)] }, "Near Mint", "market").suggested,
    2.94,
  );
  check(
    "condition first: a $1.50 card in Lightly Played covers its $1.27 LP value",
    quotePrice({ name: "Test", setName: "Test", prices: [usd(1.5)] }, "Lightly Played", "market").suggested,
    costCoveredPrice(1.27), // 1.5 × 0.85 rounds to 1.27 in floating point (roundPrice)
  );
  // Worth less than $0.50: same rule, no $1.79 minimum any more (Chris 09-30,
  // Team Rocket's Spidops $0.25: "its the ebay fee plus postage, then the tcg
  // amount on top"). (0.25 + 0.30 + 0.75) / 0.8675 = 1.4986 → $1.50.
  const spidops = { name: "Test", setName: "Test", prices: [usd(0.25)] };
  check("$0.25 Spidops lists at $1.50, not the old $1.79", quotePrice(spidops, "Near Mint", "market").suggested, 1.5);
  check("$0.25 Spidops: the seller keeps the $0.25 value", quotePrice(spidops, "Near Mint", "market").covers, 0.25);
  check("$0.25 Spidops: the note names the value", floorNote(quotePrice(spidops, "Near Mint", "market")),
    "Card value $0.25 plus eBay fees and $0.75 postage, so you keep the full value");
  const pennyCard = { name: "Test", setName: "Test", prices: [usd(0.02)] };
  check("2¢ card: value + costs, still above break-even", quotePrice(pennyCard, "Near Mint", "market").suggested, 1.24);
  check("askingPriceFor agrees with quotePrice for cheap cards", askingPriceFor(1.5, "Near Mint"), 2.94);
  // $5–$10 taper (Chris 09-30, over a flat $10 line): the added costs fade
  // from all of them at $5 to none at $10 — no cliff at either end.
  check("taper: $4.99 full cover", askingPriceFor(4.99, "Near Mint"), 6.97);
  check("taper: $5.00 full cover, a cent above $4.99", askingPriceFor(5, "Near Mint"), 6.98);
  // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD) - no taper any more, every value carries the full costs.
  check("every value carries the full costs: $7.50", askingPriceFor(7.5, "Near Mint"), costCoveredPrice(7.5));
  check("every value carries the full costs: $9.99", askingPriceFor(9.99, "Near Mint"), costCoveredPrice(9.99));
  check("every value carries the full costs: $10 card", askingPriceFor(10, "Near Mint"), costCoveredPrice(10));
  {
    const { askingNoteFor } = await import(new URL("../src/lib/listing.ts", import.meta.url).href);
    check("Inventory note: $0.25 Spidops names the value", askingNoteFor(0.25, "Near Mint"),
      "Card value $0.25 plus eBay fees and $0.75 postage, so you keep the full value");
    // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
    check("Inventory note: $7.50 names the full costs", askingNoteFor(7.5, "Near Mint"), "Card value $7.50 plus eBay fees and $0.75 postage, so you keep the full value");
    check("Inventory note: a $12 card names them too", askingNoteFor(12, "Near Mint"), "Card value $12.00 plus eBay fees and $0.75 postage, so you keep the full value");
  }
  // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
  check("$7.50 note says all of the costs",
    floorNote(quotePrice({ name: "Test", setName: "Test", prices: [usd(7.5)] }, "Near Mint", "market")),
    "Card value $7.50 plus eBay fees and $0.75 postage, so you keep the full value");
  {
    // Every cent $0.01–$15: the price never drops as the value rises, never
    // loses money, and quick sale is never above full value.
    const bad = [];
    let prev = 0;
    for (let c = 1; c <= 1500; c++) {
      const v = c / 100;
      const ask = askingPriceFor(v, "Near Mint");
      if (ask < prev) bad.push(`drop at ${v}: ${prev} → ${ask}`);
      if (ask * 0.8675 - 1.05 < -0.005) bad.push(`loss at ${v}: ${ask}`);
      const card = { name: "Test", setName: "Test", prices: [usd(v)] };
      const q = quotePrice(card, "Near Mint", "quick").suggested;
      const m = quotePrice(card, "Near Mint", "market").suggested;
      if (q > m) bad.push(`quick above full at ${v}: ${q} > ${m}`);
      prev = ask;
    }
    check("taper sweep: monotone, never a loss, quick ≤ full", bad.slice(0, 5), []);
  }
  // 09-03 quick sale is a $5+ option: below it "quick" quotes the market
  // (then covers costs like any cheap card).
  const fourDollar = { name: "Test", setName: "Test", prices: [usd(4.2)] };
  check(
    "under $5: quick sale quotes the market price (no undercut, no charm), costs on top",
    quotePrice(fourDollar, "Near Mint", "quick").suggested,
    costCoveredPrice(4.2),
  );
  check(
    "at $5+: quick sale still undercuts",
    quotePrice({ name: "Test", setName: "Test", prices: [usd(20)] }, "Near Mint", "quick").suggested,
    costCoveredPrice(16.99), // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
  );
  // The old flat $5 line put a $5.00 card's quick sale ($4.40 value, fully
  // covered) at $6.29, above Full value's $5.00. On the taper Full is $6.98.
  for (const v of [5, 5.5, 6.81, 10, 10.5]) {
    const card = { name: "Test", setName: "Test", prices: [usd(v)] };
    check(`$${v} card: quick sale under full value`,
      quotePrice(card, "Near Mint", "quick").suggested < quotePrice(card, "Near Mint", "market").suggested, true);
  }
  check(
    "cheap card: market value is left alone (base)",
    quotePrice(cheapCard, "Near Mint", "market").base,
    1.03,
  );
  check(
    "a $10 card carries the full costs (Chris 10-08: COSTS_ON_EVERY_CARD)",
    quotePrice({ name: "Test", setName: "Test", prices: [usd(10)] }, "Near Mint", "market").suggested,
    costCoveredPrice(10),
  );
  check(
    "condition multiplier applies to the current point",
    quotePrice(card, "Lightly Played", "market", undefined, point(100)).suggested,
    costCoveredPrice(85), // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
  );
  check(
    "no point → unchanged behaviour",
    quotePrice(card, "Near Mint", "market"),
    { price: ebayAsk, base: 520.47, suggested: costCoveredPrice(520.47), floored: true, covers: 520.47 },
  );
}

{
  // Chris 10-04: "if i change to lightly played, it should reflect on the price" — the market shown follows the condition.
  const { marketForCondition } = await import(new URL("../src/lib/listing.ts", import.meta.url).href);
  check("market, Near Mint = the market", marketForCondition(52.64, "Near Mint"), 52.64);
  check("market, Lightly Played = 85%", marketForCondition(52.64, "Lightly Played"), 44.74);
  check("market, Damaged = 40%", marketForCondition(52.64, "Damaged"), 21.06);
  check("market, graded slab stays as given", marketForCondition(52.64, "PSA 10"), 52.64);
}

{
  const { belowFloor, listingFloor, floorRefusal } = await import(new URL("../src/lib/fees.ts", import.meta.url).href);
  console.log("break-even rule (Chris, 09-08: never lose money; the $1.79 minimum went 09-30)");
  // (0.30 + 0.75) / 0.8675 = 1.2104 → rounded up to the cent.
  check("break-even is $1.22 at 13.25% + $0.30 + $0.75 postage", listingFloor(), 1.22);
  check("$1.15 loses money", belowFloor(1.15), true);
  check("$1.22 does not", belowFloor(1.22), false);
  check("$1.50 (the Spidops price) saves", belowFloor(1.5), false);
  check("$0 (unpriced) passes", belowFloor(0), false);
  check("refusal names break-even", floorRefusal().includes("$1.22"), true);
}

// The price guard (lib/server/priceTrustSite.ts): a card whose market the rule flags gets no suggested price.
{
  const { currentPrice, priceFlagOf } = await import(new URL("../src/lib/listing.ts", import.meta.url).href);
  const flag = { hard: true, reason: "flat 87d" };
  const junk = (market, variant = "holofoil") => ({ ...usd(market, variant), untrusted: flag });
  const today = new Date().toISOString().slice(0, 10);
  const pt = (price, over = {}) => ({ price, day: today, variant: "holofoil", source: "tcgplayer", currency: "USD", ...over });
  const ebaySold = { source: "ebay", currency: "USD", variant: "ebaySoldAverage", label: "eBay sold (12 sales, 90d)", market: 480, low: null, high: null };
  const normal = { name: "Test", setName: "Test", prices: [usd(500)] };
  const flagged = { name: "Test", setName: "Test", prices: [junk(500)] };

  check("guard: a flagged row gets no quote at all", quotePrice(flagged, "Near Mint", "market"), null);
  check("guard: ... on every strategy and condition", ["market", "quick"].map((st) => quotePrice(flagged, "Lightly Played", st)), [null, null]);
  check("guard: the normal card next to it is quoted exactly as before", JSON.stringify(quotePrice(normal, "Near Mint", "market")), JSON.stringify({ price: usd(500), base: 500, suggested: costCoveredPrice(500), floored: true, covers: 500 }));
  check("guard: an untrusted mark alone changes nothing else (quote of a card with the flag removed is identical)", JSON.stringify(quotePrice({ ...flagged, prices: [{ ...junk(500), untrusted: undefined }] }, "Near Mint", "market")), JSON.stringify(quotePrice(normal, "Near Mint", "market")));
  check("guard: a flagged explicit printing pick is not quoted either", quotePrice({ ...normal, prices: [usd(20, "normal"), junk(500)] }, "Near Mint", "market", "holofoil"), null);
  check("guard: the same card on its normal printing is still quoted", quotePrice({ ...normal, prices: [usd(20, "normal"), junk(500)] }, "Near Mint", "market", "normal")?.base, 20);
  check("guard: an eBay sold row outranks the flagged TCGplayer row, so the quote stands on real sales", quotePrice({ ...flagged, prices: [ebaySold, junk(500)] }, "Near Mint", "market")?.base, 480);
  check("guard: a flagged chart point does not replace a good row", quotePrice(normal, "Near Mint", "market", undefined, pt(900, { untrusted: flag }))?.base, 500);
  check("guard: a fine chart point still rebases", quotePrice(normal, "Near Mint", "market", undefined, pt(472.63))?.base, 472.63);
  check("guard: a flagged chart point with no row: no quote", quotePrice({ name: "Test", setName: "Test", prices: [] }, "Near Mint", "market", undefined, pt(900, { untrusted: flag })), null);
  check("guard: ... and a flagged row is not rescued by a good point either (today's live price is the suspect)", quotePrice(flagged, "Near Mint", "market", undefined, pt(472.63)), null);

  // Stale (10-02): a row whose value has stood 45+ days is quoted exactly as a normal one; priceStaleOf names the note.
  const { priceStaleOf } = await import(new URL("../src/lib/listing.ts", import.meta.url).href);
  const staleRow = { ...usd(500), stale: { days: 128 } };
  const staleCard = { name: "Test", setName: "Test", prices: [staleRow] };
  check("stale: quoted exactly like a normal card", JSON.stringify(quotePrice(staleCard, "Near Mint", "market")), JSON.stringify({ price: staleRow, base: 500, suggested: costCoveredPrice(500), floored: true, covers: 500 }));
  check("stale: priceStaleOf names the note", priceStaleOf(staleCard), { days: 128 });
  check("stale: ... null for a normal card, a flagged card, and when eBay sold carries the price", [priceStaleOf(normal), priceStaleOf(flagged), priceStaleOf({ ...staleCard, prices: [ebaySold, staleRow] })], [null, null, null]);
  check("stale: ... the chart point speaks when there is no row", priceStaleOf({ name: "T", setName: "T", prices: [] }, undefined, pt(900, { stale: { days: 50 } })), { days: 50 });
  check("stale: priceFlagOf stays null for it (nothing is hidden)", priceFlagOf(staleCard), null);

  check("guard: priceFlagOf names the flagged row", priceFlagOf(flagged), flag);
  check("guard: ... null for a normal card", priceFlagOf(normal), null);
  check("guard: ... null when eBay sold carries the price", priceFlagOf({ ...flagged, prices: [ebaySold, junk(500)] }), null);
  check("guard: ... the chart point speaks when there is no row", priceFlagOf({ name: "T", setName: "T", prices: [] }, undefined, pt(900, { untrusted: flag })), flag);

  const item = (c, extra = {}) => ({ card: c, status: "ready", condition: "Near Mint", strategy: "market", ...extra });
  check("guard: currentPrice is 0 for a flagged card (queue, tally, Send All and the ledger fall out)", currentPrice(item(flagged)), 0);
  check("guard: ... the seller's own price is kept", currentPrice(item(flagged, { priceOverride: 320 })), 320);
  check("guard: ... a normal card is priced as before", currentPrice(item(normal)), costCoveredPrice(500));
}

console.log(
  failures === 0
    ? "\nAll pricing checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
