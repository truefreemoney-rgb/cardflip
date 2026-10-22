/**
 * eBay Browse price reads (lib/server/ebay.ts): ungraded + plain Buy It Now only. Run: npm run test:ebaybrowse
 *
 * Chris 10-21: "STOP LOOKING AT SLABS" (title minus-words let slabs through; eBay's own condition filter does not)
 * and "only Buy It Now" (an accepted Best Offer reports the ask, not what was paid; an auction shows a bid).
 * Pins: the Browse filter asks eBay for conditionIds 4000 (Ungraded) + FIXED_PRICE; a slab comps call asks for
 * 2750 (Graded) instead; items whose buyingOptions include BEST_OFFER or AUCTION are dropped by the referee reader
 * and by the live comps reader; items with no buyingOptions field (older summaries) are kept.
 */
process.env.EBAY_CLIENT_ID = "test-id";
process.env.EBAY_CLIENT_SECRET = "test-secret";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { searchEbayAsks, fetchEbayComps, browsePriceFilter, isPlainFixedPrice } = await import(at("lib/server/ebay.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const summaries = [
  { itemId: "1", title: "Charizard 4/102 Base Set Holo Ungraded NM", price: { value: "300", currency: "USD" }, buyingOptions: ["FIXED_PRICE"] },
  { itemId: "2", title: "Charizard 4/102 Base Set Holo Ungraded", price: { value: "900", currency: "USD" }, buyingOptions: ["FIXED_PRICE", "BEST_OFFER"] },
  { itemId: "3", title: "Charizard 4/102 Base Set Holo", price: { value: "50", currency: "USD" }, buyingOptions: ["AUCTION"] },
  { itemId: "4", title: "Charizard 4/102 Base Set Holo NM", price: { value: "310", currency: "USD" } },
];

const urls = [];
globalThis.fetch = async (input) => {
  const url = String(input instanceof URL ? input.href : input?.url ?? input);
  urls.push(url);
  if (url.includes("/identity/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 7200 }), { status: 200 });
  if (url.includes("/buy/browse/v1/item_summary/search")) return new Response(JSON.stringify({ itemSummaries: summaries }), { status: 200 });
  return new Response("{}", { status: 404 });
};

console.log("filter text");
check("raw reads ask for FIXED_PRICE + Ungraded (4000)", browsePriceFilter(false), "buyingOptions:{FIXED_PRICE},conditionIds:{4000}");
check("slab comps ask for FIXED_PRICE + Graded (2750)", browsePriceFilter(true), "buyingOptions:{FIXED_PRICE},conditionIds:{2750}");
check(
  "plain Buy It Now only: BEST_OFFER and AUCTION out, missing field kept",
  [isPlainFixedPrice({ buyingOptions: ["FIXED_PRICE"] }), isPlainFixedPrice({ buyingOptions: ["FIXED_PRICE", "BEST_OFFER"] }), isPlainFixedPrice({ buyingOptions: ["AUCTION"] }), isPlainFixedPrice({})],
  [true, false, false, true],
);

console.log("referee reader (searchEbayAsks)");
{
  const asks = await searchEbayAsks("Charizard 4/102 Base Set");
  const search = new URL(urls.find((u) => u.includes("item_summary/search")));
  check("Browse call carries the ungraded + fixed-price filter", search.searchParams.get("filter"), "buyingOptions:{FIXED_PRICE},conditionIds:{4000}");
  check("Best Offer and auction items are dropped, plain BIN kept", asks.map((a) => a.price), [300, 310]);
}

console.log("live comps reader (fetchEbayComps)");
{
  urls.length = 0;
  const card = { id: "base1-4", name: "Charizard", number: "4", setName: "Base Set", prices: [] };
  const comps = await fetchEbayComps(card, null, null);
  const search = new URL(urls.find((u) => u.includes("item_summary/search")));
  check("raw card: ungraded filter", search.searchParams.get("filter"), "buyingOptions:{FIXED_PRICE},conditionIds:{4000}");
  check("raw card: Best Offer $900 and $50 auction never reach the average", (comps?.listings ?? []).map((l) => l.price).sort((a, b) => a - b), [300, 310]);
  urls.length = 0;
  await fetchEbayComps(card, { company: "PSA", grade: "10" }, null);
  const slab = new URL(urls.find((u) => u.includes("item_summary/search")));
  check("slab: graded filter", slab.searchParams.get("filter"), "buyingOptions:{FIXED_PRICE},conditionIds:{2750}");
}

if (failures) {
  console.log(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nall green");
