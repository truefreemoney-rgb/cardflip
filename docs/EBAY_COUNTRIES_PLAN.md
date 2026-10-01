# eBay per-country listing — plan (09-30)

## BUILT 09-30 night (increments 2 + 3, UI, sandbox harness) — read this first
**Rule change (owner, 09-30): there is NO real-seller gate any more.** Verification = eBay's official fee pages per
country + the eBay SANDBOX end-to-end run + the golden US tests. Targets: EBAY_GB, EBAY_IE, EBAY_AU, EBAY_CA. NZ stays
on ebay.com in USD (out of scope). **Every local row is still `live:false`**: nothing routes off eBay US until the owner
flips a row (steps below). The US path is byte-identical (`npm run test:ebaygolden`, fixtures untouched).

### What exists now
- **Fees, sourced** (`src/lib/marketplaces.ts`, URL + fetched date beside each row; table below).
- **Price** (`src/lib/localPricing.ts`, `src/lib/server/ebayMarket.ts`): the local ask = the card's USD MARKET value (own
  price_series through the condition and the Quick Sale pick, price guard honoured) x today's rate (`fx.ts`), through
  that site's fee model and whole-unit taper, computed at push time on the server. It never reads `cards.price` (the live
  refresh writes that with US fees) and ignores the price the client sends. A price the seller TYPED (`price_locked`, a USD
  figure in the editors) converts at the rate and is only checked against the local floor. Refused with a plain 409 when the
  rate we hold was fetched >3 days ago or its ECB date is >6 days old, or when there is no trusted market and nothing typed;
  nothing is sent to eBay in those cases.
- **Stored per card** (`cards.ebay_marketplace / list_currency / list_price_local`, written at push and on every reprice):
  `list_price_local` is the authority; `cards.price` becomes its USD equivalent. Reprice, withdraw, offer GETs, the listing
  link, auto-offers and the ended sweep use the card's STORED site, never the seller's current home (proved with the switch
  turned off after publishing).
- **Per-site eBay calls**: `ebayRequestHeaders` (Content-Language + Accept-Language + X-EBAY-C-MARKETPLACE-ID),
  currency in the inventory/offer bodies, policies per marketplace (fulfillment = the site's domestic letter code, flat buyer
  cost, handling 1 day; returns 30 days buyer-pays and NO returnMethods; payment shell; names get a site suffix such as
  "CardFlip shipping GB"), location key `cardflip-<cc>` in the HOME country (never the client's ZIP-prompt country; an
  existing location is reused only when the key or the country matches), "Postcode" prompt outside the US.
- **Fulfillment-policy ladder**: eBay's Account API may or may not want a carrier string on a given site, so the create tries
  letter code + carrier, then letter code alone, then the alternate code (US: Ground Advantage then Priority, as before). The
  sandbox run reports which one eBay accepted.
