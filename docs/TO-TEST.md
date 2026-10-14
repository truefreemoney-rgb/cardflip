# To test later
- [ ] After push: /admin/prices 'eBay sold' and a raw card's 'check sold listings' open eBay with '-psa -bgs -cgc -sgc -graded -slab' and no slab titles; a slab item's eBay link still searches its grade (e.g. PSA 9).
- [ ] 10-15: /cards/pokemon/crystal-guardians/charizard--ex14-4 shows $939.50 (hand keep POSTed 10-14 ~2:45pm ET; page copy was still "looks off" right after, cache).
- [ ] Card page "Other printings" strip: on /cards/pokemon/base-set/charizard--base1-4 it lists the page's own card and shows the HIDDEN $968.91 (seen 10-14 ~2:45pm ET). Fix = strip honours hides + skips self; recheck after the fix is pushed.
# To test later

Things that shipped but were never exercised on a real phone or with real
traffic. Tick when tested; note what you saw. Newest batch first.

## 10-14 ~3pm ET: suggested price follows the seller's shipping pick everywhere (LOCAL, NOT PUSHED)
Chris on his phone: Sylveon ex 30th Celebration showed eBay asking $50.26 in the scanner but eBay Suggested Price $55.75 in Inventory ("we can't have mismatch prices"). Cause: the scanner priced the Envelope pick (stamps $1.31), while the Inventory live refresh, alerts, weekly digest, insights, inventory value, reprice nudges and the public collection all called askingPriceFor without the row's shipping_method, so they priced the tracked default ($6.07) and the refresh overwrote the scanner's $50.26. Fix: lib/fees.ts shipMethodOf(row) threaded into all seven + the Inventory cost note. Tests: liveprices (3 new checks), cardalerts, digest, inventoryvalue, profit, publiccollection, pricing green; tsc clean.
- [ ] PROD after the push, phone: Inventory, open the Sylveon ex (Envelope pick): eBay Suggested Price reads $50.26 (same as the scanner's eBay asking) and the note says "$1.31 envelope postage".
- [ ] PROD: a card with NO pick yet over $20 still reads the tracked number (unchanged), under $20 the $0.78 envelope number.
- [ ] PROD: Inventory total / Market value chart (asking basis) still adds up after the refresh (sum of the rows).
## 10-14 ~11am: 22-commit batch (hand calls, eBay slab-free links, flaky test fix, OP SAMPLE re-check) PUSHED d3a938f2 (+ 01aa52f2 test fix)
- [x] PROD: /cards/pokemon lists each Trainer Gallery set ONCE (10-14 10:35am: curl, 0 duplicate set links, 4 TG sets x1).
- [x] CI: main went RED on d3a938f2 (test-social-publish-csrf still sent ?key=, dropped by 84467a80) -> fixed 01aa52f2, CI + smoke green 10:33am. test-campaigns Thursday check passed in the same run.
- [x] PROD: hand-call keep on a card the referee never read returns 200 (0e48b666): 128/128 PriceCharting keeps POSTed 10:30am, all 200; /admin/prices tile "382 called by you", 0 to check.
- [ ] 10-15 2am log: One Piece SAMPLE-stamped pictures re-checked daily (45ee7180), line present.
- [x] PROD: Search "Buy" link excludes slabs (-psa -bgs -cgc -sgc -graded -slab) (10-14 10:40am, /app/price-check "Charizard 4").

## 10-13 ~3pm: every card picture from our storage (PUSHED 83ddd479)
Chris saw blank One Piece hub tiles: the hubs' "most valuable" lists were cached 10-12 7pm ET (before pictures) with optcgapi links, which lists hide. Fixed: 22,946 stale card_cache tile lists deleted on Turso (seo:top/settop/printings/movers/namelist); 3,636 One Piece prod rows still had the optcgapi image_url (10-12 twin-first change was local only) -> copied from local; code (ee70b040): set completion, Magic big picture (scanner tiebreak keeps Scryfall via mtgReferenceImage), homepage featured card + wall, scan stage cards, email movers; 83ddd479: saves (cards, edits, watchlist, price checks) store our copy (ownPictureUrl); 143 old prod user rows rewritten to cardflip.io/pics (12 left: 11 blank no-id rows, 1 Japanese card). Dev: hubs, homepage, /scan, movers = 0 outside pictures, 0 blank; 100/100 tests.
- [ ] PROD after the build: /cards/one-piece, /cards/pokemon, /cards/lorcana: 12 of 12 tiles show, all src cardflip.io/pics (curl count of outside hosts = 0).
- [ ] PROD: homepage hero card + wall + games strip all /pics.
- [ ] PROD: Chris's Inventory + Set Completion + Watchlist pictures all load (right-click = cardflip.io/pics).
- [ ] PROD: scan a Magic card: the tiebreak still identifies (now reads mtgReferenceImage).
- [ ] Open: One Piece top tiles are SAMPLE-stamped alt-art scans (TCGplayer has nothing cleaner); retry for clean scans in the auto new-cards job.

## 10-13: nightly eBay referee + /admin/prices "Price checks" (LOCAL, NOT PUSHED)
Chris 10-13: "make the daily price check against eBay automatic". Every $100+ printing (4,550 on 10-13: Magic 1,801, Pokemon 1,527, YGO 640, One Piece 424, Lorcana 158) is read against eBay's ACTIVE fixed-price listings (Browse API; sold data is denied) up to 900 calls a night, 8:15am + 8:45am ET (cron /api/cron/ebay-referee, 12:15 + 12:45 UTC). lib/ebayReferee.ts = printing-aware matcher + rule (hide at 1.5x the upper NM asks with 3+ asks; vintage pre-2010 needs 3x; 100x one ask); table ebay_asks; priceTrust test 0 (admin call) + 1b (eBay high). Prize sets, unknown rare tags, One Piece special versions and Lorcana/OP promo sets are never auto-hidden (>= $2,000 they go to the hand-check list). Calibrated on 58 eBay-SOLD-checked cards: 4 of 17 bad caught, 0 of 27 good hidden. Local run (366 read, 500 calls, 85 s): 13 hidden (Genex Axel $213,589, Bujingi Crane $199,379, Green Baboon $194,450, Tower of Babel $5,020, foil Llanowar Elves $954 ...), 91 to hand check. Pane: /admin/prices renders desktop + phone (folds, no side scroll); "Right, keep" moved Mewtwo Star to Your calls and the guard showed it; Undo put it back.
- [ ] PROD after the push: Vercel cron list shows /api/cron/ebay-referee twice; the next morning /admin/prices says "Last run ... read" with ~400-450 cards and ~900 calls, 0 failed.
- [ ] PROD: the /admin Overview "eBay API limits today" tile stays under the Browse cap (referee 900 + comps).
- [ ] PROD: a hidden card (e.g. search "Genex Ally Axel" Starstrike Blast) shows "This price looks off, check sold listings", not $213,589.
- [ ] PROD: on the phone, /admin/prices > Hand check: tap "eBay sold" (opens sold listings), then "Right, keep" or "Wrong, hide" on one row; it moves to Your calls; Undo returns it.
- [ ] After a week: every $100+ card has a reading (counts line: fine + check + hidden + not on eBay ~ 4,500).

## 10-12 night: marketing nav hydration error fixed (LOCAL, NOT PUSHED)
Since 10-08 the nav read the signed-in hint from localStorage while rendering, so for a signed-in visitor the server HTML said "Log In" and the browser's first paint said "Log out": React threw a hydration error on every marketing page and rebuilt the page in the browser (slower first paint, console error; new prod errors in OPEN-TESTS E #73 may include it). Now read through useSyncExternalStore with a server snapshot of false. Pane 10-12: fresh tab, signed in, card page: no console errors, nav shows Log out at once.
- [ ] PROD after the push, signed in on the phone: open cardflip.io and a /cards page: nav shows Log out + Open the App with no flash of Log In; error digest shows no new "Hydration failed" lines.

## 10-12 ~11:20pm: card pictures served from cardflip.io/pics + hotlink firewall rule (LOCAL, NOT PUSHED; rule is on Vercel in LOG mode)
Chris: "put in some safeguard so people cant use images hosted on our website". lib/pics.ts toPics() at the 4 readers, next.config rewrite /pics/* → Blob cards/, proxy.ts skips pics/, vision + ogArt fetch the store directly (fromPics). Local proof: Charizard 1st Ed page 19 of 19 card pictures on /pics, 200 image/webp, storage address 0 times in the HTML. Firewall rule "Card pictures: other sites' hotlinks" (Referer present and not cardflip.io/google/bing/ddg/yahoo/ebay/pinterest/facebook) added via API, action LOG.
- [ ] PROD after the push: a card page's pictures come from https://cardflip.io/pics/..., and view-source shows no "blob.vercel-storage.com/cards".
- [ ] PROD: `curl -I -H "Referer: https://example.com/" https://cardflip.io/pics/<a tile path>` → shows in Vercel Firewall as a LOG hit for the rule; `curl -I` with no Referer → 200 and no hit.
- [ ] After ~1 day of LOG with no false hits (our own pages, Google Images, eBay): switch the hotlink rule to DENY.
- [x] Rate-limit rule ADDED 10-13 ~8:45am ET (Chris yes after the price check: $0.50 per 1M allowed /pics requests, us ~75k/month = ~$0.04): "Card pictures: bulk download rate limit", path pre /pics/, fixed window 60 s, 600 per IP, deny for 10 min (scripts/_fw-ratelimit.mjs, untracked). Read back active via the API.
- [ ] 10-14: game hub "most valuable" tiles and card-page "Other printings" strips still showed outside links (lorcast) on 10-13 after the push: they are 24 h DB-cached tile lists (cardPages cachedTiles, TOP_TTL_MS = 1 day) built before the deploy. Confirm they switched to /pics (curl /cards/lorcana and a Lorcana card page, count "lorcast").
- [ ] Scan a Pokémon card on prod: the picture tiebreak still identifies (it fetches our copy straight from the store via fromPics).
- [ ] A social/share picture (Share card) renders card art (ogArt fetches via fromPics).

## 10-12 late night: One Piece + Pokémon pictures self-hosted (LOCAL, NOT PUSHED; runs done on Blob + Turso)
One Piece 5,546 of 5,549 (3 have no picture anywhere, BACKLOG), 4,249 sourced from TCGplayer per Chris. Pokémon 22,315 of 22,315 (TCGdex high.webp; en_cards own_* columns; scanner + card/list pages read them). Local = Turso for both. Local proof: /cards/pokemon 24 of ours, 0 tcgdex; 1st Ed Charizard page 42 of ours, 0 tcgdex.
- [ ] PROD after the push: cardflip.io/cards/onepiece, open a set: tiles now SHOW (the optcgapi list-page block no longer applies, our copies are on our store) and right-click → ...blob.vercel-storage.com/cards/onepiece/...-tile.webp.
- [ ] PROD: cardflip.io/cards/pokemon → a set → a card page: picture from ...blob.vercel-storage.com/cards/pokemon/, sharp.
- [ ] PROD: scan any Pokémon card: candidate thumbnails load (now our store); identification unchanged.
- [ ] PROD: /app/collection sets page set logos still show (derived from en_cards.image_url, untouched).

## 10-12 night: Lorcana pictures self-hosted (LOCAL, NOT PUSHED; the run itself IS live on Blob + Turso)
Chris 10-12: "find card, save to our database and everything pulls from there." scripts/save-pictures.mjs --game lorcana --prod saved every Lorcana picture (3,469) to our Blob as cards/lorcana/<id>-<hash>.webp (500px page copy ~47 KB) + -tile.webp (240px ~15 KB) and wrote own_image_url / own_tile_url / own_image_src on the rows, local and Turso. Readers (tcgCards.ts, cardPages.ts, movers) prefer own_* and fall back to image_url; set-rank list cache bumped to v4 so lists switch at deploy. Nothing on the live site changes until this code is pushed.
- [ ] PROD after the push: cardflip.io/cards/lorcana, open a set, right-click a tile → the picture URL is mlwovvakovcpakbr.public.blob.vercel-storage.com/cards/lorcana/...-tile.webp (not cards.lorcast.io); a card page shows the ...webp page copy, sharp, not blurry.
- [ ] PROD: search "Elsa" from the header on a Lorcana page: result thumbnails come from our store too.
- [ ] PROD: Lorcana scanner candidates (scan any Lorcana card): the printing thumbnails load from our store; the scan still identifies the card (tiebreak still reads ref_image_url / image_url, unchanged).
- [ ] Weekly catalog sync (Sunday 10:30): sync:lorcana overwrites image_url but not own_*; a re-run of pictures:save --game lorcana afterwards saves only NEW or changed pictures (count printed on the first line, should be small).

## 10-12 ~3:30pm: Inventory summary postage = each copy's real rate (LOCAL, NOT PUSHED)
Was a flat $0.78 per copy everywhere (a $1,178.52 card read "Postage · 1 × $0.78"). Now salePostage (fees.ts): over $100 tracked $6.07 whatever was picked; otherwise the row's pick at its price (envelope $0.78 up to $20, stamps $1.31 to $100; tracked $6.07); no pick = the label up to $20, tracked above. Same rule in saleNet/saleBreakdown (sales report, CSV), the reprice sheet's "you keep", and the Listed panel. Pane 10-12: $41.12 no pick → "Postage · 1 × $6.07", fees $5.85, You Keep $29.20; hand-sold → "Postage $0.00".
- [x] (10-12 ~3:15pm ET Chris on the tunnel: passed) Tunnel, Seller mode, Inventory summary: the $1,178.52 Pikachu (svp-085) reads "Postage · 1 × $6.07" and You Keep on eBay ≈ $1,015.90 (was $1,021.19).
- [ ] Mixed rates (one card under $20 with Envelope + one over $100): the line is plain "Postage" with the summed total, fees line still adds up to You Keep.
- [ ] Earned ledger after a real eBay sale over $20: postage shows the sold row's pick ($1.31 stamps or $6.07 tracked), the sales report page says the same in its footnote.

## 10-12 afternoon: Inventory Market Value = chart, Sales Report moved to Account (LOCAL, NOT PUSHED)
- [x] (10-12 ~2:45pm ET Chris on the tunnel, screenshots) Tunnel, Collector mode, Inventory: the big Market Value and the Inventory Value chart's last point are the SAME number (was $1,015.89 vs $1,178.52: the chart drew asking prices when it loaded before the Collector switch had saved; the page now sends ?basis= itself).
- [x] (10-12 ~2:45pm ET Chris on the tunnel, screenshots) Switch Seller -> Collector -> Seller on Account, back to Inventory each time: Collector chart says "market" and matches Market Value; Seller chart says "asking".
- [x] (10-12 ~2:45pm ET Chris on the tunnel, screenshots) Inventory summary has no "Sales Report for Taxes" link; Account > Selling has a "Sales report for taxes" row whose Open goes to the report.

## 10-11 night Shipping: envelope up to $100, real eBay prices (LOCAL, NOT PUSHED)
Prices from eBay's own calculator (ebay.com/shp/calc/rates) 10-11 and USPS Notice 123: eBay envelope label $0.78 (1 oz), stamps $0.82 + $0.49 nonmachinable = $1.31, Ground Advantage $6.07 (Miami → Seattle, same at 1 and 3 oz; nearby $5.38). Floor $1.25, a $0.25 card lists at $1.54.
- [x] (10-12 ~2:40pm ET Chris on the tunnel: "looks fine") Tunnel, scan a card under $20: Envelope tile reads "$0.78 · eBay Standard Envelope, tracked"; Tracked mailer "$6.07". (The "$" was missing on these tiles since 10-08, fixed here.)
- [x] (10-12 ~2:40pm ET Chris on the tunnel: "looks fine") Card between $20 and $100 (or type a price in that range): Envelope tile reads "$1.31 · Plain envelope with stamps" (no warning line, Chris 10-11); both tiles clickable.
- [x] (10-12 ~2:40pm ET Chris on the tunnel: "looks fine") Type a price over $100: Envelope greyed out, "Over $100, use a tracked mailer".
- [ ] "How to ship" sheet on a $20-$100 card: stamp steps (Forever stamp plus 49¢, mark shipped in eBay).
- [ ] Before any pick, a card priced over $20 is suggested as Tracked mailer (the no-tracking envelope is never the default).
- [ ] PROD, first real $20.01-$100 envelope publish: eBay accepts the new "CardFlip letter" policy (Standard Shipping, free) — only tested against a fake eBay so far; if eBay refuses it the card lists on the tracked policy.
- Known, not fixed: repricing a live envelope card across $20 keeps its original eBay policy (policy is picked at publish only; true before tonight too).

## 10-11 Sign-in code "Send a New Code" link after the code expires (prod /login, admin account)
- [ ] On cardflip.io/login as truefreemoney, let the 6-digit code expire (or type a wrong one) so the red "didn't match or has expired" box shows, then tap the blue "Send a New Code" link under the code box: a new email arrives and that newest code logs in. Chris 10-11 ~8:30pm ET didn't see a button at first (the link sits small at the end of the "works for 10 minutes" line); if it does nothing on tap, that's a bug. Open question for Chris: make it a full-size button under the red box (visible change, screenshot + yes first).

## 10-11 Every empty scan given back + no category sheet with nothing scanned (9fc403ff, pushed 10-11 night as 5e4d662b)
- [x] 10-11 8:35pm ET, local dev with the real reader, driven from the pane: a drawn floss box read at 10% ("Couldn't read"), scans used went 0 → 1 → 0 after the give-back (POST /api/vision/scan/giveback answered refunded). Same path on prod after the push.
- [x] Tap Done on the camera after only that bad scan: NO "Which category?" sheet. Inventory has no new row. PASSED 10-11 ~8:45pm ET, Chris's phone on the tunnel: floss box = no match, counter stayed 0, Done opened no sheet.
- [ ] Scan a real card, then tap Done: the "Which category?" sheet DOES open as before.
- [ ] Scan a Magic card with Pokémon selected: "That looks like a Magic card" and the scan is given back too.

## 10-11 Game pills centred in the phone header (26e22043, pushed 10-11 night as 5e4d662b)
- [x] PASSED 10-11 ~8:45pm ET (Chris, tunnel). After a scan, on the phone: the Pokémon / Magic / Lorcana / One Piece / Yu-Gi-Oh! row sits centred in the header card, not hugging the left edge; all five still fit on one line on your iPhone.

## 10-11 Faster scans: tiebreak off the critical path, price wait 2.5 s → 1.2 s (PUSHED to main 10-11 ~9:10pm ET as a40dddb4, build ~2 min)
- [ ] Scan a card with two near-identical printings (a Trainer Gallery card like Eevee TG11, or any card with a 1st Edition twin): the card shows within ~3 s instead of waiting on the picture check; if the tiebreak later disagrees, the card swaps and a Check-match line says "the photo looks more like this printing than <set>".
- [ ] Verify a card quickly after it shows: a late tiebreak must NOT change it afterwards (verified wins).
- [ ] Scan 5 cards in a row and time it against yesterday: the "Reading the card" wait feels shorter; prices still appear on the card (held price first, live price fills in).
- [x] /admin log: no new "scan: slow read" warnings beyond what was there before. (closed 10-11 ~10pm ET by Claude: PASSED, last slow-read warning 11:41am ET 10-11, none since the scanner pushes)

## 10-11 No-match scans given back (PUSHED to main 10-11 ~9:10pm ET in a40dddb4)
- [ ] Trial account: scan something that is not a card (a book cover, a receipt) so the queue says "No match found — search by name": the header scan counter does NOT go up (or goes up and comes back within a second), and /app/account shows the same trial count as before.
- [ ] Scan a real card right after: it still counts (the counter rises by one and stays).
- [ ] A token or an art card (Magic) says "not accepted" and DOES still count (that is a refusal, not a miss).
- [x] /admin > the user's row after a no-match scan: trial scans used did not rise; scan_usage keeps the row with refunded_at set (the vision bill is still real money). (closed 10-11 ~10pm ET by Claude: PASSED, prod scan_usage keeps both 10-11 7:50pm no-match rows with refunded_at set, draw trial:1)

## 10-11 Scanner post-scan header (9665f726, PUSHED to main 10-11 ~9:10pm ET in a40dddb4)
- [x] (10-12 ~2:45pm ET Chris on the tunnel: "fine") Phone, after a scan: the header card has no Seller · Collector switch; Add Cards and Inventory → are two equal-width pills on one row; Inventory → opens Inventory.
- [x] (10-12 ~2:45pm ET Chris on the tunnel: "fine") Phone: "1 card · $0.85" and "1 ready · 0 live · 0 pending" sit on one line each, Connect eBay (or Send to eBay) and the X beside them, nothing cut off.
- [x] (10-12 ~2:45pm ET Chris on the tunnel: "fine") Pre-scan screen, Account and Inventory still show Seller · Collector; the tour "Your switch" step still lands on it.

## 10-08 Pokémon hand map (dc9c0337, built by the first cloud session): 10 unpriced cards get a TCGplayer product
- [x] After the 10-09 5:25am ET Pokémon run: /admin price job result shows no error, and these have a USD series: Mewtwo Star ex13-103, Registeel Star ex12-92, Mudkip Star ex7-107, Deoxys ex pop4-17, Espeon Star pop5-16, Skyridge Gengar H09, Tropical Wind DP05/DP25/DP48, Tropical Tidal Wave np-27. Check /pokemon/mewtwo-card-value shows the Star with a price. (closed 10-11 ~10pm ET by Claude: DONE, Mewtwo Star ex13-103 and Lotad pl3-SH9 have USD series; the other 9 products are mapped but TCGplayer itself has no price for them (tcgcsv checked), nothing to fix our side)

## 10-08 real postage (Chris: "something tells me it's not a flat $5"): Envelope $1.11, Tracked $7.00, envelope only at $20 or less (eBay's rule)
- [x] (SUPERSEDED 10-12: replaced by the 10-11 night block, $0.78 / $1.31 / $6.07, envelope up to $100) Scan editor tiles read Envelope $1.11 / Tracked mailer $7.00; Envelope greys out above $20 (a $20.00 card still allows it, $20.01 does not); the note says "$20 or less".
- [x] Home page and /pricing fee math say $1.11 postage, not $0.75; a $0.25 card's suggested price is about $1.92 (floor $1.63). (closed 10-11 ~10pm ET by Claude: PASSED, prod home x6 and /pricing x4 say $1.11 postage, no $0.75 anywhere; $0.25 -> $1.92 is a CI check in test-card-pages)
- [ ] A real eBay Standard Envelope label at $1.11 or less buys for a card sold at $20 or under; Ground Advantage label through eBay for a 3 oz mailer lands near $7 (zones 1-5).

## 10-08 Mark as Sold asks once more (c35b831c; Chris: a sold record can't be undone)
- [x] (10-11 Chris, phone, new One Tap account: worked on the second scan; the first card had been deleted by an X tap before the save, which the old banner blamed on the connection, fixed bf433106) Inventory, a draft or ended card > Mark as Sold > price > Mark as Sold: the sheet turns into "Are you sure? This marks it sold for $X. It can't be undone." with Cancel (back to the price) and Yes, Mark as Sold. Yes records the sale.
- [ ] Inventory bulk: select live cards > Mark sold (N): the same Are you sure sheet with the count; Cancel leaves them live; Yes marks them sold at asking price.

## 10-08 TikTok caption opener rotation (10b680b3; Chris: no more exact copies of previous posts' text)
- [x] 10-09 captions.txt (night render ~9:15pm 10-08): the three captions open with three DIFFERENT first lines, each still saying type cardflip.io in your browser; 10-10's 7am opener differs from 10-09's 7am. (closed 10-11 ~10pm ET by Claude: PASSED, 10-09 and 10-10 captions.txt: six different openers, each says type cardflip.io in your browser)
- [x] 10-09 posts with a new library sound each (not Funk it up, not Pokemon Theme Song): views in the first hour back above ~50 like the 7am/1pm posts, no repeat of the 10-08 7pm dead post. (closed 10-11 ~10pm ET by Claude: PASSED, TikTok Studio: every post since 10-09 7pm got 116-296 views, no dead post)

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
- [x] Scan editor on the phone: "Shipping · pick one to post on eBay" with two tiles (Envelope $0.75 / Tracked mailer $5.00); Envelope greys out at a $100+ sale price; "? How to ship" opens the two-way sheet. (closed 10-11 ~10pm ET by Claude: OUTDATED, the $0.75/$5.00 tiles and $100 rule were replaced by $1.11/$7.00 and $20, see the real-postage block)
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
- [x] Next 7am post: open the live X, Facebook and Bluesky posts — 5 to 7 tags, each a working link (Bluesky = facets), caption still reads OK. (closed 10-11 ~10pm ET by Claude: PASSED for X (7/7/6 tags on the three 10-11 posts) and Bluesky (7 tag facets on the last six); Facebook not read)
- [x] X (257 chars) and Bluesky (300): tags are never cut below 5 on a long caption; if they are, raise fitText's floor. (closed 10-11 ~10pm ET by Claude: PASSED, Bluesky posts at 280-291 chars still carry 7 tags, X 6-7)

## 10-07 "Start Your Free Trial" button on /pokemon/<name>-card-value pages
- [ ] Real phone: button sits under "Scan Your X Card Free", tap lands on /signup.
- [x] Google Ads: signups from name pages show up in the 10-08 review. (closed 10-11 ~10pm ET by Claude: PASSED, 4 signups landed on /pokemon/charizard-card-value on 10-08)

## 10-07 "Works best on your phone" line on /scan and /app scanner
- [x] (10-07: on prod /scan; /app not checked) Desktop: line shows under the /scan headline and at the top of the empty /app scanner, one line.
- [x] (10-08 pane mobile emulation: hint is display:none on /scan; real phone still worth a glance) Real phone (iPhone + Android): line does NOT show on either page (checked only in pane emulation).

## 10-07 frozen-price guard (12297c12): cheapest-listing check + dead stale filter fixed
- [x] (10-07 0b35cbad, prod fetch 2:45 PM ET: "This price looks off, check sold listings", no $2,500; the card page never read listing_lows) /cards/pokemon/unseen-forces/lugia-ex--ex10-105 no longer headlines $2,500.00.
- [ ] Scan Lugia ex Unseen Forces 105 on a real phone: shows the "looks off, check sold listings" note, not $2,500.
- [x] Tomorrow's 09:45 UTC (5:45 AM ET) Pokemon run and 09:00 UTC (5 AM ET) Magic run write listing_lows for today (backfill wrote 2,837 rows on 10-07; readings older than 3 days stop counting). (closed 10-11 ~10pm ET by Claude: PASSED, listing_lows written every day 10-08..10-11, today 1,505 Pokemon + 394 Magic rows)
- [x] /pokemon/lugia-card-value, /pokemon/charizard-card-value, /pokemon/mewtwo-card-value: no frozen ($100+, flat 45d+) card in the tiles once the 1-day tile cache turns over. (closed 10-11 ~10pm ET by Claude: PASSED, prod top tiles: Lugia $531, Charizard $939, Mewtwo $824; no $2,500 frozen Lugia)

## 10-07 Charizard ad landing page + Skyridge headline fix
- [x] (10-08 pane 375px on prod: passes) /pokemon/charizard-card-value on a real phone: title, Scan button opens /scan with Pokémon picked, card tiles open their price pages.
- [x] (10-07 0b35cbad test 3b, prod fetch 2:45 PM ET: top, Holofoil and Reverse Holofoil rows all "looks off", no price) Skyridge Charizard 146/144 card page no longer headlines $2,999.99 (shows the "looks off" note instead, once its cache turns over).
- [x] First Google Ads click on the Charizard ad group lands here (admin attribution shows the path). (closed 10-11 ~10pm ET by Claude: PASSED, page_views has a googleads / signup-search visit on /pokemon/charizard-card-value)

## 10-07 phone fixes (d852a6c8) — passed in pane at 375 px, real phone not yet
- [x] (10-08 pane 375px: one line) Home game pill: "Yu-Gi-Oh!" never splits across lines.
- [x] (SUPERSEDED 10-08: the Active chip was removed in 09fff364; the status line under the price says it, seen on prod 375px) Inventory > View card: Active chip sits in the Market Price box corner (no own row).
- [x] (10-08 pane prod 375px: Added "Sep 29, 2026" whole on two lines, Change ▼ $0.18 one line) Inventory > View card: Added date not cut off; Change arrow + amount on one line.
- [x] (10-08 local pane: $48.00 = $48.00) Collector mode: Collection Value hero equals Summary Market Value (pane: Magic $111.78 = $111.78).

## 10-07 Google Ads tracking (campaign "Signup Test - Search")
- [ ] First real sign-up from an ad click shows under Google Ads Goals > Sign-up (label HuHPCKCx7JMdELLo2tVE) within ~48 h. Tag AW-18433356850 verified loading on prod 10-07.
- [ ] First Stripe purchase shows under Goals > Purchase (page-load rule on /app/account/welcome?billing=success, fixed 10-07 from the wrong /app/account?billing=success).
- [x] /admin attribution shows the sign-up as "Google Ads" (utm_source=googleads suffix). (closed 10-11 ~10pm ET by Claude: PASSED, signup_log has googleads signups on 10-07, 10-08, 10-09, 10-11)

## 10-08 game row
- [x] (10-12 ~2:40pm ET Chris on the tunnel, screenshot: no Collection value box) Collector mode Inventory: no "Collection value" box above the Market Value line (parked 10-08, Chris). The collection Share picture went with it; Insights page still has its own Share.
- [x] (10-12 ~2:50pm ET Chris on the tunnel: fine on Inventory + Set Completion; Packs ran 4px past its box border, fixed with GameToggle inCard, measured in the pane at 375px) Game row on Inventory, Set Completion, Packs and /scan (Chris 10-08 "hate the look of the bar"): one line of small chips, no box, scrolls sideways on the phone, a 0 count not printed. Check it on the iPhone in Inventory and on /scan.
- [x] (10-12 ~2:55pm ET Chris on the tunnel: "looks fine now") Packs page on the phone: the game chips row stops at the box border (Yu-Gi-Oh! no longer pokes past it); still scrolls sideways.

## 10-06 new features (audit section G)
- [x] 10-08 PASS iPhone (Chris: "share card feature works"; Android not checked) Phone: Share on a found card opens the share sheet with the picture; falls back to a download elsewhere.
- [x] 10-08 PASS iPhone (Chris: "share works on inventory") Inventory card sheet (tap a card): Share sits in the title bar beside the X and makes the same card picture (Chris 10-08 "inventory card should have a share also"). Not on sealed product.
- [x] (10-08 pane prod 375px: $111.90, ▼ $0.67 over 7 days, three movers, Share button present = Market Value $111.90; the picture itself is a phone check) Collector mode Inventory: value header shows total, 7-day change, top movers; Share makes the collection picture.
- [x] 10-08 PASS iPhone (tips line gone after the first opens; "Keep going for a whole stack" in its place; Got It itself not tapped) Camera tips line shows the first 3 opens, "Got It" hides it for good.
- [x] (10-08 added to the Search page too (49575e22), seen locally; prod report landing in /admin/support still to confirm) Search with no match shows "Card Missing? Tell Us"; the report lands in /admin/support as "Missing Card: …".
- [x] A card with a pricier twin in the candidates shows "Check the art…" and Switch swaps it. (closed 10-11 ~10pm ET by Claude: OUTDATED, b23829db (10-08) removed that banner on purpose; the 10-08 check "no Check the art banner" replaces this)
- [ ] Airplane mode on the phone inside the app shows the No Signal page; push still works after the worker update.
- [ ] Home-screen icon long-press shows Scan and Inventory shortcuts (Android; iOS ignores them).
- [x] (10-07) /cards/pokemon/movers and /cards/magic/movers listed in pages.xml after the sitemap cache turns over.

## 10-06 behind the scenes (audit section F)
- [x] (10-08 ~1:35pm ET: /admin overview shows no backup alert, so the stamp landed) **10-07 FAIL:** backup ran fine but the stamp died on "fetch failed" (not a read-only token). Stamp now retries 4 times (backup-turso.mjs) — recheck 10-08. 10-07 morning: /admin overview no longer says "No database backup on record yet" (tonight's 10:10 PM ET cloud backup should stamp backup_last_ok; if it still shows, the backup repo's Turso token is read-only — the backup log says "could not stamp").
- [ ] TikTok Ads Manager still records ViewContent / ClickButton from /scan after the pixel moved to load after first paint (events queue up to 15 s).
- [ ] Vercel logs: any "?key=" warning means something still sends the cron secret in the URL; once none for a week, drop ?key= support.
- [x] First Sunday digest after this still sends (prod mail env must be set; not checked). (closed 10-11 ~10pm ET by Claude: PASSED, Sunday "week" mail sent to 11 accounts (all made 10-07 or later) 10-11 6:30pm ET + owner copy)
- [x] (10-08: not readable from /admin; the daily result keeps logCleanup but no page shows it — needs a settings read; weekly rule = skips when last < 7d) **10-07 FAIL:** log_cleanup_last not set after the 10-07 daily run (4 expired password_resets still there). Daily result now records logCleanup — read daily_last_result 10-08 to see why. Weekly log cleanup ran: settings key log_cleanup_last set after a daily run. (closed 10-11 ~10pm ET by Claude: PASSED, settings log_cleanup_last = 10-08 9:01am ET; weekly, next run ~10-15)

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
- [x] (10-12 Chris on the tunnel) Opens on a game that has cards when the last-used game has none.
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
- [x] Friendly "Something went wrong" page on a crash (can't force one on prod; check if one ever shows up in /admin/errors). (closed 10-11 ~10pm ET by Claude: MOVED to a fix task: /admin errors show "Page changed from static to dynamic at runtime /cards/magic/..." x6 to 10-09 and "fx: rate refresh failed ... Dynamic server usage" x6 to 10-11)
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
- [ ] (10-10 evening, me) TikTok question-format test: read views/likes of the three 10-09 posts (7am Guess Pokémon, 1pm Movers control, 7pm Head to Head Pokémon) into docs/SOCIAL-AUTOPILOT.md results log; decide the 7pm weighting from that.

- [ ] 10-16 evening: REACH TRIAL REVIEW (2c23d2a4, 10-09). Instagram/Threads/X avg views per post 10-10..10-16 vs the 14-day baseline in docs/SOCIAL-REACH-DEEPDIVE.md (IG 5.7, Threads 18, X 12). First 10-10 7am run: open one IG/Threads/X post, confirm the sign-off is at the bottom above the tags, TikTok/Facebook/Bluesky unchanged. If no lift, revert signOffLast on the three sites.

- [ ] Sign in with X (10-10, me; keys set, live on prod c70f4279, start endpoint and button verified by curl): test on prod: (1) /login shows "Continue with X" right under Continue with Google; (2) /signup shows it too; (3) an X account that shares an email goes straight in and lands on the welcome step (new account made, no code asked); (4) an X account with NO shared email lands on /signup?x=email "One more thing", typing an email and Finish signup sends the confirmation code, and the code lets you in; (5) an X login whose email matches an existing email+password account links to it and logs in (password still works if that email was already confirmed); (6) an account with authenticator (or the admin) is refused with "That account has extra security. Log in with your email and password."; (7) typing an email that already has an account on the no-email step says "That email already has an account. Log in with it instead."; (8) with the keys removed the button is gone.

## 10-11 Google One Tap on public pages (dark on prod until Chris adds https://cardflip.io to Authorized JavaScript origins on the Google client id)
- [x] (10-11 Chris, phone: worked after the eaaaeb23 fix) Phone, signed OUT of CardFlip, signed IN to Google in the browser: open cardflip.io/?onetap=1 (the ?onetap=1 forgets the once-only flag; Chris 10-11 saw nothing because the flag had been set while signed in, fixed same day). Google's "Continue as <name>" sheet appears once. Tap it: new Gmail → "You're in, <first name>" welcome step with the free-scan count; existing Google account → the home page reloads signed in (nav shows the app).
- [ ] Close it with the X, then open /pricing and reload the home page: it never comes back on that device (localStorage cardflip.onetap = done).
- [ ] Signed IN to CardFlip: no prompt on any public page. /app, /admin, /login, /signup: never a prompt (the button pages keep their white Continue with Google button).
- [ ] An admin account's Google identity: tap → lands on /login with "That account has extra security..." and is NOT linked.
- [ ] Android Chrome: the prompt is the FedCM account chooser (browser-styled), not Google's iframe; same behaviour.

**10-12 (s148, local, Chris passed on tunnel) Base Set unstamped pictures + verify count**
- AT PUSH: run `node scripts/sync-first-edition.mjs --prod` (re-photographs 101 plain Base Set cards + purges stamped card_cache answers on Turso). Then on cardflip.io: search Charizard Base Set 4/102 → picture has NO 1st Edition stamp.
- Passed on tunnel: scanner green button counts only unverified scans (4da784ee); category sheet one centered button (eeaa21cf); Inventory/scanner game rows mirror (e50a9198).
- Passed on tunnel 10-12: pack bar counts saved pulls (ebaef239); pack value = market the scanner showed, new cards.scan_market column (97c60b14). AT PUSH: confirm Turso got the scan_market column (app adds it at startup) and a new pack pull on cardflip.io stores it.
- Passed on tunnel 10-12: Magic card under Pokémon = bad scan, not saved, given back (6baaa844); any 504 = Took too long (6eb614a6); bulk verify Confirm removed (d2a3e96c).

## Magic Art Series prices (10-13, commit after push)
- [ ] Morning after the push: the 56 Art Series cards from the 10-13 dry run have a price (e.g. Avatar Eternal Art Series 1-12 ~$0.25-0.84, Marvel Thanos 1c-9c ~$3-4, Avatar Yue 41 ~$11). Query: Art Series unpriced count should drop 87 -> ~31.

## Magic cheapest-listing cap + listing beats Cardmarket (10-13)
- [ ] Morning after the push: daily_last_result mtg.cappedToListing is in the hundreds (not 0, not tens of thousands); mtg step still finishes under the 800 s cap.
- [ ] Magic "This price looks off" count drops from ~837 toward ~83 (rerun the sweep script pattern, s154 scratchpad).
- [ ] Spot-check 3 capped foils on the card page (e.g. Cromat Apocalypse foil ~$57, not $155).

## 10-13 ~2:30pm ET: US tracked = Ground Advantage (USPSParcel), eSE carrier EBAY_SEND
- [ ] First real US publish after the push: the seller's "CardFlip shipping" policy reads USPS Ground Advantage (not Priority), still free (Seller Hub > Business policies).
- [ ] First real envelope (≤$20) publish creates "CardFlip envelope" with eBay Standard Envelope (carrier EBAY_SEND) and the listing shows Free eBay Standard Envelope.


## 10-13 ~3pm ET: nightly new-cards run (PC, 2am ET)
- [ ] 10-14 morning: (LOG PASS 10-14 7:40am ET: done 2:33am, failed: empty, all 5 games 0 failed, 44 YGO stand-ins; /admin/prices tile PASS 8:25am: last run 6 h ago, all steps fine) backups\catalog-sync.log ends with "===== done ... (failed:)" and nothing after failed:; /admin/prices shows "New cards ... last run" ~2am, all steps fine.
- [ ] Yu-Gi-Oh saved pictures intact on Turso after the push (count own_image_url<>'' for yugioh >= 59,969); the 22 new rows got pictures.
- [ ] After the code push: cardmarket_map rows on Turso (yugioh ~28k, lorcana ~2.6k) and the 5:25am tcg-prices run still green.

- [ ] Stand-ins: a new card with no scan shows another printing's picture (own_image_src 'standin:<id>'), and the night its own scan appears it switches (tested on a DB copy 10-13: borrow, keep on retry, replace, stand-in's files kept). /admin/prices lists cards still borrowing 2+ weeks after release.

- [ ] Old Yu-Gi-Oh borrowers retry nightly (sync-yugioh no longer repoints dead links, 10-13): first run already swapped 186 to real TCGplayer scans (99 from the old dead list, sheet checked by eye, all clean BETB scans); 233 still 403 keep their borrowed copy. After tonight /admin/prices Yu-Gi-Oh "borrowing" ~233 and falling over time.


## 10-13 ~7pm ET: Magic euro fill + One Piece reprints (after the push)
- [ ] Next 5am mtg-prices run: cron result shows cardmarketFilled ~400; Black Lotus (Alpha) card page shows a dollar price labeled Cardmarket; /admin/prices eBay check reviews the new $100+ ones over the week.
- [ ] One Piece ST31-36 reprints (e.g. OP12-090_r1 Belo Betty) show their original's price after the 5:25am tcg-prices run.



## 10-13 ~7:45pm ET: Send a New Code button + Verify label (76660b68, after the push)
- [ ] Phone, /login with an emailed code: under the code box a full-width outline 'Send a New Code' button (not a small blue link); tapping it mails a new code. Same on /admin/login.
- [ ] Phone scanner after a scan with 'Not this card?' showing: green button reads 'Verify 1 Scan  $0.85' in full, no 'Ver...' cut.


## 10-13 ~7:45pm ET: scanner match tile + card removal log (after the push)
- [ ] /admin analytics Scanner 'Matched a card' = paid scans not given back / paid scans (tiebreak calls no longer count). Today's 6 scans read ~33% (2 of 6: the 4 refunded by hand count as given back), not 25%.
- [ ] Turso has table card_removals after deploy; remove a test card on prod (one, then a bulk select) -> two rows (how one/bulk) with name, set, status, match_doubt, created_at.


## 10-13 ~7:50pm ET: fx fetch no longer no-store (after the push)
- [ ] Vercel logs / /admin errors for 24 h after the push: no 'fx: rate refresh failed ... Dynamic server usage' and no 'Page changed from static to dynamic at runtime /cards/magic/...'. If the static-to-dynamic one remains, it has a second cause: find it with a local next build.

## 10-14 ~4am ET: code wait, envelope wording, no confidence %, backup fix (not pushed yet)
- [ ] Phone, /login (or /admin/login) with an emailed code: right after the code mails, the button reads 'Send a New Code (60s)' and counts down, greyed out; at 0 it works again. Email-confirm wall on signup counts 60s too.
- [ ] A scan the AI was unsure of: Scanner list and Inventory show 'Verify match' but NO 'low-confidence read (40%)' text anywhere.
- [ ] 'How to ship' on a $20-$100 envelope card, step 3 reads: 'Postage is $1.31 total. Use $1.31 in postage stamps, or hand it in at the post office counter and they'll stamp it for you.'
- [ ] Search: every result tile has a 'Buy on eBay' button under the price, and the opened card has one under Share; both open eBay on Best Match (not cheapest first) for that card. Watchlist's Buy on eBay is Best Match too.
- [ ] Nightly backup (cardflip-backups repo) goes green the night after the push (foreign keys off in the copy; local run 10-14 passed, 552,343 rows).

## 10-14 morning: set pages show under-$1 cards, Buy above Watchlist, duplicate Trainer Galleries gone (not pushed yet)
- [x] (10-14 ~5:30am ET applied on Chris's yes: 18 statements, re-run dry = 0; backup backups/dup-tg-sets-prod-1791970155907.json) RIGHT AFTER THE PUSH (me): `node scripts/drop-duplicate-tg-sets.mjs --prod` (dry run: 1 customer card moved to swsh9tg, 120 en_cards + 144 price_series + 120 tcgplayer_products + 5 listing_lows deleted, 119 saved searches cleared) then the same with `--apply`. Not before the push: live code has no redirect for the old ids yet.
- [ ] (10-14 ~6:30am ET: search PASS, 4 results, TG23 once in swsh9tg. Game page + redirect NOT yet: /cards/pokemon still lists each Trainer Gallery twice and the -brs slug serves the 30 cards; seo:sets:v1/v3:pokemon card_cache rows deleted, the 48 h page copies clear on the NEXT PUSH -> recheck then) PROD: Search "Umbreon VMAX" = 4 results, TG23 once. /cards/pokemon lists each Trainer Gallery once; /cards/pokemon/brilliant-stars-trainer-gallery-brs redirects to /cards/pokemon/brilliant-stars-trainer-gallery; an old swsh9.5tg card link redirects to the swsh9tg page.
- [x] (10-14 curl: Evolving Skies 276 sub-$1 prices, no '1.00 and up' on game/set pages, Surging Sparks Drasna sub-$1 page = noindex, follow) PROD: a set page (e.g. /cards/pokemon/surging-sparks) lists cards down to a few cents; no "$1.00 and up" wording on /cards, the game pages or set pages; a sub-$1 card page still has robots noindex.
- [x] (10-14 2:33pm ET Chris phone, Pikachu 30th 023/128: Buy on eBay + Watch pinned side by side at the bottom) Phone: Search, open a card: Buy on eBay sits ABOVE Add to watchlist.

## 10-14: Search redesign A-F (not pushed yet; Chris tests on the tunnel first)
- [ ] Phone, Search before typing: game pill + big "Name or number" box pinned under the header; My Watchlist swipe row (price now, % since saved, bell when an alert is set, "See all N"); "Open a whole set" tiles with set logos (newest 6). No intro text, no Recent lookups.
- [x] (10-14 2:34pm ET Chris phone, "pikachu": 200 cards, Best match pill, list/grid switch, rows with picture/name/set+number/rarity chip/price/star/Buy, round x in the box) Type a name: a "Search" button shows inside the box until you search, then a round x clears. Results: "N cards", one "Sort" pill, list/grid switch; rows show picture, name, set and number, rarity chip, price, star and Buy.
- [ ] Sort pill opens the Sort & filter panel from the bottom: Card name / Whole set, sort list, rarity chips, "Narrow these results"; "Show N cards" closes it.
- [ ] Tap a star: it turns gold and the card is on the Watchlist; tap again removes it.
- [x] (10-14 2:33pm ET Chris phone: $0.76 in foil colours, Buy on eBay + Watch pinned) Open a card: smaller picture, the market price in foil colours, Buy on eBay + Watch pinned at the bottom while the chart scrolls.
- [ ] 24 cards per page with "Show 24 more"; the commission line sits in small print at the very bottom of the results.
- [ ] Watchlist page: same new search box (game pill + field) inside its panel; adding from a search still works.
- [x] (10-14 2:40pm ET Chris phone: pass, all games) Search, before typing, for EVERY game (switch the game pill): six "Open a whole set" tiles
- [ ] Search before typing: switch the game pill: the My Watchlist row shows ONLY that game's watched cards (Chris 10-14: the Pokémon row stayed put on Magic; fixed locally, not pushed: rows saved without a game count as Pokémon). "See all N" counts that game's cards; a game with none shows the "Tap ☆" line., each with a picture (Pokémon logo when TCGdex has one, else the set's most valuable card art). One Piece (no release dates) shows its top-value sets with "N cards".
- [x] (10-14 2:33pm ET Chris phone) Search, open a card: the card picture is big (about two thirds of the phone width).
- [ ] Watchlist: Total value starts as a one-line bar (tap to open, the arrow folds it again); "Add a card" panel has Hide / Show; both remembered after a reload.
- [ ] Watchlist: Legendary Collection Pikachu 86 shows $1,574.99 "steady" (was "$6.62, down 100%": the Watchlist read a different printing than the one saved).
- [ ] Search: 'All sets' opens a full panel of every set with pictures (newest first; One Piece by value), a 'Find a set' box narrows it, tapping a set opens all its cards.

## 10-14 ~6:30am ET: owner eBay reconnected (link dropped 10-13 10:10pm ET by invalid_grant 'issued to another client', cause unknown)
- [ ] After ~8:30am ET (first token refresh on prod): /api/ebay/status from the pane still connected:true, and /admin/errors has no new 'eBay refresh rejected'. NEVER verify via a local script calling ebayAuth (deletes the link: local key).

## 10-14 ~7am ET: eBay links leave slabs out (Chris: 'any title with PSA is a slab')
- [ ] After push: /admin/prices 'eBay sold' and a raw card's 'check sold listings' open eBay with '-psa -bgs -cgc -sgc -graded -slab' and no slab titles; a slab item's eBay link still searches its grade (e.g. PSA 9).
