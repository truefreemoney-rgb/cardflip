# To test later

Things that shipped but were never exercised on a real phone or with real
traffic. Tick when tested; note what you saw. Newest batch first.

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
