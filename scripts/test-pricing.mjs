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
  ebaySearchUrl,
  firstEditionPrice,
  formatMoney,
  pickPrice,
  quoteForItem,
  quotePrice,
  floorNote,
  watchPriceOf,
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

console.log("A stored backup row quotes before a flagged TCGplayer row (10-20, Black Lotus Unlimited), never before a believed one:");
{
  const flagged = { ...usd(20000), untrusted: { hard: true, reason: "doubled 2.7x in the last 10 priced days" } };
  const backup = { source: "cardmarket-converted", variant: "nonfoil", label: "Cardmarket (converted from €)", currency: "USD", market: 17560.09, low: null, high: null };
  check("flagged TCGplayer + a backup: the backup", pickPrice(card([flagged, backup]))?.market, 17560.09);
  check("believed TCGplayer + a backup: TCGplayer", pickPrice(card([usd(818.65), backup]))?.market, 818.65);
  check("flagged TCGplayer alone: the flagged row (the screens print its note)", pickPrice(card([flagged]))?.untrusted?.hard, true);
}

console.log("\nA watchlist row reads the printing it was saved on (10-21, Legendary Collection Pikachu 86):");
{
  const lc86 = card([usd(6.7, "normal"), usd(1574.99, "reverseHolofoil")]);
  check("the default quote is the Normal", pickPrice(lc86)?.market, 6.7);
  check("saved on the reverse holo: the reverse holo", watchPriceOf(lc86, "reverseHolofoil", 1574.99)?.market, 1574.99);
  check("saved on the Normal: the Normal, whatever the saved price", watchPriceOf(lc86, "normal", 1574.99)?.market, 6.7);
  check("old row, no printing kept, saved at $1,574.99: the printing that matches it", watchPriceOf(lc86, null, 1574.99)?.variant, "reverseHolofoil");
  check("old row saved near the default: the default", watchPriceOf(lc86, null, 5.1)?.market, 6.7);
  check("old row 3x+ off but nothing near it: the default (a real move)", watchPriceOf(card([usd(40, "normal"), usd(300, "reverseHolofoil")]), null, 10)?.market, 40);
  check("a kept printing the card no longer prices: the default", watchPriceOf(lc86, "holofoil", 100)?.market, 6.7);
  const flaggedRev = { ...usd(1574.99, "reverseHolofoil"), untrusted: { hard: true, reason: "test" } };
  check("a flagged kept printing stays flagged (the page prints its note)", watchPriceOf(card([usd(6.7, "normal"), flaggedRev]), "reverseHolofoil", 1574.99)?.untrusted?.hard, true);
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
  check("100 at Lightly Played (0.85)", q?.suggested, costCoveredPrice(85, "tracked")); // over the $20 envelope cap, so tracked. Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
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
    costCoveredPrice(100, "tracked"), // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
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
  // Chris 10-14: a raw card's eBay pages were full of PSA slabs; the links leave them out, a slab's link keeps its grade.
  const nkw = (u) => new URL(u).searchParams.get("_nkw");
  check(
    "raw links leave slabs out, slab links do not",
    [
      nkw(ebaySoldSearchUrl(card([]))).includes("-psa -bgs -cgc -sgc -tag -ace -graded -slab -gem -proxy -japanese"),
      nkw(ebaySearchUrl(card([]))).includes("-psa"),
      nkw(ebaySoldSearchUrl(card([]), { grading: { company: "PSA", grade: "10" } })).includes("-psa"),
    ],
    [true, true, false],
  );
  // Chris 10-21: "STOP LOOKING AT SLABS" / "only Buy It Now" — a raw card's SOLD link uses eBay's own Graded=No item
  // specific and the Buy It Now filter; a slab's link keeps auctions and its grade.
  const sp = (u, k) => new URL(u).searchParams.get(k);
  check(
    "raw sold links = Graded:No + Buy It Now + sold; slab sold links keep the grade",
    [
      sp(ebaySoldSearchUrl(card([])), "Graded"),
      sp(ebaySoldSearchUrl(card([])), "LH_BIN"),
      sp(ebaySoldSearchUrl(card([])), "LH_Sold"),
      sp(ebaySoldSearchUrl(card([]), { grading: { company: "PSA", grade: "10" } }), "Graded"),
      sp(ebaySoldSearchUrl(card([]), { grading: { company: "PSA", grade: "10" } }), "LH_Sold"),
    ],
    ["No", "1", "1", null, "1"],
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
    { price: { source: "tcgplayer", variant: "holofoil", label: "Holofoil", currency: "USD", market: 472.63, low: null, high: null }, base: 472.63, suggested: costCoveredPrice(472.63, "tracked"), floored: true, covers: 472.63, shipping: "tracked" }, // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
  );
  check(
    "quick sale undercuts the same current number",
    quotePrice(card, "Near Mint", "quick", undefined, point(472.63)).suggested,
    // 472.63 * 0.88 = 415.91, charm-rounded down to .99, then fees + postage on top (Chris 10-08: COSTS_ON_EVERY_CARD)
    costCoveredPrice(414.99, "tracked"),
  );
  check(
    "TCGplayer's chart point outranks eBay sold (Chris 10-19: eBay bakes in fees + postage)",
    quotePrice({ ...card, prices: [ebaySold, ...card.prices] }, "Near Mint", "market", undefined, point(472.63)).base,
    472.63,
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
    "a stale point (8 days old) is history, not the current price (TCGplayer default, 10-19)",
    quotePrice(card, "Near Mint", "market", undefined, point(472.63, { day: day(8 * DAY_MS) })).base,
    486.2,
  );
  check(
    "a euro point never sets a dollar price",
    quotePrice(card, "Near Mint", "market", undefined, point(400, { currency: "EUR", source: "cardmarket", variant: "average" })).base,
    486.2,
  );
  // 09-30 cheap cards (Chris: "start with the total cost of fees and postage
  // then attach the tcg price of the card on top"): under $5 the suggested
  // price is the card's value + 13.25% + $0.30 + $0.78 envelope postage, so the seller
  // keeps the full value. (1.03 + 0.30 + 0.78) / 0.8675 = 2.4323 → 2.44.
  const cheapCard = { name: "Test", setName: "Test", prices: [usd(1.03)] };
  check(
    "cheap card: quick sale is priced to cover fees and postage",
    quotePrice(cheapCard, "Near Mint", "quick").suggested,
    2.44,
  );
  check(
    "cheap card: the cover-up is flagged",
    quotePrice(cheapCard, "Near Mint", "quick").floored,
    true,
  );
  check("cheap card: the note says what the seller keeps", quotePrice(cheapCard, "Near Mint", "quick").covers, 1.03);
  check(
    "Chris's example: a $1.50 card lists at $2.98 and nets $1.50",
    quotePrice({ name: "Test", setName: "Test", prices: [usd(1.5)] }, "Near Mint", "market").suggested,
    2.98,
  );
  check(
    "condition first: a $1.50 card in Lightly Played covers its $1.27 LP value",
    quotePrice({ name: "Test", setName: "Test", prices: [usd(1.5)] }, "Lightly Played", "market").suggested,
    costCoveredPrice(1.27), // 1.5 × 0.85 rounds to 1.27 in floating point (roundPrice)
  );
  // Worth less than $0.50: same rule, no $1.79 minimum any more (Chris 09-30,
  // Team Rocket's Spidops $0.25: "its the ebay fee plus postage, then the tcg
  // amount on top"). (0.25 + 0.30 + 0.78) / 0.8675 = 1.5331 → $1.54.
  const spidops = { name: "Test", setName: "Test", prices: [usd(0.25)] };
  check("$0.25 Spidops lists at $1.54, not the old $1.79", quotePrice(spidops, "Near Mint", "market").suggested, 1.54);
  check("$0.25 Spidops: the seller keeps the $0.25 value", quotePrice(spidops, "Near Mint", "market").covers, 0.25);
  check("$0.25 Spidops: the note names the value", floorNote(quotePrice(spidops, "Near Mint", "market")),
    "Card value $0.25 plus eBay fees and $0.78 envelope postage, so you keep the full value");
  const pennyCard = { name: "Test", setName: "Test", prices: [usd(0.02)] };
  check("2¢ card: value + costs, still above break-even", quotePrice(pennyCard, "Near Mint", "market").suggested, 1.27);
  check("askingPriceFor agrees with quotePrice for cheap cards", askingPriceFor(1.5, "Near Mint"), 2.98);
  // $5–$10 taper (Chris 09-30, over a flat $10 line): the added costs fade
  // from all of them at $5 to none at $10 — no cliff at either end.
  check("taper: $4.99 full cover", askingPriceFor(4.99, "Near Mint"), 7.0);
  check("taper: $5.00 full cover, a cent above $4.99", askingPriceFor(5, "Near Mint"), 7.01);
  // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD) - no taper any more, every value carries the full costs.
  check("every value carries the full costs: $7.50", askingPriceFor(7.5, "Near Mint"), costCoveredPrice(7.5));
  check("every value carries the full costs: $9.99", askingPriceFor(9.99, "Near Mint"), costCoveredPrice(9.99));
  check("every value carries the full costs: $10 card", askingPriceFor(10, "Near Mint"), costCoveredPrice(10));
  {
    const { askingNoteFor } = await import(new URL("../src/lib/listing.ts", import.meta.url).href);
    check("Inventory note: $0.25 Spidops names the value", askingNoteFor(0.25, "Near Mint"),
      "Card value $0.25 plus eBay fees and $0.78 envelope postage, so you keep the full value");
    // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
    check("Inventory note: $7.50 names the full costs", askingNoteFor(7.5, "Near Mint"), "Card value $7.50 plus eBay fees and $0.78 envelope postage, so you keep the full value");
    check("Inventory note: a $12 card names them too", askingNoteFor(12, "Near Mint"), "Card value $12.00 plus eBay fees and $0.78 envelope postage, so you keep the full value");
  }
  // Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
  check("$7.50 note says all of the costs",
    floorNote(quotePrice({ name: "Test", setName: "Test", prices: [usd(7.5)] }, "Near Mint", "market")),
    "Card value $7.50 plus eBay fees and $0.78 envelope postage, so you keep the full value");
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
    costCoveredPrice(16.99, "tracked"), // over the $20 envelope cap once costs are on top. Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
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
    costCoveredPrice(85, "tracked"), // $100 is over the $20 envelope cap, so USPS tracked. Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD)
  );
  check(
    "no point → TCGplayer outranks the eBay asking average (Chris 10-19: sold > TCGplayer > asking)",
    quotePrice(card, "Near Mint", "market"),
    { price: card.prices[1], base: 486.2, suggested: costCoveredPrice(486.2, "tracked"), floored: true, covers: 486.2, shipping: "tracked" },
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
  // (0.30 + 0.78) / 0.8675 = 1.2450 → rounded up to the cent (Chris 10-11: the $0.78 eBay envelope label).
  check("break-even is $1.25 at 13.25% + $0.30 + $0.78 postage", listingFloor(), 1.25);
  check("$1.15 loses money", belowFloor(1.15), true);
  check("$1.24 loses money", belowFloor(1.24), true);
  check("$1.92 (the Spidops price) saves", belowFloor(1.92), false);
  check("$0 (unpriced) passes", belowFloor(0), false);
  check("refusal names break-even", floorRefusal().includes("$1.25"), true);
}

