# To test later

Things that shipped but were never exercised on a real phone or with real
traffic. Tick when tested; note what you saw. Newest batch first.

## 10-08 Pokémon hand map (dc9c0337, built by the first cloud session): 10 unpriced cards get a TCGplayer product
- [ ] After the 10-09 5:25am ET Pokémon run: /admin price job result shows no error, and these have a USD series: Mewtwo Star ex13-103, Registeel Star ex12-92, Mudkip Star ex7-107, Deoxys ex pop4-17, Espeon Star pop5-16, Skyridge Gengar H09, Tropical Wind DP05/DP25/DP48, Tropical Tidal Wave np-27. Check /pokemon/mewtwo-card-value shows the Star with a price.

## 10-08 real postage (Chris: "something tells me it's not a flat $5"): Envelope $1.11, Tracked $7.00, envelope only at $20 or less (eBay's rule)
- [ ] Scan editor tiles read Envelope $1.11 / Tracked mailer $7.00; Envelope greys out above $20 (a $20.00 card still allows it, $20.01 does not); the note says "$20 or less".
- [ ] Home page and /pricing fee math say $1.11 postage, not $0.75; a $0.25 card's suggested price is about $1.92 (floor $1.63).
- [ ] A real eBay Standard Envelope label at $1.11 or less buys for a card sold at $20 or under; Ground Advantage label through eBay for a 3 oz mailer lands near $7 (zones 1-5).

## 10-08 Mark as Sold asks once more (c35b831c; Chris: a sold record can't be undone)
- [ ] Inventory, a draft or ended card > Mark as Sold > price > Mark as Sold: the sheet turns into "Are you sure? This marks it sold for $X. It can't be undone." with Cancel (back to the price) and Yes, Mark as Sold. Yes records the sale.
- [ ] Inventory bulk: select live cards > Mark sold (N): the same Are you sure sheet with the count; Cancel leaves them live; Yes marks them sold at asking price.

## 10-08 TikTok caption opener rotation (10b680b3; Chris: no more exact copies of previous posts' text)
- [ ] 10-09 captions.txt (night render ~9:15pm 10-08): the three captions open with three DIFFERENT first lines, each still saying type cardflip.io in your browser; 10-10's 7am opener differs from 10-09's 7am.
- [ ] 10-09 posts with a new library sound each (not Funk it up, not Pokemon Theme Song): views in the first hour back above ~50 like the 7am/1pm posts, no repeat of the 10-08 7pm dead post.

## 10-07 /admin/analytics chart redesign (tiles pick the one big chart)
- [x] (10-08 pane prod 375px: tapping Page views switches the chart to Page views / 154 before and scrolls to it; tooltip tap not tried) Phone: tap each headline tile; the big chart below switches and scrolls into view; tap/drag the chart shows the time, value and "Before".
- [x] (10-08 pane prod: ?from=2026-10-08&to=2026-10-08 → hourly axis 12 AM / 5 AM / 10 AM / 1 PM) Prod, a one-day custom range (both dates today) draws 24 hourly points, not one bar.
- [x] (10-08 pane prod: Visitors tile "38 before" = chart legend "The 1 day before · 38") The faint dotted "before" line matches the "N before" number under each tile.

## 10-08 Publish screen + Public pages blocks (TODAY-10-08.md 11:30 + 11:45) — checked 10-08
- [x] (Chris) Delete-account form warns about live cards. Email change on the Ben account: trial, no Stripe customer, nothing to follow (code updates Stripe on both paths; real proof needs a paid account — parked).
- [x] (pane, prod, 375px) /pokemon/charizard-card-value: title right, Scan → /scan?game=pokemon, tiles → card pages, Start Your Free Trial → /signup, no sideways scroll. Home Yu-Gi-Oh! pill one line.
- [x] (pane) Set with 300+ cards: /cards/magic/commander-masters/page/2 renders 249 cards, pager fine (no set has more than 2 pages at 300 a page, so wrapping never comes up).
- [ ] OPEN: Search page (/app/price-check) on a made-up name says "No cards matched that search." with NO "Card Missing? Tell Us" — the report button only lives in the scanner pick-by-name list and the card editor. Chris to decide whether it belongs on the Search page too.

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
- [x] (10-08 prod HTML: Search icon comes before How It Works) Marketing nav on desktop: the search icon sits left of How It Works (abe7e70c). Phone: first in the second row (Chris 10-08: leave it there for now).

