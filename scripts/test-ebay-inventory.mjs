/**
 * Checks the Sell Inventory API payload builder: the bodies we PUT/POST to
 * eBay for a draft listing. Run: npm run test:inventory
 *
 * No network. What matters here is that a raw card, a slab, and a sealed box
 * each land in the right eBay condition + descriptors, that nothing over
 * eBay's length limits gets sent, and that an update body never carries the
 * immutable offer fields.
 */
import {
  buildInventoryItem,
  buildItemDraft,
  buildOffer,
  descriptionHtml,
  gradeDescriptorValue,
  offerUpdateBody,
  skuForCard,
  validateDraftInput,
} from "../src/lib/ebayInventory.ts";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`,
  );
}

const card = {
  name: "Charizard",
  englishName: null,
  setName: "Base Set",
  number: "4",
  rarity: "Rare Holo",
  imageLarge: "https://assets.tcgdex.net/en/base/base1/4/high.webp",
  imageSmall: "https://assets.tcgdex.net/en/base/base1/4/low.webp",
};

const base = {
  cardId: "0f2b7c1e-1234-4abc-9def-0123456789ab",
  listing: {
    title: "Charizard Base Set 4 Pokemon TCG Near Mint",
    description: "Charizard — Base Set, card 4.\n\nCondition: Near Mint.\n\nShips fast & safe <3",
    price: 818,
    categoryId: "183454",
    categoryName: "Collectible Card Games > Pokémon TCG > Individual Cards",
  },
  card,
  hasPhoto: true,
  kind: "card",
  condition: "Near Mint",
  grading: null,
  firstEdition: false,
  productType: null,
  language: "en",
};

console.log("Raw card");
{
  const item = buildInventoryItem(base);
  check("condition = Ungraded (4000)", item.condition, "USED_VERY_GOOD");
  check("card condition descriptor NM", item.conditionDescriptors, [
    { name: "40001", values: ["400010"] },
  ]);
  check("quantity 1", item.availability.shipToLocationAvailability.quantity, 1);
  check("Graded aspect No", item.product.aspects.Graded, ["No"]);
  check("Card Name aspect", item.product.aspects["Card Name"], ["Charizard"]);
  check("Card Number aspect", item.product.aspects["Card Number"], ["4"]);
  check(
    "images: only the seller's own photo, from our origin (eBay picture policy — no stock art)",
    item.product.imageUrls,
    [`https://cardflip.io/api/card-image/${base.cardId}`],
  );
  check(
    "no seller photo → no images at all (catalogue art never sent)",
    buildInventoryItem({ ...base, hasPhoto: false }).product.imageUrls,
    [],
  );
  check(
    "Heavily Played → 183454's Heavily Played (Poor) id, not the sports-card 400013",
    buildInventoryItem({ ...base, condition: "Heavily Played" }).conditionDescriptors[0].values,
    ["400017"],
  );
  check(
    "Lightly Played → 183454's Lightly Played (Excellent) id",
    buildInventoryItem({ ...base, condition: "Lightly Played" }).conditionDescriptors[0].values,
    ["400015"],
  );
  check(
    "1st Edition → Features aspect",
    buildInventoryItem({ ...base, firstEdition: true }).product.aspects.Features,
    ["1st Edition"],
  );
  check(
    "Japanese card → Language aspect + English name",
    buildInventoryItem({
      ...base,
      language: "ja",
      card: { ...card, name: "リザードン", englishName: "Charizard" },
    }).product.aspects["Card Name"],
    ["Charizard"],
  );
}

console.log("Graded slab");
{
  const item = buildInventoryItem({
    ...base,
    grading: { company: "PSA", grade: "10" },
    listing: { ...base.listing, title: "Charizard Base Set 4 Pokemon TCG PSA 10" },
  });
  check("condition = Graded (2750)", item.condition, "LIKE_NEW");
  check("grader + grade descriptors", item.conditionDescriptors, [
    { name: "27501", values: ["275010"] },
    { name: "27502", values: ["275020"] },
  ]);
  check("Graded aspect Yes", item.product.aspects.Graded, ["Yes"]);
  check("Grade aspect", item.product.aspects.Grade, ["10"]);
  check("CGC 9.5 grade id", gradeDescriptorValue("9.5"), "275021");
  check("grade 1 id", gradeDescriptorValue("1"), "2750218");
  check("CGC 10 Pristine → 10", gradeDescriptorValue("10 Pristine"), "275020");
  check("off-ladder grade → null", gradeDescriptorValue("9.25"), null);
  const cgc = buildInventoryItem({ ...base, grading: { company: "CGC", grade: "10 Pristine" } });
  check("CGC grader id", cgc.conditionDescriptors[0].values, ["275015"]);
  check("Pristine stripped from Grade aspect", cgc.product.aspects.Grade, ["10"]);
}

