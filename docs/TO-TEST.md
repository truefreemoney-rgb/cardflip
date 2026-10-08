# To test later

Things that shipped but were never exercised on a real phone or with real
traffic. Tick when tested; note what you saw. Newest batch first.

## 10-07 /admin/analytics chart redesign (tiles pick the one big chart)
- [ ] Phone: tap each headline tile; the big chart below switches and scrolls into view; tap/drag the chart shows the time, value and "Before".
- [ ] Prod, a one-day custom range (both dates today) draws 24 hourly points, not one bar.
- [ ] The faint dotted "before" line matches the "N before" number under each tile.

## 10-08 Inventory 2 block (TODAY-10-08.md 11:10) — Chris 10-08: all 6 pass
- [x] Delete one card → Undo; delete again + leave → gone. Bulk delete keeps the live card, toast counts. Remove while saving → nothing left. Empty game copy. Set Completion "✓ Watching". Sold tile net = sticker.

## 10-08 shipping pick (seller picks Envelope or Tracked mailer before an eBay post)
- [ ] Scan editor on the phone: "Shipping · pick one to post on eBay" with two tiles (Envelope $0.75 / Tracked mailer $5.00); Envelope greys out at a $100+ sale price; "? How to ship" opens the two-way sheet.
- [ ] No pick → the eBay post button shows "🔒 Pick a shipping option to publish"; after a pick the confirm line says free shipping for the buyer, postage already in the price.
- [x] (10-08 Chris: picked envelope, listing shows free shipping) First REAL publish with Envelope picked: eBay accepts the "CardFlip envelope" policy (service code US_eBayStandardEnvelope is unverified); if eBay refuses, the listing should still go out on the tracked policy.
- [ ] Inventory: a live or sold card shows "How to ship it · <pick>" with the 4 steps; "Both ways" opens the sheet.
- [ ] After a real sale: the "Your card sold" push AND an email with the mailing steps land (daily sweep); check the email reads right on the phone.

## 10-08 scanner + inventory fixes from the test day
- [ ] Trial account on its LAST scan: scan it, close the camera → the out-of-scans wall shows right away, no page reload (867a4b69).
- [ ] Inventory with a card open: the round X next to Subscribe Now closes the card and shows the plain list; the Share button sits inside the card panel, not on the footer note (2fe6a947).
- [ ] Scanner result: no "Check the art … Switch" banner on a card with a pricier twin (b23829db).
- [ ] Marketing nav on desktop: the search icon sits left of How It Works (abe7e70c). Phone: first in the second row (Chris 10-08: leave it there for now).

## 10-08 weekly emails rebuilt (/admin/emails), SHIPPED SWITCHED OFF, nothing to users until Chris approves
- [ ] Prod /admin/emails loads: three sections (Scans · Tuesday 10am, Your cards · Thursday 10am, This week in cards · Sunday 6:30pm), every version has a preview + "Send Test To Me"; the Scans versions show how many people are due.
- [ ] Each "Send Test To Me" lands a [TEST] mail at truefreemoney@gmail.com; check on the phone: pictures load, prices read right, buttons open the right page, Stop link works.
- [ ] Thursday previews come from live data: "No cards: binder list" shows three Pokémon or Magic cards $15-$200; "Never scanned" shows one card per game.
- [ ] Sunday preview: a line per game, biggest jump, set to watch, sleeper, scans this week (prices tracked since 09-30 note on the three young games is expected).
- [ ] Vercel cron list shows /api/cron/emails at 14:00 + 15:00 UTC Tue/Thu and 22:30 + 23:30 UTC Sun; a cron hit while OFF logs nothing and sends nothing.
- [ ] The old Sunday digest no longer sends from the daily job (Sunday 10-11: only the owner-copy of the week mail, if ON).
## 10-07 signup email typo hint (an ad signup typed @iclod.org and had to sign up twice)
- [x] (10-08 Chris, phone: works) Real phone: type name@gmial.com, tap Password → yellow "Did you mean name@gmail.com?"; tap it → box fixed, hint gone.
- [ ] A correct gmail/icloud address and a @hotmail.co.uk address show no hint.
- [ ] Fewer "Undelivered Mail Returned to Sender" bounces at support@ from signup welcome emails.

