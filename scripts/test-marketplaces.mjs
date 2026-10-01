/**
 * The eBay marketplace table + per-marketplace fee variants. Run: npm run test:marketplaces
 *
 * Pins: the table is sane (every row has the fields the plan lists, the
 * codes/currencies/domains line up, only US is live, NZ rides eBay AU but is
 * flagged unverified); marketplaceFor() is ALWAYS the US row with the switch
 * off, with a mismatched/missing registration, for a US/NZ/unknown home, and
 * only returns a local row when the switch is on AND home is CA/GB/IE/AU AND
 * the registration agrees; and every `…For(US)` fee function equals its
 * untouched US export across a price sweep, so the US path cannot drift.
 */
import {
  MARKETPLACES,
  US_MARKETPLACE,
  LOCAL_MARKET_COUNTRIES,
  marketplaceFor,
  feeModelFor,
} from "../src/lib/marketplaces.ts";
import * as fees from "../src/lib/fees.ts";

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`,
  );
}

console.log("Table");
{
  const want = {
    US: ["EBAY_US", "USD", "en-US", "ebay.com", "US"],
    CA: ["EBAY_CA", "CAD", "en-CA", "ebay.ca", "CA"],
    GB: ["EBAY_GB", "GBP", "en-GB", "ebay.co.uk", "GB"],
    IE: ["EBAY_IE", "EUR", "en-IE", "ebay.ie", "IE"],
    AU: ["EBAY_AU", "AUD", "en-AU", "ebay.com.au", "AU"],
    NZ: ["EBAY_AU", "AUD", "en-AU", "ebay.com.au", "NZ"],
  };
  check("six rows, keyed by their own key", Object.keys(MARKETPLACES).sort(), Object.keys(want).sort());
  for (const [k, w] of Object.entries(want)) {
    const r = MARKETPLACES[k];
    check(`${k}: id / currency / language / domain / location`, [r.marketplaceId, r.currency, r.contentLanguage, r.domain, r.locationCountry, r.key], [...w, k]);
    check(`${k}: postage > 0, taper end > coveredMax > 0, service code set`, [r.postage > 0, r.taper.end > r.taper.coveredMax && r.taper.coveredMax > 0, r.shipping.serviceCode.length > 0], [true, true, true]);
    for (const acct of ["private", "business"]) {
      const f = r.fees[acct];
      check(`${k}/${acct}: fee model is finite and sane`, [0 <= f.rate && f.rate < 0.3, f.flat >= 0, f.flatOver >= f.flat, f.flatStep > 0], [true, true, true, true]);
    }
    check(`${k}: postal label`, r.postalLabel, k === "US" ? "ZIP" : "Postcode");
  }
  check("only the US row is live", Object.values(MARKETPLACES).filter((r) => r.live).map((r) => r.key), ["US"]);
  // 09-30: fees + postage are sourced from official pages; only AU's business column (inferred Pro tier) and NZ stay unverified.
  check("unverified flags: AU and NZ only", Object.values(MARKETPLACES).filter((r) => r.unverified).map((r) => r.key), ["AU", "NZ"]);
  check("every non-US row says what is caveated", Object.values(MARKETPLACES).filter((r) => r.key !== "US").every((r) => Array.isArray(r.unverifiedNotes) && r.unverifiedNotes.length > 0), true);
  check("US is not unverified", [US_MARKETPLACE.unverified, US_MARKETPLACE.unverifiedNotes], [false, []]);
  check("shipping codes (GB per eBay's own list for the site, not the plan's guess)", [MARKETPLACES.GB.shipping.serviceCode, MARKETPLACES.IE.shipping.serviceCode, MARKETPLACES.AU.shipping.serviceCode, MARKETPLACES.CA.shipping.serviceCode, MARKETPLACES.NZ.shipping.serviceCode], [
    "UK_RoyalMail2ndClassLetter", "IE_FirstClassLetterService", "AU_AusPostStandardLetter", "CA_PostLettermail", "AU_IntlEconomyUntracked",
  ]);
  check("sourced postage", [MARKETPLACES.GB.postage, MARKETPLACES.IE.postage, MARKETPLACES.AU.postage, MARKETPLACES.CA.postage], [1.55, 3.5, 3.7, 2.61]);
  check("sourced fees (rate incl. regulatory fee, per-order flat/over/step)", [
    MARKETPLACES.GB.fees.private, MARKETPLACES.GB.fees.business, MARKETPLACES.IE.fees.private, MARKETPLACES.IE.fees.business,
    MARKETPLACES.AU.fees.private, MARKETPLACES.AU.fees.business, MARKETPLACES.CA.fees.private, MARKETPLACES.CA.fees.business,
  ], [
    { rate: 0, flat: 0, flatOver: 0, flatStep: 10 }, { rate: 0.1125, flat: 0.3, flatOver: 0.4, flatStep: 10 },
    { rate: 0.1143, flat: 0.05, flatOver: 0.35, flatStep: 9.99 }, { rate: 0.1135, flat: 0.35, flatOver: 0.45, flatStep: 10 },
    { rate: 0, flat: 0, flatOver: 0, flatStep: 10 }, { rate: 0.1144, flat: 0.3, flatOver: 0.3, flatStep: 10 },
    { rate: 0.1325, flat: 0.3, flatOver: 0.4, flatStep: 10 }, { rate: 0.1325, flat: 0.3, flatOver: 0.4, flatStep: 10 },
  ]);
  check("hard-coded whole-unit tapers", [MARKETPLACES.GB.taper, MARKETPLACES.IE.taper, MARKETPLACES.AU.taper, MARKETPLACES.CA.taper], [
    { coveredMax: 4, end: 8 }, { coveredMax: 4, end: 10 }, { coveredMax: 8, end: 15 }, { coveredMax: 7, end: 14 },
  ]);
  check("policy cost set on every non-NZ local row", ["GB", "IE", "AU", "CA"].every((k) => /^\d+\.\d{2}$/.test(MARKETPLACES[k].shipping.policyCost)), true);
  check("US row reproduces today's literals", [US_MARKETPLACE.shipping, US_MARKETPLACE.postage, US_MARKETPLACE.fees.business], [
    { carrierCode: "USPS", serviceCode: "USPSGroundAdvantage", fallbackServiceCode: "USPSPriority", policyCost: "4.99" },
    0.75,
    { rate: fees.EBAY_FEE_RATE, flat: fees.EBAY_FLAT_FEE, flatOver: fees.EBAY_FLAT_FEE_OVER_10, flatStep: fees.EBAY_FLAT_FEE_STEP_USD },
  ]);
  check("UK and AU private sellers pay no fee; business pays", [
    feeModelFor(MARKETPLACES.GB, "INDIVIDUAL").rate, feeModelFor(MARKETPLACES.AU, "INDIVIDUAL").rate,
    feeModelFor(MARKETPLACES.GB, "BUSINESS").rate > 0, feeModelFor(MARKETPLACES.GB, null).rate > 0, feeModelFor(MARKETPLACES.GB).rate > 0,
  ], [0, 0, true, true, true]);
  check("local market countries exclude US and NZ", [...LOCAL_MARKET_COUNTRIES], ["CA", "GB", "IE", "AU"]);
}

console.log("marketplaceFor");
{
  const us = (over) => marketplaceFor(over).key;
  check("switch off → US for every home + registration", ["US", "CA", "GB", "IE", "AU", "NZ", "", null, undefined].map((h) => us({ homeCountry: h, ebayRegistrationMarketplace: h ? `EBAY_${h}` : null, switchOn: false })).every((k) => k === "US"), true);
  check("switch omitted → US", us({ homeCountry: "GB", ebayRegistrationMarketplace: "EBAY_GB" }), "US");
  check("switch truthy-but-not-true → US", us({ homeCountry: "GB", ebayRegistrationMarketplace: "EBAY_GB", switchOn: "1" }), "US");
  // Increment 1: no local row is live, so even a full match stays on US. Increment 2 marks GB live and expects "GB" here.
  check("switch on, GB home + GB registration, GB not live → US", us({ homeCountry: "GB", ebayRegistrationMarketplace: "EBAY_GB", switchOn: true }), "US");
  for (const c of ["CA", "GB", "IE", "AU"]) {
    check(`switch on, ${c} home + ${c} registration, not live → US`, us({ homeCountry: c, ebayRegistrationMarketplace: `EBAY_${c}`, switchOn: true }), "US");
    check(`switch on, ${c} home + US registration → US`, us({ homeCountry: c, ebayRegistrationMarketplace: "EBAY_US", switchOn: true }), "US");
    check(`switch on, ${c} home + no registration → US`, us({ homeCountry: c, ebayRegistrationMarketplace: null, switchOn: true }), "US");
  }
  check("switch on, GB home + IE registration → US", us({ homeCountry: "GB", ebayRegistrationMarketplace: "EBAY_IE", switchOn: true }), "US");
  check("switch on, US home → US", us({ homeCountry: "US", ebayRegistrationMarketplace: "EBAY_US", switchOn: true }), "US");
  check("switch on, NZ home (even registered on AU) → US", us({ homeCountry: "NZ", ebayRegistrationMarketplace: "EBAY_AU", switchOn: true }), "US");
  check("switch on, unknown home → US", us({ homeCountry: "FR", ebayRegistrationMarketplace: "EBAY_FR", switchOn: true }), "US");
  check("every local row is still not live", ["CA", "GB", "IE", "AU", "NZ"].every((c) => MARKETPLACES[c].live === false), true);
  check("no input at all → the US row object itself", marketplaceFor({}) === US_MARKETPLACE, true);
}

console.log("fee variants: For(US) === the existing US exports");
{
  const mp = US_MARKETPLACE;
  const sweep = [];
  for (let c = 0; c <= 3000; c += 1) sweep.push(c / 100); // $0.00 – $30.00 every cent
  for (let c = 3000; c <= 5_000_000; c += 4999) sweep.push(c / 100); // out to $50,000
  sweep.push(4.999, 5, 5.001, 9.995, 10, 10.004, 10.01, 0.005, 1.22, 1.5);
  const diffs = { flat: 0, est: 0, cover: 0, covers: 0, coversAll: 0, taper: 0, net: 0, netActual: 0, below: 0 };
  for (const v of sweep) {
    if (fees.ebayFlatFeeFor(mp, v) !== fees.ebayFlatFee(v)) diffs.flat++;
    if (fees.estimatedEbayFeesFor(mp, v) !== fees.estimatedEbayFees(v)) diffs.est++;
    if (fees.costCoveredPriceFor(mp, v) !== fees.costCoveredPrice(v)) diffs.cover++;
    if (fees.coversCostsFor(mp, v) !== fees.coversCosts(v)) diffs.covers++;
    if (fees.coversAllCostsFor(mp, v) !== fees.coversAllCosts(v)) diffs.coversAll++;
    if (fees.costTaperedPriceFor(mp, v) !== fees.costTaperedPrice(v)) diffs.taper++;
    if (fees.netAfterFeesFor(mp, v) !== fees.netAfterFees(v)) diffs.net++;
    if (fees.netAfterFeesFor(mp, v, 0.42) !== fees.netAfterFees(v, 0.42)) diffs.netActual++;
    if (fees.belowFloorFor(mp, v) !== fees.belowFloor(v)) diffs.below++;
  }
  console.log(`  (${sweep.length} prices swept)`);
  for (const [k, n] of Object.entries(diffs)) check(`${k}: no differences`, n, 0);
  check("listingFloor", fees.listingFloorFor(mp), fees.listingFloor());
  check("floorRefusal text", fees.floorRefusalFor(mp), fees.floorRefusal());
  check("account type changes nothing on US (private = business)", [fees.listingFloorFor(mp, "INDIVIDUAL"), fees.costTaperedPriceFor(mp, 3.33, "INDIVIDUAL")], [fees.listingFloor(), fees.costTaperedPrice(3.33)]);
  check("US known values: floor $1.22, $5 → $6.98, $7.50 → $8.68, $10 → $10", [fees.listingFloorFor(mp), fees.costTaperedPriceFor(mp, 5), fees.costTaperedPriceFor(mp, 7.5), fees.costTaperedPriceFor(mp, 10)], [1.22, 6.98, 8.68, 10]);
}

console.log("fee variants: other markets behave");
{
  const gb = MARKETPLACES.GB;
  check("GB private: floor is postage only, no fee", [fees.listingFloorFor(gb, "INDIVIDUAL"), fees.estimatedEbayFeesFor(gb, 20, "INDIVIDUAL")], [1.55, 0]);
  check("GB business floor above GB private floor", fees.listingFloorFor(gb, "BUSINESS") > fees.listingFloorFor(gb, "INDIVIDUAL"), true);
  check("GB unknown account = business", fees.listingFloorFor(gb, null), fees.listingFloorFor(gb, "BUSINESS"));
  check("GB taper is local: costs on top under £8, none from £8", [fees.coversCostsFor(gb, 7.99), fees.coversCostsFor(gb, 8), fees.costTaperedPriceFor(gb, 8, "BUSINESS")], [true, false, 8]);
  check("GB taper never prices below the value and never above the full-cover price", (() => {
    for (let c = 1; c < 800; c++) {
      const v = c / 100;
      const p = fees.costTaperedPriceFor(gb, v, "BUSINESS");
      if (p < v - 1e-9 || p > fees.costCoveredPriceFor(gb, v, "BUSINESS") + 1e-9) return false;
    }
    return true;
  })(), true);
  check("floor refusal prints the local currency", [fees.floorRefusalFor(gb, "INDIVIDUAL").startsWith("The lowest price is £1.55"), fees.floorRefusalFor(MARKETPLACES.IE, "BUSINESS").includes("€")], [true, true]);
  check("CA: $0.30 / $0.40 step like US", [fees.ebayFlatFeeFor(MARKETPLACES.CA, 10), fees.ebayFlatFeeFor(MARKETPLACES.CA, 10.01)], [0.3, 0.4]);
}

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll marketplace checks passed");