// Shipping picks (Chris 10-11 night, eBay's calculator + USPS Notice 123 of 2026-10-04): envelope = eBay's
// tracked label $0.78 up to $20, stamps with no tracking $1.31 from $20.01 to $100, never over $100;
// tracked mailer $6.07 at any price. The postage sits inside the price.
{
  const fees = await import(new URL("../src/lib/fees.ts", import.meta.url).href);
  const { floorNote, askingPriceFor } = await import(new URL("../src/lib/listing.ts", import.meta.url).href);
  const ship = await import(new URL("../src/lib/shipping.ts", import.meta.url).href);
  console.log("shipping tiers (Chris 10-11)");
  check("postage: envelope at $20.00 = $0.78 label, $20.01 = $1.31 stamps, no price = $0.78, tracked = $6.07", [
    fees.postageFor("envelope", 20), fees.postageFor("envelope", 20.01), fees.postageFor("envelope"), fees.postageFor("tracked"), fees.postageFor("tracked", 500),
  ], [0.78, 1.31, 0.78, 6.07, 6.07]);
  check("envelope allowed to $100, not $100.01; tracked label to $20 only", [
    fees.envelopeAllowed(100), fees.envelopeAllowed(100.01), fees.envelopeTracked(20), fees.envelopeTracked(20.01),
  ], [true, false, true, false]);
  check("floor is $1.25 (the $0.78 label)", fees.listingFloor(), 1.25);
  // $16: (16 + 0.40 + 0.78) / 0.8675 = 19.81, under the label line. $16.50: 20.38 with the label is over $20, so it is
  // priced with stamps: (16.50 + 0.40 + 1.31) / 0.8675 = 20.991 → $21.00 (never $20.38 on a stamped envelope).
  check("envelope under the line keeps the label price ($16 → $19.81)", fees.costCoveredPrice(16, "envelope"), 19.81);
  check("an envelope price that lands just over $20 is priced with the $1.31 stamps ($16.50 → $21.00)", fees.costCoveredPrice(16.5, "envelope"), 21.0);
  check("the stamped price still nets the value after fees + $1.31", fees.costCoveredPrice(16.5) - fees.estimatedEbayFees(fees.costCoveredPrice(16.5)) - fees.STAMP_POSTAGE_USD >= 16.5, true);
  check("$25 card: envelope $30.79 (stamps) vs tracked $36.28", [fees.costCoveredPrice(25, "envelope"), fees.costCoveredPrice(25, "tracked")], [30.79, 36.28]);
  check("$60 card: envelope $71.14 (stamps) vs tracked $76.63", [fees.costCoveredPrice(60, "envelope"), fees.costCoveredPrice(60, "tracked")], [71.14, 76.63]);
  check("$15 card on the envelope: $18.66 (label)", fees.costCoveredPrice(15, "envelope"), 18.66);
  check("suggested pick: envelope while the label price is $20 or less, tracked above (never the stamps)", [
    fees.defaultShipMethod(16), fees.defaultShipMethod(16.5), fees.defaultShipMethod(25), fees.defaultShipMethod(60),
  ], ["envelope", "tracked", "tracked", "tracked"]);
  check("no pick: a $25 card is priced as the tracked mailer", askingPriceFor(25, "Near Mint"), fees.costCoveredPrice(25, "tracked"));
  check("picked envelope: a $25 card is priced with the stamps", askingPriceFor(25, "Near Mint", "envelope"), 30.79);
  {
    // Every cent $15–$30 on the envelope: the price never drops as the value rises and never loses money at its own postage.
    let ok = true;
    let prev = 0;
    for (let c = 1500; c <= 3000; c++) {
      const p = fees.costCoveredPrice(c / 100, "envelope");
      if (p < prev || p - fees.estimatedEbayFees(p) - fees.postageFor("envelope", p) < c / 100 - 1e-9) ok = false;
      prev = p;
    }
    check("envelope sweep $15-$30: rises with value, always nets the value at the right postage", ok, true);
  }
  check("note names the stamp postage on a stamped envelope", floorNote({ covers: 25, shipping: "envelope", suggested: 30.79 }),
    "Card value $25.00 plus eBay fees and $1.31 envelope postage, so you keep the full value");
  check("tiles at $15: label envelope $0.78 + tracked $6.07", ship.shipOptionsFor(15).map((o) => [o.id, o.postage, o.sub]), [
    ["envelope", 0.78, "eBay Standard Envelope, tracked"], ["tracked", 6.07, "Bubble mailer, USPS Ground Advantage"],
  ]);
  check("tiles at $30.79: stamps $1.31, no warning line (Chris 10-11)", ship.shipOptionsFor(30.79)[0], { id: "envelope", label: "Envelope", sub: "Plain envelope with stamps", postage: 1.31 });
  check("over-cap line", ship.ENVELOPE_OVER_CAP, "Over $100, use a tracked mailer");
  check("confirm line: stamped envelope over $20", ship.shipConfirmLine("envelope", 25),
    "Ships in a stamped envelope. Free shipping for the buyer, the postage is already in your price.");
  check("confirm line: label envelope at $20 and with no price", [ship.shipConfirmLine("envelope", 20), ship.shipConfirmLine("envelope")].every((s) => s.startsWith("Ships as an eBay Standard Envelope (tracked).")), true);
  check("steps: stamped envelope says $1.31 in stamps, mark shipped, no warning", [ship.shipSteps("envelope", 25).length, /^Postage is \$1\.31 total\./.test(ship.shipSteps("envelope", 25)[2]), /Mark as shipped/.test(ship.shipSteps("envelope", 25)[3]), /tracking|lost/i.test(ship.shipSteps("envelope", 25).join(" "))], [4, true, true, false]);
  check("steps: label envelope up to $20 buys the eBay label", /eBay Standard Envelope label/.test(ship.shipSteps("envelope", 20)[2]), true);
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
  check("guard: the normal card next to it is quoted exactly as before", JSON.stringify(quotePrice(normal, "Near Mint", "market")), JSON.stringify({ price: usd(500), base: 500, suggested: costCoveredPrice(500, "tracked"), floored: true, covers: 500, shipping: "tracked" }));
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
  check("stale: quoted exactly like a normal card", JSON.stringify(quotePrice(staleCard, "Near Mint", "market")), JSON.stringify({ price: staleRow, base: 500, suggested: costCoveredPrice(500, "tracked"), floored: true, covers: 500, shipping: "tracked" }));
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
  check("guard: ... a normal card is priced as before", currentPrice(item(normal)), costCoveredPrice(500, "tracked"));
}

