# eBay per-country listing — plan (09-30)

## REVISED after skeptic review (09-30 ~7:45pm ET) — this section wins over the rest
Increments:
1. PLUMBING, switch off, ZERO US change (build next): marketplaces.ts (US row only live), `…For(mp)` fee
   functions beside the untouched US exports, ebayFetch(marketplace) defaulting to US with the exact en-US
   headers, nullable cards.ebay_marketplace / list_currency / list_price_local, ebay_tokens.account_type +
   registration_marketplace (eBay Identity getUser at connect), admin switch ebay_local_markets, marketplaceFor()
   returning US. FIRST write golden tests byte-pinning the US buildInventoryItem / buildOffer / buildItemDraft /
   headers / updateOfferPrice. Plus an admin Needs You row when a CA/GB/IE/AU seller connects eBay (Chris knows
   nobody abroad: the first real seller is the tester).
2. GB only, allow-listed account: local price computed from the USD MARKET value with the local fee model at push
   time (never from cards.price, which livePrices rewrites with US fees); list_price_local is the authority;
   per-marketplace floor on api/cards POST, api/cards/[id] PATCH, api/ebay/reprice, validateDraftInput; reprice /
   withdraw / listing URL by the card's stored marketplace; drafts (Listing API) + CSV off for non-US; nudges
   (repriceNudges.ts) + alerts skipped for local rows; public collection shows the local price. Hard-code taper
   thresholds per marketplace (never FX-derived). Refuse local listing if FX older than ~3 days. Fulfillment policy
   needs shippingCarrierCode + validated service codes (throwaway policy POST per site); location filtered by key
   + country; check GPSR/regulatory for EU/IE and 14-day consumer returns.
3. Sales/fees sync with currency (defer an order when no FX rate; historical rates from Frankfurter on demand, no
   fx_daily table; fee currency = payout currency), auto-offers per marketplace, UI.
4. IE, AU, CA one at a time, each after a real seller. NZ OUT of scope (stays ebay.com USD) until a NZ seller.
Route to a local marketplace only when home_country AND eBay registrationMarketplaceId agree.

