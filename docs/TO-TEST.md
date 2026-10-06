# To test later

Things that shipped but were never exercised on a real phone or with real
traffic. Tick when tested; note what you saw. Newest batch first.

## 10-06 new features (audit section G)
- [ ] Phone: Share on a found card opens the share sheet with the picture (iPhone + Android); falls back to a download elsewhere.
- [ ] Collector mode Inventory: value header shows total, 7-day change, top movers; Share makes the collection picture.
- [ ] Camera tips line shows the first 3 opens, "Got It" hides it for good.
- [ ] Search with no match shows "Card Missing? Tell Us"; the report lands in /admin/support as "Missing Card: …".
- [ ] A card with a pricier twin in the candidates shows "Check the art…" and Switch swaps it.
- [ ] Airplane mode on the phone inside the app shows the No Signal page; push still works after the worker update.
- [ ] Home-screen icon long-press shows Scan and Inventory shortcuts (Android; iOS ignores them).
- [ ] /cards/pokemon/movers and /cards/magic/movers listed in pages.xml after the sitemap cache turns over.

## 10-06 behind the scenes (audit section F)
- [ ] 10-07 morning: /admin overview no longer says "No database backup on record yet" (tonight's 10:10 PM ET cloud backup should stamp backup_last_ok; if it still shows, the backup repo's Turso token is read-only — the backup log says "could not stamp").
- [ ] TikTok Ads Manager still records ViewContent / ClickButton from /scan after the pixel moved to load after first paint (events queue up to 15 s).
- [ ] Vercel logs: any "?key=" warning means something still sends the cron secret in the URL; once none for a week, drop ?key= support.
- [ ] First Sunday digest after this still sends (prod mail env must be set; not checked).
- [ ] Weekly log cleanup ran: settings key log_cleanup_last set after a daily run.

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
- [ ] Skyridge Charizard page no longer shows a price beside "this price looks off" (was still the cached page at 11:40 AM ET 10-06).
- [ ] Cavern of Souls ($10,000, stale) gone from Magic top cards.
- [ ] Yu-Gi-Oh / Lorcana / One Piece $1,000+ cards appear in top lists from ~10-14 (14 days of history).
- [ ] Friendly "Something went wrong" page on a crash (can't force one on prod; check if one ever shows up in /admin/errors).
- [ ] Star Trek (Magic) shows "Preorder · out Nov 2026".
- [ ] /scan doesn't flash the camera button for someone who already used the free scan.

### eBay (needs a real listing / sale)
- [ ] Publish screen shows "$4.99 flat shipping, 30-day returns" line; on a UK/IE/AU/CA account the amount is that site's.
- [ ] "Set up policies" link opens the seller's own eBay site.
- [ ] Publishing a card that's already live on eBay marks it listed instead of erroring.
- [ ] Two quick Publish taps make one listing.
- [ ] A real sale is recorded once (two tabs open at the time of sync).
- [ ] Seller with 26+ live listings: an eBay-side end on listing #26+ shows up in Inventory.
- [ ] Reconnect warning shows 30 days before the eBay link expires (first ones ~2028).
- [ ] Trial user sees "Scan Pack or Plan to Sell".

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
- [ ] Mistyped /app/... address shows a 404 (root one is fine; app one only appears for missing cards/pages inside the app).
- [ ] Skyridge Charizard still headlines $2,999.99 "Reverse Holofoil" beside a doubted Holofoil — the 10-06 fix did not change it (needs a look at what the doubted price is).

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