## 10-08 weekly emails rebuilt (/admin/emails), SHIPPED SWITCHED OFF, nothing to users until Chris approves
- [x] (10-08 pane: three sections, 5+3+1 versions each with preview + Send Test To Me, Scans versions show due counts) Prod /admin/emails loads: three sections (Scans · Tuesday 10am, Your cards · Thursday 10am, This week in cards · Sunday 6:30pm), every version has a preview + "Send Test To Me"; the Scans versions show how many people are due.
- [ ] Each "Send Test To Me" lands a [TEST] mail at truefreemoney@gmail.com; check on the phone: pictures load, prices read right, buttons open the right page, Stop link works.
- [x] (10-08 pane: subjects come from live data (Samurott mover; binder/never-scanned versions present); Chris eyeballed the versions 10-08 ~10am) Thursday previews come from live data: "No cards: binder list" shows three Pokémon or Magic cards $15-$200; "Never scanned" shows one card per game.
- [x] (10-08 pane: subject "This week in cards: Magic up, One Piece down" from live data; Chris reviewed 10-08 ~10am) Sunday preview: a line per game, biggest jump, set to watch, sleeper, scans this week (prices tracked since 09-30 note on the three young games is expected).
- [x] (10-08 /admin/system lists the four slots; OFF guard is in the route) Vercel cron list shows /api/cron/emails at 14:00 + 15:00 UTC Tue/Thu and 22:30 + 23:30 UTC Sun; a cron hit while OFF logs nothing and sends nothing.
- [x] (10-08 code: dailyJobs.ts no longer calls digest/campaigns) The old Sunday digest no longer sends from the daily job (Sunday 10-11: only the owner-copy of the week mail, if ON).
## 10-07 signup email typo hint (an ad signup typed @iclod.org and had to sign up twice)
- [x] (10-08 Chris, phone: works) Real phone: type name@gmial.com, tap Password → yellow "Did you mean name@gmail.com?"; tap it → box fixed, hint gone.
- [x] (10-08 covered by test:emailtypo (green)) A correct gmail/icloud address and a @hotmail.co.uk address show no hint.
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
- [x] (10-08 pane mobile emulation: hint is display:none on /scan; real phone still worth a glance) Real phone (iPhone + Android): line does NOT show on either page (checked only in pane emulation).

## 10-07 frozen-price guard (12297c12): cheapest-listing check + dead stale filter fixed
- [x] (10-07 0b35cbad, prod fetch 2:45 PM ET: "This price looks off, check sold listings", no $2,500; the card page never read listing_lows) /cards/pokemon/unseen-forces/lugia-ex--ex10-105 no longer headlines $2,500.00.
- [ ] Scan Lugia ex Unseen Forces 105 on a real phone: shows the "looks off, check sold listings" note, not $2,500.
- [ ] Tomorrow's 09:45 UTC (5:45 AM ET) Pokemon run and 09:00 UTC (5 AM ET) Magic run write listing_lows for today (backfill wrote 2,837 rows on 10-07; readings older than 3 days stop counting).
- [ ] /pokemon/lugia-card-value, /pokemon/charizard-card-value, /pokemon/mewtwo-card-value: no frozen ($100+, flat 45d+) card in the tiles once the 1-day tile cache turns over.

## 10-07 Charizard ad landing page + Skyridge headline fix
- [x] (10-08 pane 375px on prod: passes) /pokemon/charizard-card-value on a real phone: title, Scan button opens /scan with Pokémon picked, card tiles open their price pages.
- [x] (10-07 0b35cbad test 3b, prod fetch 2:45 PM ET: top, Holofoil and Reverse Holofoil rows all "looks off", no price) Skyridge Charizard 146/144 card page no longer headlines $2,999.99 (shows the "looks off" note instead, once its cache turns over).
- [ ] First Google Ads click on the Charizard ad group lands here (admin attribution shows the path).

## 10-07 phone fixes (d852a6c8) — passed in pane at 375 px, real phone not yet
- [x] (10-08 pane 375px: one line) Home game pill: "Yu-Gi-Oh!" never splits across lines.
- [x] (SUPERSEDED 10-08: the Active chip was removed in 09fff364; the status line under the price says it, seen on prod 375px) Inventory > View card: Active chip sits in the Market Price box corner (no own row).
- [x] (10-08 pane prod 375px: Added "Sep 29, 2026" whole on two lines, Change ▼ $0.18 one line) Inventory > View card: Added date not cut off; Change arrow + amount on one line.
- [x] (10-08 local pane: $48.00 = $48.00) Collector mode: Collection Value hero equals Summary Market Value (pane: Magic $111.78 = $111.78).

