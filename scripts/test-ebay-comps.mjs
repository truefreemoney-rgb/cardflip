/**
 * Exercises the eBay comps filtering and statistics against realistic listing
 * titles. Run: npm run test:ebay
 *
 * These are the cases that decide whether the price a seller sees is real:
 * eBay's search for a card name returns bulk lots, graded slabs, sealed
 * product, and proxies alongside the actual single, and every one of them
 * would drag the average somewhere untrue.
 */
import { isComparable, trimOutliers, buildComps } from "../src/lib/ebayComps.ts";

const card = {
  id: "sv3pt5-6",
  name: "Charizard ex",
  englishName: null,
  setName: "151",
  setSeries: "",
  number: "199",
  rarity: "Special Illustration Rare",
  imageSmall: "",
  imageLarge: "",
  prices: [],
};

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${actual}, expected ${expected})`}`);
}

console.log("\nAccepts genuine singles:");
for (const title of [
  "Pokemon Charizard ex 199/165 151 Special Illustration Rare SIR NM",
  "Charizard ex #199 151 SIR - Near Mint",
  "Pokemon 151 Charizard ex 199/165 Special Illustration Rare",
  "Charizard ex 199 165 SV 151 English Card Mint Condition",
]) {
  check(title, isComparable(title, card), true);
}

console.log("\nRejects bulk lots:");
for (const title of [
  "Pokemon Card Lot 199 Charizard ex 199/165 + 50 cards",
  "Bundle of 20 cards Charizard ex 199/165",
  "Charizard ex 199/165 playset x4 151",
  "Pokemon 151 Collection Binder Charizard ex 199/165",
  "Job Lot Charizard ex 199/165 Pokemon",
]) {
  check(title, isComparable(title, card), false);
}

console.log("\nRejects graded slabs (different product, different market):");
for (const title of [
  "PSA 10 Charizard ex 199/165 151 Special Illustration Rare GEM MINT",
  "CGC 9.5 Charizard ex 199/165 Pokemon 151",
  "BGS 9 Charizard ex #199 151",
  "Charizard ex 199/165 GRADED ACE 10",
]) {
  check(title, isComparable(title, card), false);
}

console.log("\nRejects fakes and sealed product:");
for (const title of [
  "Charizard ex 199/165 Custom Metal Card Proxy",
  "Pokemon 151 Booster Box Charizard ex 199 chase card",
  "Elite Trainer Box ETB Pokemon 151 Charizard ex 199/165",
  "Charizard ex 199/165 Orica Custom Art",
  "Pokemon 151 Charizard ex 199/165 Jumbo Oversized Card",
]) {
  check(title, isComparable(title, card), false);
}

console.log("\nRejects the wrong card (name or number mismatch):");
for (const title of [
  "Pikachu ex 199/165 Pokemon 151",
  "Charizard ex 006/165 Pokemon 151",
  "Blastoise ex 009/165 Pokemon 151 SIR",
]) {
  check(title, isComparable(title, card), false);
}

// Copied verbatim from the live eBay search this feature links to. Every one
// of the first four real results was noise — which is the whole argument for
// filtering before averaging.
console.log("\nRejects real noise from the live eBay search for this card:");
for (const title of [
  "Pokemon ex Full Art Choose Your Card English Near Mint Big Variety SV Ultra Rare",
  "Pokemon Special Illustration Ultra Rare Full Art: Choose Your Own",
  "Charizard ex 199/165 - Custom-Art Gold Metal Pokemon Card w/ Bonus Holo Card!",
  "2023 Pokemon MEW EN #199 Charizard ex Special Illustration Rare PSA 9 MINT",
]) {
  check(title, isComparable(title, card), false);
}

console.log("\nHandles zero-padded and unpadded numbers:");
const paddedCard = { ...card, number: "006" };
check(
  "Charizard ex 6/165 matches card numbered 006",
  isComparable("Pokemon Charizard ex 6/165 151 Holo Rare", paddedCard),
  true,
);
check(
  "Charizard ex 006/165 matches card numbered 006",
  isComparable("Pokemon Charizard ex 006/165 151", paddedCard),
  true,
);
check(
  "Charizard ex 60/165 does NOT match card numbered 006",
  isComparable("Pokemon Charizard ex 60/165 151", paddedCard),
  false,
);

