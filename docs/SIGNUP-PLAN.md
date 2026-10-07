# Signup plan (10-06, session 122)

Built from 7 research agents: funnel data, /scan walk at 375 px, TikTok/Google
conversion research, ad-vs-landing match, scanner-app competitors, Google SERP
sweep, TikTok competitor creatives.

## What the data says

- 157 TikTok-ad visitors since 10-04 (151 phone). 155 of them have ONE page
  view and nothing else: no tap, no 10-second stay, no camera, no search.
- 0 accounts from ads. The 2 signups since 10-03 are Chris's test network.
- The ad's button says "Sign up" (Lead gen, Complete registration), the page
  asks for a scan first. 12 visits carried an unfilled `__campaign_name__`.
- Most ad viewers have no card in hand, so "Scan" is the hardest first tap.
- Camera inside TikTok's in-app browser is unreliable by nature (three
  permission layers, TikTok owns one). Never gate first value on it.

## What makes CardFlip different (from the competitor sweep)

1. **Scan to eBay listing.** Only Ludex does it: paid tiers only, 50 listings
   cap, US only. Collectr, Ripdex, Eyevo, Rare Candy, TCGplayer: no eBay path.
   We do it at $9.99 with 250 scans, plus GB/IE/AU/CA.
2. **No app, no account.** Every competitor is an app-store install; most
   want signup first. The only web rival (PokeScope) can't scan.
3. **Exact printing.** "Same card, $4 vs $400" is the #1 scanner complaint
   (wrong variant, wrong price). We pick the printing, 1st Edition twins included.
4. **Five games in one scanner.** Only Shiny and Guardian TCG cover them all.
5. **Google:** zero text ads on all 10 test queries (cheap clicks likely).
   "sell pokemon cards on ebay" is served only by guides and Reddit.

## Ranked plan

Shipped 10-06 (bd792981):
- [x] /scan first screen: promise line "No app. No account.", four no-card
      taps right under Scan, stats strip gone, Scan button real at first paint,
      steps say "Sell on eBay, 1 tap".
- [x] Scan Pack renamed Booster everywhere; trial card no longer lists eBay.

Mine, next (no Chris needed), easiest first:
1. [x] Camera outcome steps /scan/cam-live|mirror|native|err-<name> (5e404653).
2. [x] utm attribution already exists (AttributionCapture first touch -> signup);
   only gclid is missing, add with item 3.
   Also shipped 5e404653 (Chris asked): same /scan page signed in or out,
   "Open App" header when signed in, live stats strip back under the steps.
3. [x] Google Ads plumbing c852dfc5, dormant until Vercel has
   NEXT_PUBLIC_GOOGLE_ADS_ID (AW-...) + NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL
   (+ _PURCHASE_LABEL); needs a redeploy after setting (REST redeploy, not an
   empty commit). gclid/gbraid/wbraid -> source "googleads", ttclid -> tiktok.
   Still to do at launch (visible, ask Chris): one privacy-page line naming
   Google Ads; tracking template {lpurl}?utm_source=googleads&utm_campaign={campaignid}.
4. ~~After-fees line on the price result~~: shipped then REVERTED 33eb22f3,
   Chris didn't agree to it. Don't re-add without asking.
5. Search landers for Google (free value first, search box on top):
   /sell-pokemon-cards-on-ebay (scan to listing), /pokemon-card-scanner
   ("no download"), /is-my-pokemon-card-1st-edition (exact printing),
   Lorcana + One Piece scanner pages; per-game headline on /scan?game=.
6. Later: binder-page batch scan (Ripdex's edge).

Chris, one at a time:
A. Stripe Dashboard: rename the product "Scan Pack" to "Booster" (checkout
   page and receipts still say Scan Pack; the code can't change it).
B. TikTok: pause the Lead gen "Sign up" ads. If they run again: Traffic
   objective, "Learn more" button, new creative ("Same card. $4 or $400.
   Which one is yours?" / "Scan it, it's on eBay in 10 seconds").
C. Google Ads: make the account, send the AW- id, $5-10/day for a week on
   "sell pokemon cards on ebay", "pokemon card scanner no download",
   "pokemon card value". Land on the matching lander.
D. Phone test inside TikTok: tap Scan, does the camera open?

## Sources (agent reports)

Ludex List-It https://www.ludex.com/list-it · Ludex plans https://www.ludex.com/membership
Ripdex comparison https://getripdex.com/blog/best-pokemon-card-scanner-apps
Eyevo comparison https://eyevotcg.com/blog/best-pokemon-card-scanner-apps-2026/
PokeScope https://pokescope.app · CardGrader.AI https://cardgrader.ai/pokemon-card-value-checker
Collectr growth https://betakit.com/how-collectr-bootstrapped-a-trading-card-hobby-into-an-eight-figure-business/
TikTok click discrepancies https://ads.tiktok.com/help/article/discrepancies-with-third-party-click-metrics
WebView getUserMedia https://bugs.webkit.org/show_bug.cgi?id=208667