## 10-07 Google Ads tracking (campaign "Signup Test - Search")
- [ ] First real sign-up from an ad click shows under Google Ads Goals > Sign-up (label HuHPCKCx7JMdELLo2tVE) within ~48 h. Tag AW-18433356850 verified loading on prod 10-07.
- [ ] First Stripe purchase shows under Goals > Purchase (page-load rule on /app/account/welcome?billing=success, fixed 10-07 from the wrong /app/account?billing=success).
- [ ] /admin attribution shows the sign-up as "Google Ads" (utm_source=googleads suffix).

## 10-08 game row
- [ ] Collector mode Inventory: no "Collection value" box above the Market Value line (parked 10-08, Chris). The collection Share picture went with it; Insights page still has its own Share.
- [ ] Game row on Inventory, Set Completion, Packs and /scan (Chris 10-08 "hate the look of the bar"): one line of small chips, no box, scrolls sideways on the phone, a 0 count not printed. Check it on the iPhone in Inventory and on /scan.

## 10-06 new features (audit section G)
- [x] 10-08 PASS iPhone (Chris: "share card feature works"; Android not checked) Phone: Share on a found card opens the share sheet with the picture; falls back to a download elsewhere.
- [x] 10-08 PASS iPhone (Chris: "share works on inventory") Inventory card sheet (tap a card): Share sits in the title bar beside the X and makes the same card picture (Chris 10-08 "inventory card should have a share also"). Not on sealed product.
- [x] (10-08 pane prod 375px: $111.90, ▼ $0.67 over 7 days, three movers, Share button present = Market Value $111.90; the picture itself is a phone check) Collector mode Inventory: value header shows total, 7-day change, top movers; Share makes the collection picture.
- [x] 10-08 PASS iPhone (tips line gone after the first opens; "Keep going for a whole stack" in its place; Got It itself not tapped) Camera tips line shows the first 3 opens, "Got It" hides it for good.
- [x] (10-08 added to the Search page too (49575e22), seen locally; prod report landing in /admin/support still to confirm) Search with no match shows "Card Missing? Tell Us"; the report lands in /admin/support as "Missing Card: …".
- [ ] A card with a pricier twin in the candidates shows "Check the art…" and Switch swaps it.
- [ ] Airplane mode on the phone inside the app shows the No Signal page; push still works after the worker update.
- [ ] Home-screen icon long-press shows Scan and Inventory shortcuts (Android; iOS ignores them).
- [x] (10-07) /cards/pokemon/movers and /cards/magic/movers listed in pages.xml after the sitemap cache turns over.

## 10-06 behind the scenes (audit section F)
- [x] (10-08 ~1:35pm ET: /admin overview shows no backup alert, so the stamp landed) **10-07 FAIL:** backup ran fine but the stamp died on "fetch failed" (not a read-only token). Stamp now retries 4 times (backup-turso.mjs) — recheck 10-08. 10-07 morning: /admin overview no longer says "No database backup on record yet" (tonight's 10:10 PM ET cloud backup should stamp backup_last_ok; if it still shows, the backup repo's Turso token is read-only — the backup log says "could not stamp").
- [ ] TikTok Ads Manager still records ViewContent / ClickButton from /scan after the pixel moved to load after first paint (events queue up to 15 s).
- [ ] Vercel logs: any "?key=" warning means something still sends the cron secret in the URL; once none for a week, drop ?key= support.
- [ ] First Sunday digest after this still sends (prod mail env must be set; not checked).
- [ ] (10-08: not readable from /admin; the daily result keeps logCleanup but no page shows it — needs a settings read; weekly rule = skips when last < 7d) **10-07 FAIL:** log_cleanup_last not set after the 10-07 daily run (4 expired password_resets still there). Daily result now records logCleanup — read daily_last_result 10-08 to see why. Weekly log cleanup ran: settings key log_cleanup_last set after a daily run.

