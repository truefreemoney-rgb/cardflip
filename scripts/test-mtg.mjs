/**
 * Magic: The Gathering through the shared pipeline — the pure pieces.
 * Run: npm run test:mtg
 *
 * Pins: query parsing (name / collector number / set code), MTG titles and
 * descriptions carrying set code + finish + "MTG", eBay aspects (Game,
 * Finish, Card Type), the finish variant driving the quote, and the comps
 * filter accepting set-code titles (MTG sellers rarely print the number).
 */
import {
  buildListing,
  buildSealedListing,
  canBeFirstEdition,
  formatVariantLabel,
  mtgFinishOf,
  pickPrice,
  quotePrice,
} from "../src/lib/listing.ts";
import { displayCardNumber, parseMtgQuery, GAMES } from "../src/lib/games.ts";
import { makeSealedProduct, sealedProductTypesFor } from "../src/lib/grading.ts";
import { buildAspects } from "../src/lib/ebayInventory.ts";
import { isComparable } from "../src/lib/ebayComps.ts";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const price = (variant, market, currency = "USD") => ({
  source: currency === "USD" ? "tcgplayer" : "cardmarket",
  currency,
  variant,
  label: { nonfoil: "Nonfoil", foil: "Foil", etched: "Etched foil" }[variant],
  market,
  low: null,
  high: null,
});

const bolt = {
  id: "ltr-187",
  name: "Lightning Bolt",
  setName: "The Lord of the Rings: Tales of Middle-earth",
  setSeries: "",
  number: "187",
  rarity: "Uncommon",
  imageSmall: "https://cards.scryfall.io/normal/front/x.jpg",
  imageLarge: "https://cards.scryfall.io/large/front/x.jpg",
  prices: [price("nonfoil", 2.5), price("foil", 6), price("nonfoil", 2.1, "EUR")],
  englishName: null,
  setTotal: null,
  setCode: "LTR",
  isSecretRare: false,
  game: "mtg",
  typeLine: "Instant",
  finishes: ["nonfoil", "foil"],
};

console.log("parseMtgQuery");
check("name + code + number", parseMtgQuery("Lightning Bolt LTR 187"), { name: "Lightning Bolt", number: "187", setCode: "ltr" });
check("name + fraction (leading zeros)", parseMtgQuery("Sol Ring 0243/0341"), { name: "Sol Ring", number: "243", setCode: null });
check("number then code", parseMtgQuery("Ragavan 138 MH2"), { name: "Ragavan", number: "138", setCode: "mh2" });
check("plain name keeps short capitalized words", parseMtgQuery("Fury Sliver"), { name: "Fury Sliver", number: null, setCode: null });
check("comma name", parseMtgQuery("Ragavan, Nimble Pilferer"), { name: "Ragavan Nimble Pilferer", number: null, setCode: null });
check("suffix letter number", parseMtgQuery("Brothers' War 12a BRO"), { name: "Brothers' War", number: "12a", setCode: "bro" });

console.log("display + registry");
check("displayCardNumber mtg", displayCardNumber(bolt), "LTR 187");
check("displayCardNumber pokemon", displayCardNumber({ number: "4", setTotal: 102 }), "4/102");
check("sealed types differ per game", sealedProductTypesFor("mtg")[0] !== sealedProductTypesFor("pokemon")[0], true);
check("game aspect", GAMES.mtg.ebayGameAspect, "Magic: The Gathering");

console.log("pricing");
check("default quote is the nonfoil", pickPrice(bolt)?.variant, "nonfoil");
check("finish label", formatVariantLabel("etched"), "Etched foil");
check("no 1st edition toggle for MTG", canBeFirstEdition(bolt), false);
const foilQuote = quotePrice(bolt, "Near Mint", "market", "foil");
check("foil override quotes the foil", foilQuote?.price.market, 6);
const item = { card: bolt, variant: null, firstEdition: false, grading: null, condition: "Near Mint", strategy: "market" };
check("mtgFinishOf follows the default quote", mtgFinishOf(item), "nonfoil");
check("mtgFinishOf follows the pick", mtgFinishOf({ ...item, variant: "foil" }), "foil");

console.log("listing");
const raw = buildListing(bolt, 2.5, "Near Mint", "Nonfoil");
// The LTR set name is long: the 80-char trim drops the condition and keeps set + number.
check("long set: title keeps set code + MTG, drops condition", raw.title, "Lightning Bolt The Lord of the Rings: Tales of Middle-earth LTR 187 MTG");
const short = buildListing({ ...bolt, setName: "Modern Horizons 2", setCode: "MH2", number: "401" }, 2.5, "Near Mint", "Nonfoil");
check("short set: full title with condition", short.title, "Lightning Bolt Modern Horizons 2 MH2 401 MTG Near Mint");
check("category is the CCG leaf", raw.categoryId, "183454");
check("category name names Magic", raw.categoryName.includes("Magic"), true);
check("description names finish", raw.description.includes("Finish: Nonfoil."), true);
check("description carries the type line", raw.description.includes("Instant."), true);
const foil = buildListing(bolt, 6, "Near Mint", "Foil");
check("foil title says Foil before MTG", foil.title.endsWith(" 187 Foil MTG"), true);
const sealed = buildSealedListing(
  makeSealedProduct({ name: "Modern Horizons 3", releaseDate: "2024-06-14", logoUrl: "", code: "mh3" }, "Play Booster Box", "mtg"),
  250,
  "Play Booster Box",
);
check("sealed title uses MTG token", sealed.title, "Modern Horizons 3 Play Booster Box MTG Factory Sealed");
check("sealed box category", sealed.categoryId, "261044");

console.log("eBay aspects");
const aspects = buildAspects({
  cardId: "x",
  listing: raw,
  card: { name: bolt.name, englishName: null, setName: bolt.setName, number: "187", rarity: "Uncommon", imageLarge: "", imageSmall: "", typeLine: "Instant" },
  game: "mtg",
  finish: "foil",
  hasPhoto: true,
  kind: "card",
  condition: "Near Mint",
  grading: null,
  firstEdition: false,
  productType: null,
  language: "en",
});
check("Game aspect", aspects.Game, ["Magic: The Gathering"]);
check("Finish aspect", aspects.Finish, ["Foil"]);
check("Card Type aspect", aspects["Card Type"], ["Instant"]);
check("Card Number aspect", aspects["Card Number"], ["187"]);

console.log("comps filter");
check("set code without number is comparable", isComparable("Lightning Bolt LTR Foil NM", bolt), true);
check("number without code is comparable", isComparable("Lightning Bolt 187/281 Tales of Middle Earth", bolt), true);
check("other set is not", isComparable("Lightning Bolt M11 Magic 2011 NM", bolt), false);
check("commander deck rejected", isComparable("Lightning Bolt LTR commander deck", bolt), false);
check("pokemon still needs the number", isComparable("Charizard Base Set Holo", { ...bolt, game: undefined, name: "Charizard", number: "4", setCode: null }), false);

console.log(failures === 0 ? "\nAll MTG checks passed" : `\n${failures} MTG check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