- **Floors per site** on `api/cards` POST, `api/cards/[id]` PATCH (a card with an offer is held to ITS offer's site),
  `api/ebay/reprice` and `validateDraftInput`. The ledger routes check USD x rate against the local floor; with no rate at
  all they fall back to the US check (saving a price never depends on FX).
- **Off for non-US sellers**: Listing-API drafts refuse cleanly ("Sending a draft to My eBay isn't available for eBay UK
  yet"); `toEbayDraftsCsv` has no UI caller (comment says US only); `repriceNudges` and card price alerts skip rows with a
  stored site; collection totals stay USD.
- **Public collection** shows the local ask ("£4.91") for a live local listing, still counted in USD in the total.
- **Account type**: `refreshEbayIdentityIfMissing` (throttled to one try an hour, never throws, never blocks) fills
  `account_type` / `registration_marketplace` for sellers who connected before increment 1; only sellers whose home is
  CA/GB/IE/AU ever trigger it.
- **Sales + fees** (`ebayOrders.ts`, `ebayFinances.ts`): read `lineItemCost.currency` and the fee currency; a non-USD line
  stores `sold_price_local` + `sold_currency` (new nullable columns) and `sold_price` / `sold_fees` as the USD equivalent at
  the SALE DATE's rate (Frankfurter historical, cached in settings once settled). No rate for that day = the order line is
  DEFERRED (stays listed, not marked applied, `deferred` in the sync result) and the fee stays NULL; both retry next pass.
  A US sale is untouched. Hand-correcting a sold price clears the foreign-currency record.
- **Auto-offers** (Negotiation API) send the card's stored marketplace header and ask eligibility once per site.
- **UI** (`LocalListingLine`, `useLocalMarket`, `usePriceFloor`): editors, the confirm modal and the reprice sheet show
  "£4.91 on eBay UK" with the USD market price underneath (existing `<Price>`), the site's floor and net. A US seller never
  calls `/api/ebay/market`.
- **Sandbox switch**: `EBAY_ENV=sandbox` points the Sell/OAuth/Finances/Identity hosts at `*.sandbox.ebay.com`
  (`src/lib/ebayHosts.ts`); unset = the same production literals (golden). `scripts/ebay-sandbox-e2e.mjs` is the harness.

### Fee table (official pages, fetched 2026-09-30; domestic single card in a bubble mailer, untracked letter)
| Site | Account | Final value fee (Collectable Card Games) | Per order | Postage |
|---|---|---|---|---|
| GB | private | 0%, no regulatory fee — https://www.ebay.co.uk/help/selling/fees-credits-invoices/selling-fees?id=4822 | none | £1.55 Royal Mail 2nd Class Large Letter ≤100g — https://www.royalmail.com/sending/stamp-costs-and-faqs |
| GB | business | 10.9% (Collectables #1) + 0.35% regulatory = 11.25%, ex-VAT — https://www.ebay.co.uk/help/selling/fees-credits-invoices/fees-business-sellers-activated-managed-payments?id=4809 | £0.30 ≤ £10, £0.40 over (since 12 Feb 2026) | same |
| IE | private | 11% + 0.43% regulatory = 11.43%, VAT incl. — https://www.ebay.ie/help/selling/fees-credits-invoices/selling-fees?id=4822 | €0.05 below €10.00, else €0.35 | €3.50 An Post Large Envelope ≤100g (a €1.85 letter is max 5mm) — An Post Guide to Postal Rates Feb 2026 PDF |
| IE | business | 11% + 0.35% = 11.35%, ex-VAT — https://www.ebay.ie/help/selling/fees-credits-invoices/fees-business-sellers-activated-managed-payments?id=4809 | €0.35 ≤ €10, €0.45 over | same |
| AU | INDIVIDUAL (≤ A$25k a year) | 0% — https://www.ebay.com.au/help/selling/fees-credits-invoices/selling-fees?id=4822 | none | A$3.70 Australia Post large letter ≤125g incl. GST (from 1 Sep 2026) — https://auspost.com.au/personal/sending/letters/sending-in-australia/regular |
| AU | BUSINESS (Pro) | 11.44% incl. GST, Tier 2 Pro Starter — https://www.ebay.com.au/help/selling/fees-credits-invoices/ebay-pro-selling-fees?id=4809 | A$0.30, no step | same |
| CA | any | 13.25% (2.35% only above C$7,500) — https://www.ebay.ca/help/selling/fees-credits-invoices/selling-fees?id=4822 | C$0.30 ≤ C$10, C$0.40 over | C$2.61 Lettermail oversize ≤100g, max 20mm, excl. tax — https://www.canadapost-postescanada.ca/cpc/en/personal/sending/letters-mail/postage-rates.page |

Taper (hard-coded whole units, never FX-derived; costs on top below `end`, none from `end` up; the US is $5 / $10):
GB £4 / £8, IE €4 / €10, AU A$8 / A$15, CA C$7 / C$14. All are the US $5 / $10 at ~0.78 / 0.88 / 1.5 / 1.37 rounded to
whole units, except IE's end (10, not 8.8 → 9): €3.50 postage + fees (~€5.5 on top) would exceed a €5 taper and the curve
would dip a cent where it meets the value. Every site's curve is swept by `test:ebaylocal` (never falls as value rises,
never under the value, never over the full-cover price). Non-US rounding also takes a 1e-6 tolerance (float noise on the
no-fee models put exact cents a cent high); the US keeps `Math.ceil` exactly. Floors (break-even, break-even with the fee
model): GB business £2.09, GB private £1.55, AU private A$3.70.

**Still unverified / caveated (listed in each row's `unverifiedNotes`):**
- AU business 11.44% is the Pro Starter column of Tier 2 as read from the page text; the column mapping is inferred (row is
  flagged `unverified: true`). A BUSINESS account under A$25k pays no fee, so its price can be a little high (safe side).
- GB and IE business figures are quoted ex-VAT; a business seller who is not VAT-registered pays 20% / 23% VAT on fees on
  top, which the price does not add. The UK 10p per-order scheme for UK-registered business sellers is not modelled (it
  would only lower the price).
- Cross-border (international) fees are not modelled: domestic letters only.
- `shippingCarrierCode` strings ("RoyalMail", "AustraliaPost", "CanadaPost") are guesses; the policy create retries without
  them. IE has none. The sandbox run settles it.
- GB shipping code: the plan said `UK_RoyalMail2ndClassLargeLetter`, but eBay's own list for the site
  (`docs/ebay-marketplaces-0930.json`) shows `UK_RoyalMail2ndClassLetter` and never the "LargeLetter" name, so the listed code
  is primary and `UK_RoyalMail1stClassLetter` the fallback. Postage stays £1.55 (the Large Letter price).
- **GPSR (IE, EU):** eBay's GPSR page (https://www.ebay.com/sellercenter/resources/general-product-safety-regulation)
  requires business sellers listing in the EU to give the manufacturer or an EU Responsible Person, but excludes antiques
  "including collectors' items". Whether a modern trading card is one is a legal question this code cannot settle, and eBay
  states no rule for CCG singles. The offer has NO regulatory block today; if the IE sandbox publish (or the first real one)
  is refused for it, the Inventory API offer takes a `regulatory` object (manufacturer / responsiblePersons) to add. IE
  returns: 14-day consumer returns are valid on EBAY_IE (the metadata lists 14/30/60); we send 30, buyer pays.
- Sellers' consumer-law returns obligations in UK/IE/AU are the seller's to know; the policy only sets eBay's field.

### Owner steps
**A. Sandbox run (needs your developer-portal clicks; I did not run it).** Full instructions are the comment at the top of
`scripts/ebay-sandbox-e2e.mjs`. In short: (1) create a SANDBOX keyset (App ID + Cert ID) and a sandbox RuName; (2) register
four sandbox SELLER users, one each on United Kingdom, Ireland, Australia, Canada, and complete seller registration if the
sandbox asks; (3) mint a user token per user (User Tokens → Get a Token from eBay via Your Application; scopes sell.inventory,
sell.account, commerce.identity.readonly); (4) in PowerShell set `EBAY_SANDBOX_CLIENT_ID`, `EBAY_SANDBOX_CLIENT_SECRET`,
`EBAY_SANDBOX_USER_TOKEN_GB/_IE/_AU/_CA` (tokens last ~2h; or set `EBAY_SANDBOX_REFRESH_TOKEN_<CC>`) and run
`node --experimental-strip-types --no-warnings scripts/ebay-sandbox-e2e.mjs` (add `--sites GB` for one site, `--print` to see the
payloads with no credentials). It prints PASS/FAIL/SKIP per step with eBay's error verbatim and refuses to touch production.
Fix what it names (typically the service code / carrier string, a missing seller registration, or a GPSR block) in
`src/lib/marketplaces.ts` / `ebayInventory.ts`, re-run until a site is all PASS.
**B. Go-live flip, one site at a time (after that site's sandbox run is all PASS):**
1. In `src/lib/marketplaces.ts` set `live: true` on that one row (GB first) and push to `main` (prod deploys from main).
2. In the admin console → Switches turn **eBay local markets** ON (setting `ebay_local_markets` = "1"). It is global and
   only affects sellers whose home country is a live site's AND whose eBay registration marketplace matches; everyone else
   (and every site still `live:false`) keeps listing on eBay US.
3. List one cheap card as that site's seller, check it on the site's eBay (ebay.co.uk / ebay.ie / ebay.com.au / ebay.ca), reprice
   it, end it. To roll back: set the switch OFF (existing local offers keep working off their stored site), or set the row
   back to `live:false`.
4. Repeat for IE, AU, CA, each in its own push.
Nothing else needs flipping. NZ is deliberately not in the list.

### Known limits (left as is)
- A seller's typed price is a USD number even on a local site; the editors show the local price underneath. Sealed rows
  (priced from the feed, unlocked) are priced by the server from the market series; with no series they need a typed price.
- The publish route still sends `shipFromCountry` "US" by default; a local site ignores it and uses the home country.
- Listings made before a seller moved to a local site (offer on EBAY_US) stay on eBay US; an existing offer cannot change site.
- Sales sync reads orders from every site with the default marketplace header (the Fulfillment API returns the account's
  orders regardless); the first real local sale is where that is confirmed outside the sandbox.

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
