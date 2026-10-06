/**
 * Yu-Gi-Oh! prices from CardTrader listings for cards TCGplayer can't price.
 * Run: npm run test:cardtrader
 *
 * Pins (10-06): "DCR-EN016" finds CardTrader's "016" in the dcr expansion; a
 * number printed in two rarities is settled by our rarity, else no match; the
 * name must agree; the price is the cheapest Near Mint English copy of the
 * right edition; a lone listing at $50+ is skipped (Des Volstgalph $6,341).
 */
import assert from "node:assert/strict";

const { matchBlueprint, listingUsd, expansionCodeOf, matchLorcanaBlueprint, lorcanaListingUsd } = await import("../src/lib/server/cardtrader.ts");

assert.equal(expansionCodeOf("DCR-EN016"), "dcr");
assert.equal(expansionCodeOf("SJC-EN002"), "sjcs");

const bps = [
  { id: 1, name: "Shinato, King of a Higher Plane", fixed_properties: { collector_number: "016", yugioh_rarity: "Ultra Rare" } },
  { id: 2, name: "Dark Magician", fixed_properties: { collector_number: "002", yugioh_rarity: "Rare" } },
  { id: 3, name: "Dark Magician", fixed_properties: { collector_number: "002", yugioh_rarity: "Super Parallel Rare" } },
];
const row = (number, name, rarity = null) => ({ id: "x", name, number, rarity });
assert.equal(matchBlueprint(row("DCR-EN016", "Shinato, King of a Higher Plane"), bps)?.id, 1);
assert.equal(matchBlueprint(row("DTP1-EN002", "Dark Magician", "Rare"), bps)?.id, 2);
assert.equal(matchBlueprint(row("DTP1-EN002", "Dark Magician"), bps), null);
assert.equal(matchBlueprint(row("DCR-EN016", "Someone Else"), bps), null);

const l = (cents, extra = {}) => ({ price_cents: cents, price_currency: "USD", properties_hash: { condition: "Near Mint", yugioh_language: "en", first_edition: false, ...extra } });
assert.equal(listingUsd([l(500), l(300), l(100, { condition: "Played" }), l(50, { yugioh_language: "de" })], false, 1.1), 3);
assert.equal(listingUsd([l(300, { first_edition: true }), l(900)], true, 1.1), 3);
assert.equal(listingUsd([l(634167)], false, 1.1), null);
assert.equal(listingUsd([l(2000)], false, 1.1), 20);
assert.equal(listingUsd([{ price_cents: 1000, price_currency: "EUR", properties_hash: { condition: "Mint" } }], false, 1.1), 11);
assert.equal(listingUsd([], false, 1.1), null);

// Lorcana (10-06): "Kronk - Laid Back" #020 matches our Kronk / Laid Back #20;
// plain and foil are priced apart; other languages never count.
const kronk = { id: 325479, name: "Kronk - Laid Back", fixed_properties: { collector_number: "020" } };
assert.equal(matchLorcanaBlueprint({ id: "x", name: "Kronk", subtitle: "Laid Back", setCode: "P2", number: "20" }, [kronk])?.id, 325479);
assert.equal(matchLorcanaBlueprint({ id: "x", name: "Kronk", subtitle: "Other", setCode: "P2", number: "20" }, [kronk]), null);
const lc = (cents, foil, lang = "en") => ({ price_cents: cents, price_currency: "USD", properties_hash: { condition: "Near Mint", lorcana_foil: foil, lorcana_language: lang } });
assert.deepEqual(lorcanaListingUsd([lc(300, false), lc(900, true), lc(700, true), lc(100, true, "it")], 1.1), { usd: 3, foil: 7 });
assert.deepEqual(lorcanaListingUsd([lc(6000, true)], 1.1), { usd: null, foil: null });

console.log("cardtrader: all assertions passed");
process.exit(0);