## 10-06 TCGdex price referee (56bb80f)
- [x] (10-07: 192 rows, last day 10-07) After the 10-07 nightly run: tcgdex-cm rows exist (~200 Pokemon cards).
- [x] (10-07: $61.39) Cresselia LV.X (dp4-103) card page shows $61-ish with no "looks off" note.
- [x] (10-07) Rayquaza col1-20 still shows the "looks off" note, not $1,013.
- [x] (10-08 prod Base Set Charizard page: no EUR or € anywhere in the HTML or rendered text) A card page chart shows no extra EUR line from the new source.

## 10-06 look and feel (audit section E)
- [x] 10-08 PASS from Chris iPhone screenshots (Inventory, scanner, /scan: tab bar clear of the home bar; sticky price bar on card pages not checked) Real iPhone: bottom tab bar sits above the home bar, nothing hidden under it.
- [x] (10-08 local pane 375px: End listing confirm is a bottom sheet pinned to the bottom edge with Cancel / End listing; Cancel closes it. Back gesture = real phone only) Confirm pop-up (e.g. bulk delete) slides up as a bottom sheet on phone, Cancel/Confirm both work, Back gesture cancels.
- [x] 10-08 PASS iPhone (Chris: swipe closes it) Swipe the sheet handle down closes the card peek on the home page.
- [ ] (Chris 10-08 7:02pm "good enough for now": third fix f3d54a0c shipped, NOT retested on the phone; check it in passing next time a card peek is opened.) (10-08 THIRD round: after e4fd6830 both X and drag jumped to the TOP, because the fresh scrollY read was 0 for a beat on iOS; now the scroll lock records the offset it restored and both the unlock and the history pop pin that value over 300 ms with scrollRestoration manual. Retest X AND drag.) (10-08 retest: X fixed, handle drag still jumped; second fix turns history.scrollRestoration to manual for the pop and re-applies the offset over 300 ms; retest the DRAG) Home page card peek: closing it (X or swipe) leaves the page where it was, not at the bottom (Chris 10-08 iPhone: "shoots me to the bottom of the page"; the sheet's history pop let Safari restore a scroll position saved while the body was pinned; useBackToClose now re-applies the real offset on that popstate).
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
- [x] (Chris 10-08 Inventory 2) Removing a card while it's still saving leaves nothing behind in Inventory.

### Inventory
- [ ] Opens on a game that has cards when the last-used game has none.
- [x] (Chris 10-08 Inventory 2) Empty game says "No <game> cards yet" (not "Nothing matches").
- [ ] Load failure shows Retry (Sales Report and Set Completion too).
- [x] (Chris 10-08 Inventory 2) Set Completion: cards already on the watchlist show "Watching".
- [x] (Chris 10-08 Inventory 2) Sold tile shows the same net as the sticker.
- [x] (Chris 10-08 Inventory 2) Bulk delete with live/sold cards selected says how many were left alone.
- [x] (10-08 code: collection page sorts by shownPrice × copies (sold row = 1)) Price sort orders by price × quantity.
- [x] (10-08 code: AppTabs marks Inventory active for any /app/collection/* path; Insights, Report and Sets all live there) Inventory tab stays highlighted on Insights / Report / Sets.

### Public pages
- [x] (10-07: Holofoil row shows the note with no price) Skyridge Charizard page no longer shows a price beside "this price looks off" (was still the cached page at 11:40 AM ET 10-06).
- [x] (10-07) Cavern of Souls ($10,000, stale) gone from Magic top cards.
- [ ] Yu-Gi-Oh / Lorcana / One Piece $1,000+ cards appear in top lists from ~10-14 (14 days of history).
- [ ] Friendly "Something went wrong" page on a crash (can't force one on prod; check if one ever shows up in /admin/errors).
- [x] (10-07 0b35cbad + d90a8315, prod fetch 2:50 PM ET: header "Preorder · out Nov 2026", About "out Nov 13, 2026", table "Out") Star Trek (Magic) card pages show "Preorder · out Nov 2026", not "released".
- [ ] (10-08 code: the server renders the start screen and a 0 ms timer after hydration swaps to the used screen, so any flash is one paint; phone check still the proof) /scan doesn't flash the camera button for someone who already used the free scan.

### eBay (needs a real listing / sale)
- [x] (SUPERSEDED 10-08: shipping pick + free shipping replaced this line) Publish screen shows "$4.99 flat shipping, 30-day returns" line; on a UK/IE/AU/CA account the amount is that site's.
- [x] (10-08: only shows on a needs_policies failure; Chris's account has policies, so never seen; link target is the seller's site domain in code) "Set up policies" link opens the seller's own eBay site.
- [x] (10-08 code: ebaySell.ts treats an offer already PUBLISHED as live and records it instead of re-publishing) Publishing a card that's already live on eBay marks it listed instead of erroring.
- [x] (10-08 code: publishDraft holds a per-card lock; the second tap gets 409 "already being published"; covered by test:ebaysell) Two quick Publish taps make one listing.
- [ ] A real sale is recorded once (two tabs open at the time of sync).
- [ ] Seller with 26+ live listings: an eBay-side end on listing #26+ shows up in Inventory.
- [ ] Reconnect warning shows 30 days before the eBay link expires (first ones ~2028).
- [x] (10-08 local pane 375px, trial account: Unlock Selling in the scan editor after verify, Unlock Selling → on the open Inventory card; both go to /pricing) Trial user sees "Unlock Selling" on the scan page editor AND in Inventory (was "Booster or Plan to Sell", Chris 10-08); both go to /pricing.

### Account / billing
- [x] (10-08 code: both paths call updateCustomerEmail; Ben account has no Stripe customer so nothing to see; real proof needs a paid account) Changing email (both ways: Account page and code-confirmed) updates the email on the Stripe customer.
- [x] (Chris 10-08) Delete-account form warns "You have N cards live on eBay".
- [x] (prod 10-06) Invite a friend hidden everywhere; /app/rewards goes to Account. (checked on prod 10-06)

### Ad funnel (needs a logged-out phone, ideally inside TikTok)
- [ ] TikTok Events Manager shows ViewContent and ClickButton events from /scan.
- [x] 10-08 PASS (Chris iPhone, Okidogi $0.15): pinned "Your card is waiting" bar, own photo next to the price, nothing behind the home bar.
- [x] 10-08 PASS: coming back shows "Your Okidogi is worth $0.15".
- [x] 10-08 PASS (Chris iPhone, "scanner works") Free scan on /scan: after Capture the camera stays open with the IDENTIFYING sweep, then the MATCH FOUND chip (chime, price counting up) for ~1.6 s, then the result page. A miss still leaves the camera and says why on the page.
- [x] 10-08 PASS (Maractus Black Bolt 093 rescanned, $6.81) /scan free price never says "No trusted market price" for a card whose series holds a price (10-08 Maractus Black Bolt 093 showed it while prod held $6.81): search-card name path now falls back to the held price, and the result page re-reads by id once. Scan the Maractus again on /scan and expect $6.81.
- [ ] Miss / busy panels show the sign-up link.
- [x] (10-08 prod HTML: Magic placeholder + game=magic) /scan?game=magic opens the scanner on Magic.
- [x] (Chris 10-08 5:39pm iPhone private tab: Charizard ex $39.42 on Pokémon, Sol Ring $38.93 on Magic; "gone once a price shows" not yet seen) /scan logged out on a phone: example card (picture, name, set, price, "Example") under "135,000+ cards"; switches with the game; gone once a price shows.
- [ ] Ad signup (from /scan) skips "How will you use it?", lands in the scanner as Seller.
- [ ] Organic signup still gets the question.
- [ ] Admin funnel shows ad-page signups as landing /scan.
- [x] (10-08 code: signup + Google callback pass the first name to sendSignupWelcomeEmail) Signup with a first name only: welcome email greets them by it.

## 10-06 quality-of-life batch (section D)

### Catalog
- [x] (10-08 pane prod 375px: tap opens the field, Charizard results list with prices, input is 16px so iOS will not zoom) Nav search icon (phone): opens a field, results readable, iPhone doesn't zoom on tap.
- [x] 10-08 PASS after fix (card on the watchlist from the confirm link). (10-08 FAIL on Chris iPhone private tab: signup OK, confirm link opened elsewhere → nothing on the watchlist; the watch lived only in localStorage. Fixed same day: parked on the server at the confirm screen, pending_watches + /api/watch/pending, claimed on the first signed-in page. Retest: private tab → card page → Watch this price → sign up → open the confirm link anywhere → toast "Added to your watchlist", card on /app/wishlist.) Watch this price, signed out: goes to signup, and after signing up the card lands on the watchlist with a toast.
- [x] 10-08 PASS (Chris: third run landed on the watchlist, card added ~2-3 s after landing; "consider this a pass". Speed-up shipped after: the confirm page adds the watch inside its 1.2 s beat, lands on /app/wishlist?watched=1, the page toasts once. Not re-tested.) (10-08 second run: landed on the watchlist, PASS, but the list showed empty although the card was on the account, and the confirm page said "Opening your scanner". Both fixed: the list reloads when the parked watch lands; the confirm line says "Opening your watchlist". Retest once more with a fresh email.) Confirm link after a "Watch this price" signup (no card scanned) lands on /app/wishlist WITH THE CARD SHOWING and the toast, confirm page says "Opening your watchlist". A signup from /scan still lands in the open scanner.
- [x] (10-08 pane prod 375px, owner account: tap → "Watching. See your watchlist", item on /api/wishlist; removed again after) Watch this price, signed in: adds to the watchlist.
- [x] (10-08 pane: Commander Masters page 2 fine; no set has more than 2 pages) A set with 300+ cards: page 2 link works, pager wraps on a phone.
- [x] (10-07: /app/zzz = 404) Mistyped /app/... address shows a 404 (root one is fine; app one only appears for missing cards/pages inside the app).
- [x] (10-07 0b35cbad: the reverse is now hidden too, test 3b) Skyridge Charizard still headlines $2,999.99 "Reverse Holofoil" beside a doubted Holofoil — the 10-06 fix did not change it (needs a look at what the doubted price is).

### Inventory
- [x] (Chris 10-08 Inventory 2) Delete one card → Undo brings it back; delete again and leave the page → it's gone for good.
- [x] (Chris 10-08 Inventory 2) Bulk delete including live cards: those stay, toast says how many.
- [ ] Bulk Set condition / Set price on a few cards (price skips live/sold).
- [ ] 60+ cards: "Show more" appears; Select all says the full count.
- [ ] Duplicates and Missing price chips; Name A–Z and Set sorts.
- [x] (10-08 local pane 375px: no eBay anywhere in Collector Inventory text) Collector mode: Help chips and bulk bar never mention eBay.

### Set Completion
- [x] (10-08 pane prod 375px: Pokémon + Magic list sets; Lorcana/One Piece/Yu-Gi-Oh show the "No <game> sets started yet" empty state — One Piece gap FIXED 10-08: promo/DON ids end in #promo/#don and the variant filter dropped the whole set; now allowed, cache key bumped to v2, test:setcompletion green; prod shows the promo set after deploy) Each of the five games opens and lists sets (Magic first load ~10 s, then cached a day). Magic totals count every printing (borderless etc.) so % looks low — Chris to say if base cards only.

### Scanner (real phone)
- [ ] "Not this card?" on the camera chip: other candidates + search by name; picking one updates name and price, no extra scan charged.
- [ ] Verify all sheet after a stack scan: doubtful ones first; Confirm marks the rest verified in Inventory.
- [ ] Too many scans fast → "wait N seconds" message; daily limit → "try again tomorrow".
- [ ] At 375px the "Not this card?" and Verify buttons fit side by side.

- [ ] Account > Selling > Accept Offers (G10): turn on, push a card, confirm in Seller Hub the listing shows Best Offer with auto-accept 90% / auto-decline 70% of price; reprice and confirm the thresholds moved. Tracked Shipping (G9) only after EBAY_VALUE_SHIPPING=1 is set: card over the threshold shows the tracked postage price.

- [ ] Packs (G8), real phone at 375px: scanner "Open a Pack" > pick game, name, price > scan 3 cards > banner shows pulls and value > Done opens the pack page (cost, value, profit, ROI, best pull, list with art). Share makes a 1080x1920 "My Pack" picture. Inventory > Packs shows past packs and the all-packs ROI. Delete a pack: its cards stay in Inventory.

- 10-07 admin: /admin/analytics second funnel now follows the date range ('Everyone, last 7 days': had an account / scanned / listed / sold in range). /admin/social opens fast from the last saved build and rebuilds stale drafts in the background (check 'Drafts built N min ago' drops on the next visit).
- [ ] (10-10 evening, me) TikTok question-format test: read views/likes of the three 10-09 posts (7am Guess One Piece, 1pm Movers control, 7pm Head to Head Lorcana) into docs/SOCIAL-AUTOPILOT.md results log; decide the 7pm weighting from that.