Goal: a seller whose users.home_country is CA / GB / IE / AU / NZ lists on their own eBay site in their
currency (NZ -> eBay Australia in AUD, Chris's pick). US sellers: zero change. Everything ships behind an
admin switch `ebay_local_markets` (default OFF = everyone lists on EBAY_US exactly as today).

## Facts (verified 09-30 via /api/ops/ebay-marketplaces, workflow ebay-research.yml)
- Category ids 183454/183456/261044 exist on every site (trees US 0, GB 3, AU 15, CA 2, IE 205).
- Condition ids 4000/2750/1000 and descriptors 40001 (400010/15/16/17), 27501/27502/27503 are identical everywhere.
- Only required aspect: Game (FREE_TEXT). Our aspect names are the same on every site.
- Returns: 30 or 60 days everywhere (14 is invalid on GB/AU/CA). Our default is 30, buyer pays. We will not send
  returnMethods on non-US sites.
- Domestic shipping codes (untracked letter): GB UK_RoyalMail2ndClassLargeLetter, IE IE_FirstClassLetterService,
  AU AU_AusPostStandardLetter, CA CA_PostLettermail. Tracked alternatives are in summary.json.

## 1. Marketplace table — src/lib/marketplaces.ts (pure)
Per home country: marketplaceId, currency, contentLanguage (en-US/en-CA/en-GB/en-IE/en-AU), site domain
(ebay.com / ebay.ca / ebay.co.uk / ebay.ie / ebay.com.au), locationCountry, postage (local), fee model
{ rate, flat, flatOver, flatStep } for private vs business, default shipping service code, postal label
("ZIP" vs "Postcode"). NZ -> EBAY_AU, currency AUD, location NZ, shipping = international from NZ
(AU_IntlEconomyUntracked). NZ is flagged UNVERIFIED and stays on EBAY_US until a real NZ seller tests it.
`marketplaceFor(user)` returns EBAY_US unless the switch is on AND home is one of CA/GB/IE/AU.

## 2. Seller account type
eBay Commerce Identity getUser (scope already granted) returns accountType INDIVIDUAL | BUSINESS. Stored on
ebay_tokens.account_type at connect and refreshed lazily. It picks the fee model: UK and AU private sellers
pay 0% final value fee; business sellers pay the listed rate. Unknown = business (the conservative, higher price).

## 3. Price in local currency — src/lib/fees.ts becomes marketplace-aware
- The market price stays USD (TCGplayer). The local market value = USD x the daily FX rate (lib/server/fx.ts),
  rounded to the cent.
- Local fees, postage and floor use the same formulas with that marketplace's numbers: fee rate, per-order fee
  (+ step), postage.
- The cheap-card taper thresholds ($5 / $10) become local by FX, rounded to a whole unit (e.g. £4 / £8).
- The US path uses the same functions with the US row, so the existing tests pin it unchanged.
- The listing floor (break-even) is per marketplace. floorRefusal prints the local currency.

## 4. Stored per listing
New cards columns:
- `ebay_marketplace` (NULL = EBAY_US, legacy)
- `list_currency` (NULL = USD)
- `list_price_local` (the asking price actually sent to eBay)

cards.price stays the USD-equivalent (for the ledger totals, charts, the digest).
- Listing links: ebayListingUrl(listingId, marketplace) uses the stored site, so old US links never change.
- Reprice / withdraw / auto-offer use the card's stored marketplace, not the seller's current home.

## 5. eBay calls — src/lib/server/ebaySell.ts, ebayInventory.ts
- ebayFetch(path, opts, marketplace) sets X-EBAY-C-MARKETPLACE-ID + Content-Language / Accept-Language per site.
- The inventory item, offer and updateOfferPrice take the currency from the marketplace (no USD literals).
- policyIds / createDefaultPolicies are per marketplace:
  - shipping: the site's letter code at the local postage cost
  - handling: 1 day
  - returns: 30 days, buyer pays, no returnMethods
  - policy names get a site suffix
- Merchant location: key `cardflip-<cc>`, country = home, and the postal prompt says "Postcode" outside the US.

## 6. Sales + fees sync (ebayOrders.ts, ebayFinances.ts)
- Read lineItemCost.currency and the fee currency.
- Store sold_price_local + sold_currency.
- sold_price / sold_fees become USD equivalents at the sale date's FX (the fx_rates history: keep a small daily
  history table fx_daily so an old sale converts at its own day, not today's).
- A US sale is untouched (currency USD).

## 7. UI
Editor / confirm modal / floor note show the local listing price for a non-US seller ("£3.99 on eBay UK"), with
the USD market price underneath (existing <Price>). Collection totals stay USD with the ≈ local line (already
built). The CSV draft export stays US-only for now (hidden for non-US sellers). Comps stay from EBAY_US (labelled
"US sold prices") — phase 2.

## 8. Rollout
1. Build + tests with the switch OFF → push → US unchanged (CI + prod smoke).
2. ONE real test on eBay UK: with Chris's OK, publish one cheap card from Chris's own account to EBAY_GB with the
   switch on for his account only (admin override), check it on ebay.co.uk, then withdraw it. Cross-border
   listing from a US account may be refused; if so, we need a real UK/CA/AU seller (helper) for the first
   listing.
3. Switch ON for GB/IE/CA/AU. NZ stays on EBAY_US until a NZ seller verifies.

## Tests
- test:marketplaces: table + marketplaceFor + local price math per site (UK private £0.25 card → price,
  business, AU, CA $0.30/$0.40 step, IE), floors.
- ebay-inventory/ebay-sell: a GB payload (currency GBP, en-GB headers, shipping code, no returnMethods, location
  GB); the US payload byte-identical to today.
- ebaysync: a GBP order stores local + USD equivalent at the sale date's rate.
- The existing US tests unchanged.

## Open for Chris
- A test listing on eBay UK from his account (publish then withdraw), yes/no.
- Postage numbers: £1.55 / A$3.70 / C$2.61 / €3.50 — UK/AU/CA still UNCONFIRMED in research.