console.log("\nSame number, different card (the $800-vs-$300 Charizard problem):");
const baseZard = { ...card, name: "Charizard", setName: "Base", number: "4", setTotal: 102, rarity: "Rare Holo" };
check("Charizard 4/102 Base Set matches", isComparable("Pokemon Charizard 4/102 Base Set Holo Rare 1999", baseZard), true);
check("bare #4 without a total still matches", isComparable("Charizard #4 Base Set Holo WOTC", baseZard), true);
check("Charizard V 004/127 rejected (suffix)", isComparable("Charizard V 004/127 Champions Path Holo", baseZard), false);
check("Charizard VMAX 4/xx rejected (suffix)", isComparable("Pokemon Charizard VMAX 4 Rare", baseZard), false);
check("Charizard 4/127 rejected (set total)", isComparable("Charizard 4/127 Holo Rare", baseZard), false);
check("Charizard 004/102 zero-padded total ok", isComparable("Charizard 004/102 Base", baseZard), true);
check("EX as a condition at the end is not a suffix", isComparable("Charizard 4/102 Base Set EX condition", baseZard), true);
const zardV = { ...baseZard, name: "Charizard V", number: "79", setTotal: 73 };
check("Charizard V 079/073 matches Charizard V", isComparable("Charizard V 079/073 Shining Fates", zardV), true);
check("Charizard VMAX rejected for a Charizard V", isComparable("Charizard VMAX 79 Shining Fates", zardV), false);
const zardVmax = { ...baseZard, name: "Charizard VMAX", number: "20", setTotal: 189 };
check("Charizard VMAX 20/189 matches", isComparable("Charizard VMAX 020/189 Darkness Ablaze", zardVmax), true);
check("Charizard V rejected for a Charizard VMAX", isComparable("Charizard V 20/189 Darkness Ablaze", zardVmax), false);
check("card without setTotal ignores the denominator", isComparable("Charizard 4/127", { ...baseZard, setTotal: null }), true);

console.log("\nTrims outliers:");
// A cluster around $300 with one $12 mispriced listing and one $4000 moonshot.
const prices = [12, 280, 290, 295, 300, 305, 310, 315, 4000];
const kept = trimOutliers(prices);
check(`drops the $12 bargain`, kept.includes(12), false);
check(`drops the $4000 moonshot`, kept.includes(4000), false);
check(`keeps the real cluster (7 listings)`, kept.length, 7);

console.log("\nSmall samples are left alone (a fence on 3 points is noise):");
check("3 prices survive untrimmed", trimOutliers([10, 50, 900]).length, 3);

console.log("\nBuilds the summary:");
const listings = prices.map((price, i) => ({
  id: `item-${i}`,
  title: `Charizard ex 199/165 listing ${i}`,
  price,
  url: "https://ebay.com/itm/x",
  imageUrl: "",
  condition: "Near Mint",
}));
const comps = buildComps(listings, "https://ebay.com/sch", 40);
check("average reflects the trimmed cluster, not the outliers", comps.average, 299.29);
check("median is the cluster centre", comps.median, 300);
check("low is the trimmed low", comps.low, 280);
check("high is the trimmed high", comps.high, 315);
check("count is post-trim", comps.count, 7);
check("sampled is the raw eBay result count", comps.sampled, 40);
check("listings are cheapest-first", comps.listings[0].price, 12);

check("no comparable listings yields no price", buildComps([], "https://ebay.com/sch", 30), null);

console.log("\nGraded mode (grading passed) requires exactly that slab:");
const psa7 = { company: "PSA", grade: "7" };
for (const [title, expected] of [
  ["Charizard ex 199/165 151 PSA 7", true],
  ["PSA-7 Charizard ex 199 151 Near Mint slab", true],
  ["Charizard ex 199/165 PSA 8", false],          // wrong grade
  ["Charizard ex 199/165 PSA 7.5", false],        // 7.5 is not 7
  ["Charizard ex 199/165 CGC 7", false],          // wrong company
  ["Charizard ex 199/165 raw NM", false],         // ungraded
  ["PSA 7 Charizard ex 199 + CGC 9 lot", false],  // two slabs / mixed lot
]) {
  check(`graded: ${title}`, isComparable(title, card, psa7), expected);
}
check("graded: CGC '10 Pristine' matches 'CGC 10'",
  isComparable("Charizard ex 199/165 CGC 10 Gem", card, { company: "CGC", grade: "10 Pristine" }), true);
check("ungraded mode still rejects slabs",
  isComparable("Charizard ex 199/165 PSA 7", card), false);

// Printing-aware comps (09-03): titles have to agree with the printing priced.
check("printing normal rejects a reverse holo title",
  isComparable("Charizard ex 199/165 Reverse Holo NM", card, null, "normal"), false);
check("printing normal keeps a plain title",
  isComparable("Charizard ex 199/165 NM", card, null, "normal"), true);
check("printing normal keeps 'non-holo'",
  isComparable("Charizard ex 199/165 non-holo NM", card, null, "normal"), true);
check("printing reverse requires the word",
  isComparable("Charizard ex 199/165 NM", card, null, "reverseHolofoil"), false);
check("printing reverse keeps a reverse holo title",
  isComparable("Charizard ex 199/165 Reverse Holo", card, null, "reverseHolofoil"), true);
check("printing reverse rejects a poke ball pattern",
  isComparable("Charizard ex 199/165 Reverse Holo Poke Ball Pattern", card, null, "reverseHolofoil"), false);
check("printing poke ball requires it",
  isComparable("Charizard ex 199/165 Poke Ball Reverse Holo", card, null, "pokeBallPattern"), true);
check("printing holo rejects a reverse",
  isComparable("Charizard ex 199/165 Reverse Holo", card, null, "holofoil"), false);
check("no printing = no printing filter",
  isComparable("Charizard ex 199/165 Reverse Holo", card), true);

console.log(
  failures === 0
    ? "\nAll eBay comps checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