// The chart's point re-prices only the printing the quote stands on (10-20, the first Booster buyer's Obsidian
// Flames Umbreon: the point came from the longest series, the reverse holo, and a $0.36 normal card saved at ~$4).
{
  const today = new Date().toISOString().slice(0, 10);
  const pt = (price, variant) => ({ price, day: today, variant, source: "tcgplayer", currency: "USD" });
  const umbreon = { name: "Umbreon", setName: "Obsidian Flames", prices: [usd(0.36, "normal"), usd(2.75, "reverseHolofoil")] };
  const base = (q) => q?.base ?? null;
  check("point: another printing's point leaves the default quote alone", base(quotePrice(umbreon, "Near Mint", "market", undefined, pt(2.75, "reverseHolofoil"))), 0.36);
  check("point: ... the default printing's own point still refreshes it", base(quotePrice(umbreon, "Near Mint", "market", undefined, pt(0.4, "normal"))), 0.4);
  check("point: ... a picked printing takes its own point", base(quotePrice(umbreon, "Near Mint", "market", "reverseHolofoil", pt(2.9, "reverseHolofoil"))), 2.9);
  check("point: ... a card with no dollar row still takes the point", base(quotePrice({ name: "T", setName: "T", prices: [] }, "Near Mint", "market", undefined, pt(3, "holofoil"))), 3);
}

console.log(
  failures === 0
    ? "\nAll pricing checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