## 10-07 out-of-scans wall: quick-buy box at the top (first ad signup ran out of free scans in an hour)
- [x] (10-08 Chris, phone: "Your 14 cards are saved." + both buttons on the first screen) Real phone, trial account with 0 scans left: "Your N cards are saved." + "Buy 100 Scans · $4.99" + "Subscribe · $9.99/mo" all on the first screen, nothing behind the tab bar.
- [ ] Booster button opens LIVE Stripe checkout for $4.99 (local can't: local Stripe price ids don't match; passed at 375 px in pane otherwise).
- [ ] Subscribe button opens LIVE Stripe checkout for $9.99/mo.
- [ ] /admin: first Booster or plan purchase from an ad signup.

## 10-07 Continue with Google on /signup and /login (dark until GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are on Vercel)
- [x] Before the keys exist: n/a now, keys went live 10-07.
- [x] (10-08 Chris, phone) With keys, real phone, signed out: /signup shows the white "Continue with Google" button at the top, "or", then Username / Email / Password.
- [x] (10-08 Chris, phone: You're in, Chris; events + welcome mail not checked) Sign UP with a Gmail never used here: lands on "You're in, <first name>" with the free-scan count; TikTok + Google Ads each log ONE CompleteRegistration (refresh the page: no second one). Welcome email arrives. Account page shows Password as "Set" (no current-password box).
- [x] (10-08 Chris, phone: straight to /app) Sign IN again with the same Google account from /login: goes straight to /app (or the page you were sent from), NO signup event, no second welcome email.
- [ ] LINK: sign up with email + password first, log out, tap Continue with Google with the same address: same account, same scans and cards, password still works afterwards.
- [x] (10-07: prod callback with error=access_denied → /login?google_error=1; message itself seen in local test only) Cancel on Google's screen: back on the page with "Google sign-in didn't finish. Try again or use email."
- [ ] A Google-only account typing a password on /login sees the "signs in with Google" message; Forgot Password lets it set one.
- [ ] Second Google signup from the same phone/network starts with the free scans already used (same rule as email signup).
- [x] /admin and /admin/login look and behave exactly as before (code email, no Google button). (10-07 prod: no Google button on /admin/login)

## 10-07 signup: "First name" box renamed "Username" (4 of 6 Google Ads visitors left the signup form)
- [x] (10-08 Chris, phone: works) Signed out on a phone: /signup shows Username / Email / Password; empty Username says "Enter a username."
- [ ] /admin/adtest over the next days: Google Ads "Opened the signup page" → "Made an account" rate improves.

## 10-07 7 hashtags on X / Facebook / Bluesky (was 2/2/3); Instagram 5 and Threads 1 are platform limits
- [ ] Next 7am post: open the live X, Facebook and Bluesky posts — 5 to 7 tags, each a working link (Bluesky = facets), caption still reads OK.
- [ ] X (257 chars) and Bluesky (300): tags are never cut below 5 on a long caption; if they are, raise fitText's floor.

## 10-07 "Start Your Free Trial" button on /pokemon/<name>-card-value pages
- [ ] Real phone: button sits under "Scan Your X Card Free", tap lands on /signup.
- [ ] Google Ads: signups from name pages show up in the 10-08 review.

## 10-07 "Works best on your phone" line on /scan and /app scanner
- [x] (10-07: on prod /scan; /app not checked) Desktop: line shows under the /scan headline and at the top of the empty /app scanner, one line.
- [ ] Real phone (iPhone + Android): line does NOT show on either page (checked only in pane emulation).

## 10-07 frozen-price guard (12297c12): cheapest-listing check + dead stale filter fixed
- [x] (10-07 0b35cbad, prod fetch 2:45 PM ET: "This price looks off, check sold listings", no $2,500; the card page never read listing_lows) /cards/pokemon/unseen-forces/lugia-ex--ex10-105 no longer headlines $2,500.00.
- [ ] Scan Lugia ex Unseen Forces 105 on a real phone: shows the "looks off, check sold listings" note, not $2,500.
- [ ] Tomorrow's 09:45 UTC (5:45 AM ET) Pokemon run and 09:00 UTC (5 AM ET) Magic run write listing_lows for today (backfill wrote 2,837 rows on 10-07; readings older than 3 days stop counting).
- [ ] /pokemon/lugia-card-value, /pokemon/charizard-card-value, /pokemon/mewtwo-card-value: no frozen ($100+, flat 45d+) card in the tiles once the 1-day tile cache turns over.

## 10-07 Charizard ad landing page + Skyridge headline fix
- [ ] /pokemon/charizard-card-value on a real phone: title, Scan button opens /scan with Pokémon picked, card tiles open their price pages.
- [x] (10-07 0b35cbad test 3b, prod fetch 2:45 PM ET: top, Holofoil and Reverse Holofoil rows all "looks off", no price) Skyridge Charizard 146/144 card page no longer headlines $2,999.99 (shows the "looks off" note instead, once its cache turns over).
- [ ] First Google Ads click on the Charizard ad group lands here (admin attribution shows the path).

## 10-07 phone fixes (d852a6c8) — passed in pane at 375 px, real phone not yet
- [ ] Home game pill: "Yu-Gi-Oh!" never splits across lines.
- [ ] Inventory > View card: Active chip sits in the Market Price box corner (no own row).
- [ ] Inventory > View card: Added date not cut off; Change arrow + amount on one line.
- [ ] Collector mode: Collection Value hero equals Summary Market Value (pane: Magic $111.78 = $111.78).

## 10-07 Google Ads tracking (campaign "Signup Test - Search")
- [ ] First real sign-up from an ad click shows under Google Ads Goals > Sign-up (label HuHPCKCx7JMdELLo2tVE) within ~48 h. Tag AW-18433356850 verified loading on prod 10-07.
- [ ] First Stripe purchase shows under Goals > Purchase (page-load rule on /app/account/welcome?billing=success, fixed 10-07 from the wrong /app/account?billing=success).
- [ ] /admin attribution shows the sign-up as "Google Ads" (utm_source=googleads suffix).

## 10-06 new features (audit section G)
- [ ] Phone: Share on a found card opens the share sheet with the picture (iPhone + Android); falls back to a download elsewhere.
- [ ] Collector mode Inventory: value header shows total, 7-day change, top movers; Share makes the collection picture.
- [ ] Camera tips line shows the first 3 opens, "Got It" hides it for good.
- [ ] Search with no match shows "Card Missing? Tell Us"; the report lands in /admin/support as "Missing Card: …".
- [ ] A card with a pricier twin in the candidates shows "Check the art…" and Switch swaps it.
- [ ] Airplane mode on the phone inside the app shows the No Signal page; push still works after the worker update.
- [ ] Home-screen icon long-press shows Scan and Inventory shortcuts (Android; iOS ignores them).
- [x] (10-07) /cards/pokemon/movers and /cards/magic/movers listed in pages.xml after the sitemap cache turns over.

## 10-06 behind the scenes (audit section F)
- [ ] **10-07 FAIL:** backup ran fine but the stamp died on "fetch failed" (not a read-only token). Stamp now retries 4 times (backup-turso.mjs) — recheck 10-08. 10-07 morning: /admin overview no longer says "No database backup on record yet" (tonight's 10:10 PM ET cloud backup should stamp backup_last_ok; if it still shows, the backup repo's Turso token is read-only — the backup log says "could not stamp").
- [ ] TikTok Ads Manager still records ViewContent / ClickButton from /scan after the pixel moved to load after first paint (events queue up to 15 s).
- [ ] Vercel logs: any "?key=" warning means something still sends the cron secret in the URL; once none for a week, drop ?key= support.
- [ ] First Sunday digest after this still sends (prod mail env must be set; not checked).
- [ ] **10-07 FAIL:** log_cleanup_last not set after the 10-07 daily run (4 expired password_resets still there). Daily result now records logCleanup — read daily_last_result 10-08 to see why. Weekly log cleanup ran: settings key log_cleanup_last set after a daily run.

## 10-06 TCGdex price referee (56bb80f)
- [x] (10-07: 192 rows, last day 10-07) After the 10-07 nightly run: tcgdex-cm rows exist (~200 Pokemon cards).
- [x] (10-07: $61.39) Cresselia LV.X (dp4-103) card page shows $61-ish with no "looks off" note.
- [x] (10-07) Rayquaza col1-20 still shows the "looks off" note, not $1,013.
- [ ] A card page chart shows no extra EUR line from the new source.

## 10-06 look and feel (audit section E)
- [ ] Real iPhone: bottom tab bar sits above the home bar, nothing hidden under it (footer, toasts, sticky price bar on card pages).
- [ ] Confirm pop-up (e.g. bulk delete) slides up as a bottom sheet on phone, Cancel/Confirm both work, Back gesture cancels.
- [ ] Swipe the sheet handle down closes the card peek on the home page.
- [ ] Loading skeletons show on slow 4G for Inventory, card pages, set pages.
- [ ] Grey text is readable in sunlight (contrast lift on zinc-500/600).
- [ ] Google shows the new home title "Pokémon & Yu-Gi-Oh! Card Scanner and Prices | CardFlip".

## 10-06 audit fixes (docs/AUDIT-2026-10-06.md)

### Scanner (needs a real phone + a real scan)
- [ ] A scan that times out ("Took too long") can be scanned again, and picking the card by name works on that row.
- [ ] No ghost card in Inventory after a "Took too long".
- [ ] A slow server scan says "Took too long — tap Capture again" right away (no ~14 s wait, no "brighter shot" message).
- [ ] Double tap on Capture takes one photo, charges one scan.
- [ ] Trial account using its last free scan mid-session keeps its queue (paywall only on next visit).
- [ ] Out of scans: red note shows inside the camera.
- [ ] Removing a card while it's still saving leaves nothing behind in Inventory.

### Inventory
- [ ] Opens on a game that has cards when the last-used game has none.
- [ ] Empty game says "No <game> cards yet" (not "Nothing matches").
- [ ] Load failure shows Retry (Sales Report and Set Completion too).
- [ ] Set Completion: cards already on the watchlist show "Watching".
- [ ] Sold tile shows the same net as the sticker.
- [ ] Bulk delete with live/sold cards selected says how many were left alone.
- [ ] Price sort orders by price × quantity.
- [ ] Inventory tab stays highlighted on Insights / Report / Sets.

### Public pages
- [x] (10-07: Holofoil row shows the note with no price) Skyridge Charizard page no longer shows a price beside "this price looks off" (was still the cached page at 11:40 AM ET 10-06).
- [x] (10-07) Cavern of Souls ($10,000, stale) gone from Magic top cards.
- [ ] Yu-Gi-Oh / Lorcana / One Piece $1,000+ cards appear in top lists from ~10-14 (14 days of history).
- [ ] Friendly "Something went wrong" page on a crash (can't force one on prod; check if one ever shows up in /admin/errors).
- [x] (10-07 0b35cbad + d90a8315, prod fetch 2:50 PM ET: header "Preorder · out Nov 2026", About "out Nov 13, 2026", table "Out") Star Trek (Magic) card pages show "Preorder · out Nov 2026", not "released".
- [ ] /scan doesn't flash the camera button for someone who already used the free scan.

### eBay (needs a real listing / sale)
- [ ] Publish screen shows "$4.99 flat shipping, 30-day returns" line; on a UK/IE/AU/CA account the amount is that site's.
- [ ] "Set up policies" link opens the seller's own eBay site.
- [ ] Publishing a card that's already live on eBay marks it listed instead of erroring.
- [ ] Two quick Publish taps make one listing.
- [ ] A real sale is recorded once (two tabs open at the time of sync).
- [ ] Seller with 26+ live listings: an eBay-side end on listing #26+ shows up in Inventory.
- [ ] Reconnect warning shows 30 days before the eBay link expires (first ones ~2028).
- [ ] Trial user sees "Unlock Selling" on the scan page editor AND in Inventory (was "Booster or Plan to Sell", Chris 10-08); both go to /pricing.

### Account / billing
- [ ] Changing email (both ways: Account page and code-confirmed) updates the email on the Stripe customer.
- [ ] Delete-account form warns "You have N cards live on eBay".
- [ ] Invite a friend hidden everywhere; /app/rewards goes to Account. (checked on prod 10-06)

### Ad funnel (needs a logged-out phone, ideally inside TikTok)
- [ ] TikTok Events Manager shows ViewContent and ClickButton events from /scan.
- [ ] After a free price: pinned "Your card is waiting" bar, own photo next to the price, nothing hidden behind the bar (iPhone home bar).
- [ ] Coming back after the free scan: "Your <card> is worth $X".
- [ ] Miss / busy panels show the sign-up link.
- [ ] /scan?game=magic opens the scanner on Magic.
- [ ] /scan logged out on a phone: example card (picture, name, set, price, "Example") under "135,000+ cards"; switches with the game; gone once a price shows.
- [ ] Ad signup (from /scan) skips "How will you use it?", lands in the scanner as Seller.
- [ ] Organic signup still gets the question.
- [ ] Admin funnel shows ad-page signups as landing /scan.
- [ ] Signup with a first name only: welcome email greets them by it.

## 10-06 quality-of-life batch (section D)

### Catalog
- [ ] Nav search icon (phone): opens a field, results readable, iPhone doesn't zoom on tap.
- [ ] Watch this price, signed out: goes to signup, and after signing up the card lands on the watchlist with a toast.
- [ ] Watch this price, signed in: adds to the watchlist.
- [ ] A set with 300+ cards: page 2 link works, pager wraps on a phone.
- [x] (10-07: /app/zzz = 404) Mistyped /app/... address shows a 404 (root one is fine; app one only appears for missing cards/pages inside the app).
- [x] (10-07 0b35cbad: the reverse is now hidden too, test 3b) Skyridge Charizard still headlines $2,999.99 "Reverse Holofoil" beside a doubted Holofoil — the 10-06 fix did not change it (needs a look at what the doubted price is).

### Inventory
- [ ] Delete one card → Undo brings it back; delete again and leave the page → it's gone for good.
- [ ] Bulk delete including live cards: those stay, toast says how many.
- [ ] Bulk Set condition / Set price on a few cards (price skips live/sold).
- [ ] 60+ cards: "Show more" appears; Select all says the full count.
- [ ] Duplicates and Missing price chips; Name A–Z and Set sorts.
- [ ] Collector mode: Help chips and bulk bar never mention eBay.

### Set Completion
- [ ] Each of the five games opens and lists sets (Magic first load ~10 s, then cached a day). Magic totals count every printing (borderless etc.) so % looks low — Chris to say if base cards only.

### Scanner (real phone)
- [ ] "Not this card?" on the camera chip: other candidates + search by name; picking one updates name and price, no extra scan charged.
- [ ] Verify all sheet after a stack scan: doubtful ones first; Confirm marks the rest verified in Inventory.
- [ ] Too many scans fast → "wait N seconds" message; daily limit → "try again tomorrow".
- [ ] At 375px the "Not this card?" and Verify buttons fit side by side.

- [ ] Account > Selling > Accept Offers (G10): turn on, push a card, confirm in Seller Hub the listing shows Best Offer with auto-accept 90% / auto-decline 70% of price; reprice and confirm the thresholds moved. Tracked Shipping (G9) only after EBAY_VALUE_SHIPPING=1 is set: card over the threshold shows the tracked postage price.

- [ ] Packs (G8), real phone at 375px: scanner "Open a Pack" > pick game, name, price > scan 3 cards > banner shows pulls and value > Done opens the pack page (cost, value, profit, ROI, best pull, list with art). Share makes a 1080x1920 "My Pack" picture. Inventory > Packs shows past packs and the all-packs ROI. Delete a pack: its cards stay in Inventory.

- 10-07 admin: /admin/analytics second funnel now follows the date range ('Everyone, last 7 days': had an account / scanned / listed / sold in range). /admin/social opens fast from the last saved build and rebuilds stale drafts in the background (check 'Drafts built N min ago' drops on the next visit).