console.log("Sealed product");
{
  const item = buildInventoryItem({
    ...base,
    kind: "sealed",
    productType: "Booster Box",
    listing: { ...base.listing, categoryId: "261044", title: "Base Set Pokemon TCG Factory Sealed" },
  });
  check("condition NEW, no descriptors", [item.condition, item.conditionDescriptors], ["NEW", undefined]);
  check("Type aspect", item.product.aspects.Type, ["Booster Box"]);
  check("no Card Name aspect", item.product.aspects["Card Name"], undefined);
}

console.log("Offer");
{
  const offer = buildOffer(base);
  check("sku from card id", offer.sku, skuForCard(base.cardId));
  check("quantity defaults to 1", offer.availableQuantity, 1);
  check("quantity carries through", buildOffer({ ...base, quantity: 4 }).availableQuantity, 4);
  check(
    "inventory item quantity matches",
    buildInventoryItem({ ...base, quantity: 4 }).availability.shipToLocationAvailability.quantity,
    4,
  );
  check("quantity clamps to 1..99", [buildOffer({ ...base, quantity: 0 }).availableQuantity, buildOffer({ ...base, quantity: 250 }).availableQuantity], [1, 99]);
  check("sku ≤ 50 chars", offer.sku.length <= 50, true);
  check("price as string", offer.pricingSummary.price, { currency: "USD", value: "818.00" });
  check("category", offer.categoryId, "183454");
  check("no policies when none known", offer.listingPolicies, undefined);
  check(
    "description → HTML paragraphs, escaped",
    offer.listingDescription,
    "<p>Charizard — Base Set, card 4.</p><p>Condition: Near Mint.</p><p>Ships fast &amp; safe &lt;3</p>",
  );
  const withPolicies = buildOffer(base, {
    policies: { fulfillmentPolicyId: "f1", paymentPolicyId: undefined, returnPolicyId: "r1" },
    merchantLocationKey: "loc1",
  });
  check("policies keep only known ids", withPolicies.listingPolicies, {
    fulfillmentPolicyId: "f1",
    returnPolicyId: "r1",
  });
  check("location attached", withPolicies.merchantLocationKey, "loc1");
  const update = offerUpdateBody(withPolicies);
  check("update body drops immutable fields", ["sku" in update, "marketplaceId" in update, "format" in update], [false, false, false]);
  check("update body keeps price", update.pricingSummary.price.value, "818.00");
  check("descriptionHtml single-newline → br", descriptionHtml("a\nb"), "<p>a<br>b</p>");
}

console.log("Item draft (Listing API)");
{
  const d = buildItemDraft(base);
  check("category + format + marketplace", [d.categoryId, d.format, d.marketplaceId], ["183454", "FIXED_PRICE", "EBAY_US"]);
  check("price as string", d.pricingSummary.price, { currency: "USD", value: "818.00" });
  check("condition + descriptors as the inventory item", [d.condition, d.conditionDescriptors], ["USED_VERY_GOOD", [{ name: "40001", values: ["400010"] }]]);
  check("description is HTML", d.product.description.startsWith("<p>"), true);
  check("same photo rule", d.product.imageUrls, [`https://cardflip.io/api/card-image/${base.cardId}`]);
  check("aspects carried", d.product.aspects["Card Name"], ["Charizard"]);
}

console.log("Validation");
{
  check("valid draft passes", validateDraftInput(base), null);
  check("price 0 rejected", validateDraftInput({ ...base, listing: { ...base.listing, price: 0 } }), "Set a price above $0 first");
  check("long title rejected", validateDraftInput({ ...base, listing: { ...base.listing, title: "x".repeat(81) } }), "Title is over eBay's 80-character limit");
  check("unknown category rejected", validateDraftInput({ ...base, listing: { ...base.listing, categoryId: "1" } }), "Unknown eBay category");
  check("no seller photo rejected", validateDraftInput({ ...base, hasPhoto: false }), "Add a photo of the actual item first — eBay requires your own photo, not catalogue art");
}

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
