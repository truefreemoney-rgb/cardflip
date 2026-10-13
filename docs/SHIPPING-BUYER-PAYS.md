# Shipping → buyer pays (plan, 10-13)

Chris 10-13 ~1:50–2:50am ET: "it really is a big mess to deal with on our end, let ebay do it".

## Decided
- Up to $20: eBay Standard Envelope and/or Tracked (USPS Ground Advantage), eBay calculates.
- $20.01–$100: Stamped envelope (seller's stamps, flat $1.31 buyer pays, no tracking, no warning) and/or Tracked.
- Over $100: Tracked only.
- Seller checkboxes, both ticked by default, at least one stays; buyer picks at checkout. USPS only, no UPS. No free-shipping option.
- Tracked/envelope labels are printed from the eBay order (cost off payout). Maybe a "Print label on eBay" button on sold cards (screenshot + yes first).
- First step before building: confirm in eBay docs that Standard Envelope supports buyer-paid / calculated; check eBay's letter limits (0.25 in thick, 3 oz).
- Chris 10-13 ~3am: international (GB/IE/AU/CA) is buyer-pays TOO. Check each site's rules first: calculated shipping may not exist on every site (e.g. UK may be flat-rate only) → there use flat buyer-paid local rates from marketplaces.ts.
- Chris 10-13: "i dont care about anything sold so far, its all just our tests" + "no cards are currently listed" → NO legacy math, no ship_terms marker, no listing migration; just switch everything.

- Shipping INSTRUCTIONS stay (Chris 10-13 "and instructions on shipping correct?"): How to ship sheet, the sold card's "How to ship it" row and the sold email/push show steps for the method THE BUYER PICKED (envelope: label from the eBay order on a plain envelope; stamped: $1.31 in stamps + write the address; tracked: label from the eBay order on a bubble mailer). Short numbered steps, link to the order on eBay. Show Chris the wording before shipping.

## Must keep working
1. (dropped, see above: no legacy sold rows to protect; old test sales may show odd numbers, fine.)
2. No live listings, so the "CardFlip *" policies can be rewritten for everyone. Still delete `ensureFreeShipping` (ebaySell.ts ~303) or it flips them back to free. Re-check "no live listings" on prod right before the switch.
3. eBay's fee now also applies to the shipping the buyer pays: estimates in `estimatedEbayFees` / `netAfterFees` must say "about".
4. Package weight/size on every inventory item, ALWAYS a preset default we set, NEVER asked of the seller (Chris 10-13: weighing "adds way to much time building the listing rather than the fast and easy we promised"). Single card ~1 oz letter / mailer; slabs + sealed get their own presets. No weight field anywhere in the UI.
5. Repricing across $20 / $100 switches the policy and options.

## Touchpoint map (Explore sweep 10-13; lines approximate)
**Pricing math:** src/lib/fees.ts (POSTAGE_USD, STAMP/TRACKED constants, postageFor, salePostage(On), ShipMethod, envelopeAllowed, defaultShipMethod, costCoveredPrice/costTaperedPrice drop postage, listingFloor $1.25 → ~$0.35, floorRefusal copy, COSTS_ON_EVERY_CARD/coversCosts); src/lib/marketplaces.ts (US + non-US postage rows, shipping.policyCost, envelopeServiceCode); src/lib/listing.ts (floorNote, coveredAsk, askingPriceFor, quotePrice shipping param); src/lib/localPricing.ts, localQuote.ts; src/lib/cardStory.ts (SellMath.postage); src/lib/shipping.ts (shipOptionsFor, shipLabel, shipConfirmLine, shipSteps, "Free shipping… postage already in your price"); src/lib/profit.ts (saleNet, saleBreakdown, yearTotals); src/lib/types.ts (ScanItem shipping → options set).
**eBay API:** src/lib/ebayInventory.ts (buildInventoryItem add packageWeightAndSize; fulfillmentPolicyBody FLAT_RATE/freeShipping → CALCULATED + flat $1.31 stamped, multiple shippingServices; envelopeAttempts/letterAttempts; sellerPolicyExtras shippingCostOverrides; DraftInput.shippingMethod → list); src/lib/server/ebaySell.ts (createDefaultPolicies, ensureFreeShipping DELETE, namedFulfillmentPolicies v2 names, pickFulfillmentPolicy per combination, requireShipping 409 text + tier rules, sealed forced tracked, reprice PUT keeps old policy); src/lib/server/ebayDraftBody.ts schema; ebayOrders.ts (capture deliveryCost/tax); ebayFinances.ts (fee now includes FVF on shipping); tracked-override feature (EBAY_VALUE_SHIPPING: api/ebay/listing-terms, users.ts, db.ts tracked_ship_*, ListingTermsRow.tsx, account page) → remove/hide.
**Seller UI:** CardEditor.tsx shipping tiles → tier checkboxes, no dollars (slabs gate); quotePrice/floorNote args; ShippingHelpSheet.tsx rewrite; EbayPostActions.tsx gate + copy; ListedPanel.tsx net; SoldPanel.tsx; CardDetailModal.tsx + cards/[game]/[set]/[card]/page.tsx "You Keep"; LocalListingLine.tsx; EbayConnectCard.tsx; app/app/page.tsx shipping mapping + PATCH; lib/client/cardsApi.ts types; pushMessages.ts, server/mail.ts sold email ("ship what the buyer chose"), dailyJobs.ts.
**Inventory & reports:** app/app/collection/page.tsx (oneRate/postageRowLabel, row net, nudges, sold-row line, How to ship it row, Earned + In play stats, fee/postage ledger rows — sold 'seller' rows still show postage); collection/report/page.tsx (postage tile/column/footnote, both regimes); api/cards/report/route.ts CSV Postage column; server/cards.ts shippingMethod read/write.
**Marketing & help:** app/page.tsx (FAQ, binder soldValue, "after eBay's cut and postage", fee tile postage row); app/pricing/page.tsx; lib/features.ts; lib/helpArticles.ts (add buyer-pays + fee-on-shipping); repriceNudges.ts comments.
**DB:** cards.shipping_method (envelope|tracked) → add ship_options + ship_terms; api/cards/[id] route validation; tracked_ship_* inert.
**Tests:** test-profit (keep legacy, add buyer-pays), test-pricing, test-marketplaces, test-ebay-sell (fake eBay policy POST), test-ebay-sweeps, test-digest, test-ebay-local, test-ebay-golden + fixtures/ebay-golden/requests.json (regenerate), ebay-sandbox-e2e, ebay-item-debug.
