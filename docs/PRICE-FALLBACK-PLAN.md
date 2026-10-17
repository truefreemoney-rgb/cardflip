# Price fallback plan (10-17, TOP PRIORITY)

Chris 10-17: "we cant have unpriced cards on the website ... the prices have to be pretty accurate
to the REAL SOLD market or our whole service dosnt make sense ... highest level of importance".
Trigger: new Google Ads user's Eevee svp-173 scanned at $0 (LESSONS.md 10-17). Fixed by hand to $13.

## What happens today
- Guard: `src/lib/server/priceTrust.ts` (pure rule, `priceTrust()` PT:389-490) + `src/lib/server/priceTrustSite.ts`
  (`judgeFull` PTS:124-183 builds `PriceFlag {hard, reason}` at PTS:182; type in `src/lib/priceFlag.ts:10`).
- Any flag = NO price everywhere: `quotePrice` returns null (listing.ts:510) -> scan saved $0 (app/app/page.tsx:818-824);
  Inventory `livePrices.ts:94-116` zeroes unlocked drafts; card pages "looks off" + noindex when all printings flagged.
- The reference each verdict compared against is computed but NOT returned:
  - spike / doubling: pre-jump level `max(med7, med30)` inside `features()` PT:283-288 (svp-173: 79.66 / 5.8 = $13.73; eBay sold median $12.99)
  - Cardmarket referee: `ref*1.1` USD from cmEur (PTS:313-314, 166-175)
  - eBay ask high: q75 / median NM ask (ebayReferee.ts:344-353; only medianAsk + nNm reach PT, PTS:199)
  - 1c climb: median NM eBay ask (PT:429-435)
  - sibling / flat+sibling / flat-vs-listing-low: sibling value, anchor, listingLowUsd (weak as value estimates)
  - soft signs (thin/round/young): no reference at all
- **No eBay SOLD data exists in the DB.** Marketplace Insights was denied 2026-08-16 (`fetchEbaySoldComps` server/ebay.ts:224-290
  behind EBAY_INSIGHTS_ENABLED). Closest: `ebay_asks` (nightly Browse ASKS, $100+ printings: n, n_nm, median_usd, q75_usd),
  active-listing comps average cached 24 h (`ebaycomps:v1:<id>:...`, ebayCompsCache.ts), `listing_lows` (TCGplayer cheapest).
- **No PriceCharting data/code** (comment only, PT:457). Board: waits on a paid license; showing their numbers needs a commercial license.
- Why scan 1 got $14.03: most likely the after-save eBay comps load (page.tsx:951-1000, `loadEbayComps` -> `ebayAverage` row,
  `pickPrice` prefers eBay rows) re-priced it; scan 2's comps did not land (cache key differs on firstEdition, or error) -> stayed $0.

## Plan (step 1 = free, ship first; step 2 = real sold data, Chris's call)
1. **Flag carries a fallback.** `priceTrust` returns `ref` per verdict; `features()` also returns the pre-jump level;
   `judgeFull` sets `PriceFlag.fallback` (USD) only where the reference is a sound value: spike, doubling (pre-jump level),
   Cardmarket referee (CM USD), eBay ask high / 1c (median NM ask). Then:
   - `quotePrice` / `headlinePrice` / `currentPrice` price from `flag.fallback` instead of null/0 (label it, e.g. "checked price").
   - scanner saves the fallback, never $0; Inventory `livePrices` suggests the fallback instead of zeroing.
   - card pages show the fallback instead of "looks off" (VISIBLE: count cards affected, phone screenshots, Chris yes before push).
   - plumb through every flag builder: withPriceFlags PTS:448, siteTrustFull :416, heldTrust :513, latestUsdWithTrust :556,
     storedPriceFlags :584, /api/price-history, set-cards, price-check, priceChecks.ts:224; types CurrentSeriesPoint (listing.ts:432),
     RecordedPoint (priceHistoryData.ts:26), LivePrice.flag (livePrices.ts:48).
   - flags with no sound reference (soft signs, flat/sibling): next best = eBay asks median / comps average if present; else keep
     the stored last-good price; count how many cards are still left with nothing.
   - MEASURE before shipping: labelled sample of flagged cards, fallback vs eBay sold (by hand in the pane, no slabs), report error.
2. **Real sold data source** (needed for the accuracy bar; Chris decides, money): PriceCharting API ($49/mo, commercial display
   license question) or another sold-data feed; ingest into `price_series` source `pricecharting`, used first in the fallback
   and as the referee. Bring numbers: how far TCGplayer market is from eBay sold on a sample.
3. Every consumer: social/marketing lists can keep skipping flagged cards (posts must be sure); seller-facing + public pages must not blank.

## Measured 10-17 (s185)
- Flagged today (Pokemon, cards only, sealed excluded): 337 printings. Fallback offered by the new code: 233
  (before jump 70, ebay ask hard 73 / soft 73, cheapest listing 9, sibling 3, cardmarket 2); none: 104 soft (thin/round/young)
  + 3 manual "checked: too high". Script: scripts/_fb-measure.mjs <game> [out.json] (prod SELECTs only).
- 16 RANDOM UNFLAGGED Pokemon cards ($5+, scripts/_fb-random.mjs) vs eBay sold raw (median of last <=15 single raw sales,
  slabs/lots/"choose" excluded): ours within 25% = 5/16 (31%); 10 too high 1.4x-2.8x (Vivillon xy1-17 RH $10.92 vs $3.99,
  Espeon hgss3-2 RH $72.49 vs $26.03, Switch dp3-128 RH $11.98 vs $5.99, Lucario C $26.40 vs $15.99, Eevee neo2-38-1st $41.94 vs ~$30).
- PriceCharting public ungraded price on the same 16: within 25% = 12/16 (75%), fixes ~9 of our 11 misses. Misses: Boost Energy
  pop5-8 (no ungraded price), Volcarona MB (PC $10.58 vs sold $15.99, ours right), Vivillon (PC $2.97 vs $3.99; PC splits 5
  wing patterns we lump), Alakazam EX xy10-125 (PC $169 vs a mixed eBay median $105, unclear). => the accuracy problem is
  most cards, not the flagged few; PriceCharting first + TCGplayer where PC has nothing. Other games NOT measured yet.

## Tests that pin today's hide behaviour (update with the change)
test-pricing.mjs ~690-731 (flagged row = null quote, currentPrice 0), test-live-prices.mjs 153-160 (flagged draft zeroed),
test-price-trust-site.mjs 204/222 (deepEqual flag shape), test-price-trust-routes.mjs 85-148 (flag shape in responses,
representativePrice null), test-card-pages.mjs 162-211/397 (headline/noindex/sitemap), test-inventory-value 97-109,
test-digest 99-104, test-card-alerts 136-139, test-public-collection 97-98, test-ebay-sweeps 262-287.
