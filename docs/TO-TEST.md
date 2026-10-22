# To test later

## 10-22 12:15PM ET: eBay comps know the printing (COMMIT ONLY 5d30fb0a; nothing visible by design)
- The scan page and the card editor now tell /api/ebay/comps which printing is being quoted (reverse holo, Poke Ball / Master Ball pattern, Magic foil); the Browse search adds its words, the title filter requires them, the day cache keys on it (prefix ebaycomps:v2 = one day of misses after the push, then one call per card+printing per day).
- [ ] After push, phone: scan a reverse holo (or a Poke Ball pattern) card -> the "eBay sellers asking" chip, if it shows, is in the printing's own range, and "Check on eBay" opens a search whose words include "reverse holo" / "poke ball".
- [ ] After push, pane (signed in): POST /api/ebay/comps with {card: <a card with a reverseHolofoil row>, variant: "reverseHolofoil"} -> searchUrl contains reverse+holo; the same with variant: "zzz" -> searchUrl without it (treated as any printing), no 500.
- [ ] After push, next day: card_cache rows with key LIKE 'ebaycomps:v2:%' exist and the old v1 rows age out with the 24 h sweep (no growth beyond one row per card+grade+edition+printing).

## 10-22 8:35AM ET: review-backlog batches 3 + 4 (COMMIT ONLY 384126ec, e9f19a47 docs, 8f94890d; nothing visible by design)
- Batch 3: apiFailure() for the cards / card / wishlist / price-checks / live-prices routes (JSON 401 or 500, never HTML); nav search reads the public game list from GET /api/catalog/games (revalidate 300); set card lists cached per set (seo:setcards:v1, 1 day); set standings use cardStory's median; admin Social* fetches via apiFetch (timeout); AdminNav re-syncs its group; scan_usage read JSON keeps the first read's pattern verdict (first) and the look's ball (lookBall). Batch 4: back-to-close stack (Done on "This copy" cannot close the camera; test:backstack 12); out of scans = Capture opens the paywall, no photo; fetchCurrentUser answer reused 2 s.
- [ ] After push, phone: scan a card, open the "Near Mint · Holofoil" pill (This copy), tap Done -> back on the camera, NOT the category sheet or the listing page. Android Back from an open sheet closes the sheet only; a second Back closes the camera.
- [ ] After push, phone with 0 scans left (trial account or Chris's gift set to 0): Capture goes to /pricing with no photo taken and no spinner left behind; Back from /pricing returns to the app, not a dead camera.
- [ ] After push: /pricing network tab shows ONE /api/auth/me call (was up to 7).
- [ ] After push: GET https://cardflip.io/api/catalog/games = JSON list of the public games; the nav search dropdown on / and /features lists the same games as /cards.
- [ ] After push: /api/cards without a session -> JSON {"error":"Not signed in"} 401 (not HTML); a bad body on /api/wishlist -> JSON 400/500, never an HTML page.
- [ ] After push, next scans: scan_usage read JSON has first + lookBall keys on rows where a pattern look ran (scripts/_scan-usage-peek.mjs); Chris's next Eevee 074 scan can then be measured.
- [ ] After push: /cards/pokemon/base-set?page=2 is served from the set cache (second request fast; x-vercel-cache HIT on the page itself).

## 10-22 8:30AM ET: pane checks with Chris's sign-in (admin console + app account, reads only)
- [x] /admin/prices: no "checks recorded" list exists on that page (the 10-22 6:59am line assumed one); the 28 checks show on their card pages as "Checked against recent sales" (Raikou SL9 + Copycat sit in the Hand check list as referee rows, which is right). Readers flagged = 1 (Venusaur base-set $136.30 "too high", read by me 10-21: stands). Last run line = last night's 2,026 read / 3,054 calls (the budget trap, see 7:50am).
- [x] /admin overview: Help chat tile "read the chats" -> /admin/robot, 0 "ET ET"; /admin/robot renders (0 chats in 7 days, nothing to expand).
- [x] /admin/emails: one "sent" per person per mail: week Oct 18 = 22 sent / 22 people, cards Oct 15 = 17/17, scans Oct 20 = 24/24, scans Oct 13 = 5/5 (no repeats). The 9 preview iframes still load eagerly (admin #17, parked).
- [x] /app/collection at 375px: chips Duplicates (24 of 45) + Missing Price present and pressable; sorts Newest / Price / Rarity / Name A-Z / Set / Recently sold present; 45 cards so "Show more" + Select all count wait for 60+ (phone list). Sylveon envelope sheet: the sheet opened but my text probe found no "Suggested Price" line -> still a phone check (TO-TEST 710/711).
- [x] /app/wishlist at 375px: no stale-price note, "Legendary Collection · 86" on one line with an ellipsis, scrollWidth 375.
- [x] /cards/magic at 375px: 400 set links, 0 overflow their box, 398 end in an ellipsis.
- [x] /app/collection/insights: renders at 375px (value $3,477.73, movers); the "Magic headline = chart" check is STALE (no value chart on Insights any more).
- [x] 8:21am: price_history_meta ebay_referee_last unchanged (day 10-22, 2,026 read) = today's 8:15am run skipped on budget as predicted; ebay_referee_2026-10-22 still 3,054.

## 10-22 8:25AM ET: review-backlog batch 2 (COMMIT ONLY ec1a5b6f scanner + cbbd3c71 server/public/auth/app; nothing visible by design)
- SCHEMA on first boot after the push: cards.client_id (nullable) + partial index (user_id, client_id); card_removals index (user_id, how). The fingerprint changes, so the first process on prod runs the schema pass once (a few seconds); the db first-run path now fires only on "no such table".
- [ ] After push: POST /api/cards from a real scan still 201 (Chris's phone scan, or scan_usage + cards rows grow); a second POST with the same clientId returns the same row (no duplicate in /app Inventory after a flaky-network scan).
- [ ] After push: /admin/users still shows Joined / Last active / scans per user (rollups only there now); /admin Overview + System load faster; runner status route answers 200 with RUNNER_TOKEN.
- [ ] After push, pane signed out of /admin: GET /api/admin/users -> 401 JSON; helper session on an owner route -> 403 JSON (was 403 for both).
- [ ] After push: Google One Tap on /pricing still signs in (GET /api/auth/google/onetap sets the nonce cookie first; POST without it = 400 "Bad request.").
- [ ] After push: reset a password on a throwaway (CI covers) -> /login?reset=1 shows "Password changed. Log in with your new password."
- [ ] After push: curl https://cardflip.io/u/<handle> twice -> second is a cache hit (x-vercel-cache HIT within 5 min); /sitemap-pages has no lastmod on /cards.
- [ ] After push: a card page of a set that released yesterday says "Out" on the ET day, not Preorder; /cards/pokemon/most-valuable prints no "# To test later

.00".
- [ ] 5:45am ET write after the push: scripts/_scan-usage-peek.mjs + /admin Insights totals unchanged or higher (every row read now, not the newest 400/600); nightly Sunday digest draft counts match /admin.
- [ ] Phone: Watchlist star on Sets, Price Check, Wishlist search and a card popup still adds once and says "Already watching" on a repeat.
## 10-22 8:15AM ET: review-backlog batches 1-3 (COMMIT ONLY a4e07b86, 4fd890ad, 99f72068, c36f01db; Chris "we are trying to bulk push"; nothing visible)
- Scanner a4e07b86: focus traps keep a stack (only the top sheet handles Tab); blur-note timers cleared on unmount; Verify All + candidate picker carry a Back id; page.tsx dedupes. API 4fd890ad: PATCH condition must be a real condition (40 chars), no negative sold price/date; bulk delete + deleteCards skip live eBay rows; $1M price caps on cards + reprice; price guard clamps young series; comps fence when IQR is 0 (test pin); comps route never 502s on a bad client price; dead in-memory 500/day scan rule gone; billing rate limit keyed by user id; signed-in owner skips /admin/login; switches built from GATED_GAMES. Campaigns 99f72068: send history = last 60 days. c36f01db: /home -> / (301); bot watch cron at :25 AND :55. tsc + eslint clean; test:ebay/pricing/ratelimit/sitetrust/adminroutes/apiauth/cards/campaigns/vision-schema/visionbudget/inputchecks/ebayreferee/ebaybrowse green.
- [ ] After push: curl -I https://cardflip.io/home = 301 to /; Search Console 404 row drops to 1 (/&) on its next crawl.
- [ ] After push: bot-watch runs appear at :25 and :55 (gh run list --workflow=bot-watch.yml), never two at once.
- [ ] After push, phone (desktop keyboard check = pane): open the camera, open Verify All, press Android Back -> the sheet closes, the camera stays.
- [ ] After push, pane signed in: PATCH /api/cards/<id> with {"condition":"Mint-ish"} -> 400; {"soldPrice":-1} -> 400; DELETE on a live eBay row -> 409.
- [ ] After push: /admin/login while signed in -> lands on /admin.
## 10-22 7:45AM ET: eBay referee measures a SELLER FLOOR beside every read (COMMIT ONLY bfb67ab5, not visible; TASKS C1.4 "measure first")
- lib/ebayReferee.ts trustedSeller (under 95% positive or under 20 feedbacks = untrusted; no seller block = kept) + measureSellerFloor; server/ebay.ts searchEbayAsks carries seller {pct, score} from the Browse summary; the nightly run writes sellerFloor {asks, dropped, cardsTouched, flips "from>to", verdicts} into price_history_meta ebay_referee_last. Stored verdicts unchanged. test:ebayreferee +10, test:ebaybrowse +2, tsc + eslint clean.
- [ ] After push, first 8:15am ET referee run: SELECT value FROM price_history_meta WHERE key = 'ebay_referee_last' has a sellerFloor block; dropped > 0 on some rows; note flips (expect a few ok>high / ok>check where shill asks held the median down). Decide with Chris whether to turn it on (then: filter in readOne, not just measure).

## 10-22 7:40AM ET: morning checks that needed no sign-in (read only)
- [x] Vercel billing feed (scripts/_vercel-isr-days.mjs): 10-21 = $1.00 total, ISR Writes $0.49 (122,964; 10-20 was 200,247 / $0.80, 10-19 425,405 / $1.70) = the Wave block from 3pm cut the day roughly in half; 10-22 not in the feed yet.
- [x] Bot watch runs (gh run list): every run green; GitHub ran the hourly schedule at 10-21 6:27pm, 9:36pm, 10-22 12:06am (manual), 3:43am ET and then SKIPPED every slot from 3:43am to 7:40am (GitHub drops busy-hour cron slots). Nothing blocked. If the gaps matter: cron-job.org (TASKS F) can dispatch the workflow on the hour.


## 10-22 7:30AM ET: testing API key rotated (Console mail: cardflip-testing expires 10-29)
- New key cardflip-testing-2 (Testing workspace scope, never expires, linked to Chris) made in the pane with Chris signed in; stored as ANTHROPIC_DEV_API_KEY in .env.testing.local (old file kept as .env.testing.local.bak-1022, both git-ignored); one 5-token Haiku call answered 200. The old key cardflip-testing can be deleted on platform.claude.com/settings/keys or left to expire 10-29.
- [ ] Next accuracy/A-B script run uses the new key without a prompt (scripts/lib/dev-key.mjs).

## 10-22 7:27AM ET: Pokémon listing cap OFF + chart lift day (COMMIT ONLY, not visible by itself; Chris "build the cap rule"; report card §15)
- pokemonPriceRefresh.ts POKEMON_CAP_ON=false; priceOutliers.ts capLiftDay (fromCapBreak + seriesBreakDay start at the lift). test:pricehistory +9, test:sitetrust cap tests rewritten, cardpages/social/digest green, tsc + eslint clean.
- [ ] After push, first 5:45am ET write: scripts/_uncapped-lines.mjs reads 0 lines breaking the cap... (script now moot) -> instead: scripts/_peek-series.mjs --prod on 5 of the 2,039 capped printings (e.g. ex9-41, dp6-12, lc-31, pl1-9, bwp-BW82) = last point at TCGplayer market, a step up of 1.45x+; their card pages: 24h/7d pills read from the lift (no "Up 200%"); /admin/prices "high" count does not explode (the referee reads asks, not the cap).
- [ ] The 28 checked cards keep the checked number (price_checked binds; tcg_usd notes the raw market).
- [ ] 1pm / 7pm posts the day after: no card's "this week" move spans the lift (social reads seriesCapBreak via campaignData).

## 10-22 ~6:59AM ET: 28 of the 106 cap-cut Pokémon prices FIXED on prod with TCGplayer NM-sales checks (report card §14; data write, no code)
- [x] 3:55am curl: Rayquaza C DP47 $999.99, Giratina EX DE 124 $611.98, Rayquaza C SV 8 $399.50 all print with "Checked against recent sales" (invalidated by hand; the other 25 within 48 h).
- [x] 7:40am 10-22 (scripts/_write-1022-check.mjs --prod, read only): all 43 checks dated 10-22 are on and bind after the 5:45am write (the two "off" lines, Raikou SL9 $699 vs $579.99 and Pikachu ex2-73 $500 vs $436.20, are in-band vouches by design: the series stays at TCGplayer's number).
- [x] N/A 10-22 8:30am: /admin/prices has no checks list; the 28 show on their card pages (verified on three by curl).

## 10-22 ~6:52AM ET: the 106 cap-cut cards, measured + two blanks fixed (COMMIT ONLY code: price guard in-band check vouches; prod data: Raikou SL9 check, Typhlosion 1st keep)
- Measured (prod, data/crash-2026-10-19.json): 15 of 106 stepped back up on the 10-22 point (217.50 -> 579.99 Raikou, 231.99 -> 507.49 Typhlosion 1st, ...); the guard's recovery rule waved 13 through; 91 still sit at their cut number (TCGplayer's own figure, nothing to do). The chart + 7d/30d % already start at the cap break (priceHistory.ts fromSeriesBreak), so the 'Down 60-80%' item is closed by code that shipped earlier.
- Blank 1, Raikou SL9 Call of Legends holofoil: TCGplayer NM sales 719 / 699 / 699 (Oct 2-6) -> check recorded on prod at 699 n=3 (scripts/_put-check.mjs --prod). Our 579.99 is inside the 25% band so it STANDS, but the guard only let an exact check vouch -> fixed in priceTrustSite.ts (isOffCheck band), test:sitetrust +3, test:checked / pricetrust / sitetrustroutes green, tsc + eslint clean.
- Blank 2, Typhlosion 1st Ed Neo Genesis 18 (neo1-18-1st): old step from 45 months ago reads as a never-came-back spike; the 10-14 eBay keep at 699.99 stopped binding once TCGplayer moved to 507.49 (10% band). TCGplayer: no 1st Ed NM sales in 80; eBay sold (1 search): one plain BIN NM 899.98, Best Offer sales 400-650, LP 450 -> TCGplayer's 507.49 stands; the keep moved to 507.49 (manual_day 10-22) on prod so it binds again.
- [ ] After push: curl Raikou /cards/pokemon/call-of-legends/raikou--col1-SL9 = $579.99 printed, no 'looks off'. Typhlosion 1st page prints $507.49 now (keep binds; page may be ISR-cached up to 48 h).
- [ ] Nightly 10-23 Pokémon write: the other recovered cards keep their new numbers, none blank (re-run the 15 through scripts/_trust-why.mjs with the Turso env).

## 10-22 ~4-5am ET (clock not read; stamp was a guess): 7am TikTok + Pinterest posted by hand (Rayquaza ex Then vs Now; TikTok sound Littleroot Town after Chris rejected the battle theme)
- [ ] ~2 h after posting: TikTok views (dead-post rule: under ~50 at the 2 h mark = repost with a new sound, pin, log); Pinterest pin visible on Pokemon Card Prices.
- [x] 8:03am 10-22 (Chris signed me into /admin): Refresh read 167 posts, 0 new comments; the one real waiting question (ShonenTCG on Bluesky, 10-21 10:23am: is the $74.25 Luffy the alt art?) ANSWERED: the Premium Booster "The Best" P-055 print. 13 older waiting items (10-20 and before) left as is. TikTok Studio: 0 comments on every recent post.

## 10-22 ~3-4am ET (stamp guessed): Search Console mail 'Blocked by robots.txt' = 1 URL, the Apple touch icon (/apple-icon?hash), crawled before the 10-16 robots fix; Validate fix pressed in the pane (Validation started 10/22)
- [ ] Google's validation mail: Passed (days to 2 weeks). If it fails, curl https://cardflip.io/robots.txt and check the /app rule still reads /app$ + /app/.
- Index report 10-22 (to 10/15): indexed 21.3K (was 16,922 on 10-16), Discovered-not-indexed 53,236, noindex 1,244 by design, 5xx 3, 404 2 (/home, /&).

## 10-22 ~2-3am ET (stamp guessed): first vision read gets a 1,024 px picture (COMMIT ONLY, not visible; Chris "build it" after the §13 measure)
- vision.ts firstReadPicture: the photo shrinks to 1,024 px on its long edge (JPEG q88) for the FIRST read only; second look crops, pattern look and tiebreak keep the full photo; unreadable bytes go as sent. test:firstreadsize (6 checks, in npm test), vision-schema / budget / patternlook green, tsc + eslint clean.
- [ ] After push: scan_usage first-read rows show input_tokens ~1,400 lower than before (scripts/_scan-cost.mjs: cost per scan toward ~$0.018); no rise in "Not this card?" corrections over the first week; a few of my own scans read right (Pokémon + Magic).

## 10-22 12:53am ET: PUSHED 5573c19d..16524bee on Chris's "yes push it" (3 code: Magic pause entry removed; stamped-promo products never price the plain card; card-page badge "Checked against recent sales"; the rest docs/scripts). CI run 39724915663 running at 12:54am.
- [x] 1:25am: CI 39724915663 + 39725006148 RED (my doing: scripts/test-social.mjs still asserted Magic paused 10-16/10-20 after 4376b4c6 removed the expired entry; tsc/eslint were clean but test:social never ran before the push). Fixed 975fb559 (the test now asserts Magic moves read again on 10-22), CI 39727336041 GREEN, Production smoke green x3. The site itself was never wrong.
- [x] 1:27am curl: /cards/pokemon/sm-black-star-promos/entei--smp-SM219 = 200, "Checked against recent sales (11 sold)." live. (The 7 stamp-only cards like HGSS18 go stale by design.)
- [x] 7:40am 10-22 (scripts/_write-1022-check.mjs --prod): all 15 Staff-stamp fixes hold (Entei SM219 $22.17, Rillaboom SWSH006 $5.74, Charizard SWSH066 $104.97 ...); 39 of the 44 retired Pokémon checks moved to TCGplayer's number on the 10-22 point (Mewtwo ex ex1-101 $746.79, Venusaur base1-15 $136.30, Dark Charizard 1st $64.58); the 5 not updated are secondary "normal" lines with no TCGplayer feed (ex6-115, ex6-116, ex7-105, ex7-97) + 2016xy-7 (no 10-22 point).

## 10-21 ~10:50pm ET: picture tiebreak on SONNET 5 (Chris: "Sonnet"; PUSHED 5573c19d with the Booster fix, Pinterest scripts, docs)
- vision.ts TIEBREAK_MODEL = claude-sonnet-5 (One Piece stays Haiku 4.5). Basis: 8 of 8 same picks as Opus on Chris's own tiebreaks ($0.14 test, scripts/_tiebreak-ab-owner.mjs). tsc, test:visionbudget, test:vision-schema green.
- [x] 11:15pm: CI run 39713226057 green (7m26s) + Production smoke 39713302347 green for 5573c19d.
- [ ] After push: next scans in scan_usage show model claude-sonnet-5 on tiebreak rows (read LIKE '%tiebreak%'), cost_micros ~11,000 not ~20,000; /admin scan cost tile drops toward ~$0.021 a scan over the week.
- [ ] Watch the first week's tiebreak picks (/admin, or SELECT read FROM scan_usage WHERE read LIKE '%tiebreak%'): any pick that a user then corrects with "Not this card?" on a pattern card (Poké Ball / Master Ball / reverse) = switch back to Opus and say so.

## 10-21 ~10:35pm ET: admin can gift BOOSTER scans (TASKS B; PUSHED 5573c19d ~10:50pm on Chris's "push the booster fix", VISIBLE admin: shot SENT docs/shots/admin-booster-scans-after-phone.jpg)
- Adjust Scans: Plan scans / Booster scans toggle (Booster default + amber note on a Booster-only account); POST /api/admin/users/[id]/scans { pack: true } -> adjustPackScans (users.extra_scans, ledger kind admin_pack, plan "pack", floors at 0). test:adminroutes +3, tsc + eslint clean.
- [ ] After push: /admin/users, open Jenny's row (jporter1421): header shows "Booster N"; Add 1 with Booster scans -> "Added 1 Booster scans. Booster scans now N+1"; her app shows one more scan; ledger row kind admin_pack.
## 10-21 ~10:20pm ET: eBay reads = Ungraded + plain Buy It Now only (PUSHED 6ba0c921, CI + Production smoke green 10:25pm)
- Code: Browse filter buyingOptions:{FIXED_PRICE},conditionIds:{4000} on live comps + referee + sold comps (slab comps ask 2750); items whose buyingOptions include BEST_OFFER/AUCTION dropped (test:ebaybrowse, 8 checks). Hand links (card page sold link, /admin/prices, post-check) carry _sacat=183454&LH_Sold=1&LH_Complete=1&LH_BIN=1&Graded=No + the fuller no-slab words (test:pricing +1).
- [x] 10:42pm curl: prod card page Ho-oh ecard3-149 "Buy on eBay" link already carries the new word list (-tag -ace -gem -proxy -japanese) = push live on fresh pages. The SOLD link (Graded=No&LH_BIN=1) lives in the signed-in app (Inventory flag/stale notes, Watchlist): check there with Chris's sign-in.
- [x] 11:35pm: the sold URL shape (…&LH_BIN=1&Graded=No) opened in the pane shows "3 filters applied" with Buy It Now + Graded: No in eBay's bar (Rayquaza ex, Venusaur). Tomorrow's 6 post cards checked by me TCGplayer-first and marked Looks right on prod via scripts/_post-check-mark.mjs (report card §6).
- [x] 7:50am 10-22: the clean-read run itself answered this: 64 high of 2,026 read (3.2%) vs 102 high among all fresh rows before. TODAY'S 8:15am ET run will SKIP ("budget"): the 10:20pm ET re-read ran after midnight UTC, so price_history_meta ebay_referee_2026-10-22 = 3,054 of the 900/day budget. Next real run = 10-23 8:15am ET (the 1,964 unread rows wait a day).
- [ ] 10-23 ~8:30am ET: price_history_meta ebay_referee_last day = 2026-10-23, read ~400+, and (after the push) a sellerFloor block.
- One-off prod referee re-read started 10:20pm ET from local (scripts/_ref-rerun.mjs, 3,050 calls, backup .ebay-asks-backup-1792635332475.json): flips of the 426 keep/hide calls listed in STATE after the run.
**A.4 triage of every open check dated 10-18 and earlier: docs/TO-TEST-TRIAGE-2026-10-21.md** (63 stale, curl + select checks done 10-21 ~4:30am ET, the rest sorted into pane / phone / wait). Old lines below are left as written; that file is the status.

## 10-21 3:04pm ET: bot watch LIVE on main (ef9490fe, Vercel build skipped) + Wave Broadband hand rule (firewall v31)
- [x] 12:44am 10-22 (firewall metrics, six 4h windows): Wave block HOLDS: 5pm-9pm allow 19 / deny 333, 9pm-1am allow 21 / deny 207 (the ~20 allowed are other fingerprints = real customers); before the block 11-14K allowed per 4h. Past-day allowed by network: Wave 41.7K (all pre-3pm), Microsoft 12.1K, Comcast 9.1K, eBay 3.6K; denied: Bucklog 3.0K, Oculus/Meta 2.5K, Wave 1.5K. NetActuate AS63911 = 259 allowed in 24h, 0 in the last 4h (not worth a rule). New: EGIHosting AS18779 = ExaSearchBot (exa.ai, honest UA, ~190 card pages per 4h = ~1.1K/day from ~100 IPs, 100% card pages, ~$0.004/day of ISR writes). Left alone as a search assistant; Chris decides (TASKS E).
- DONE: dry dispatch run 39658385139 green (token works, flagged Wave AS11404 both JA4s 500+ IPs 100% card pages, saw them already denied). Hand rule: 3:00pm bucket Wave allow=1 deny=85 (was ~145 allowed per 5 min).
- OPEN (12:41am 10-22: Actions shows schedule runs 6:27pm + 9:36pm ET green, GitHub skipped the 7:25/8:25/10:25/11:25pm slots, manual 12:06am green = the cron is best-effort, the shut-out itself is in the firewall): first scheduled runs (:25 each hour) green in Actions; the first REAL block's mail arrives (subject "Bot Watch"); 10-22 Vercel ISR writes back under ~100K/day; no real-user complaints from Wave customers (Pacific NW).

## 10-21 9:35-10:05am ET (real clock): review 10-19 J polish, 20 commits ea7af0ad..fb017186, COMMIT ONLY
- Each batch: tsc + eslint clean; npm test full suite exit 0 (10:00am; two earlier runs died with exit 5 / 255 at a test's process exit, every test passes alone = the Windows/libsql exit flake); test:auth +1 (?next= refuses /login, /signup, /api), test:countrygate +5 (Google/X routes open abroad), test:listcache +4 (cold bursts walk once), test:xauth, test:webhook green.
- VISIBLE, shots SENT 10:03am (his yes pending): set strip "7-DAY CHANGE / 30-DAY CHANGE" (polish-1021-set-strip-before/after.jpg), /scan "Open CardFlip" (polish-1021-scan-open-after.jpg). Visible but edge-state, no shot: failure toasts red (Inventory bulk/category/sold, reprice eBay refused, resume lookups, Watchlist alert); Sales Report sealed rows drop "· #"; card page of a converted figure says "As of today." without "Recorded daily"; Top 100/movers set names tidied; admin Sign Out failure text; admin Send Now / Post now use the in-app dialog (same one as Users > Delete); "Log in to send a report."; eBay confirm "Publish it" greyed until the local price shows.
- PRICE: no slab lines in raw lists (9d1f198e). Prod read 10:00am (scripts/_graded-series-peek.mjs --prod): 2 graded rows, both Charizard-GX sm3-150 (PSA 10 $2,079.39, PSA 9 $780.38). Card pages never read them (TCGplayer lines only).
- [ ] After push: app search / card sheet for Charizard-GX Burning Shadows 150 (sm3-150): printing list has no "Graded Psa 10/9" rows (read via Watchlist or Recent lookups, not a name search, until af757e38 is live).
- [ ] After push: curl a Magic card page whose only price is a converted Cardmarket figure: "As of ..." line without "Recorded daily by CardFlip."
- [x] 10-22 12:40am curl: /cards/pokemon/skyridge has the "7-day change" tile; Ho-oh ecard3-149 page BreadcrumbList = 5 positions.
- [ ] After push: next daily run log (/admin) has the held-card sweep line; Vercel logs show no "pokemon-prices cron: ... failed" lines (or say which step).
- [ ] After push: one Google sign-in on the pane still works (Chris's account), and the One Tap prompt still signs in; travel case needs a non-US network (skip unless one is handy).
- [ ] After push: /pricing in the pane, Network tab: /api/auth/me fires once or twice, not ~7.
- Left on purpose: #22 nav search (all five games public on prod = nothing to hide), #37 billing key (own scope already), #39 in-memory vision cap (harmless), One Tap nonce (marketing #14: needs a prod sign-in test, do it with Chris), #26 Preorder 48 h (needs a shorter revalidate = more ISR writes).

## 10-21 ~10:50am ET: no up-arrow on a $0.00 move (TASKS J; COMMIT ONLY, VISIBLE: shots docs/shots/chart-zero-change-before-phone.jpg = live Snorlax pl2-81 24h "▲ $0.00 (0.0%)" green, -after-phone.jpg = local Mismagius GL LV.X 3M "No change" grey)
- PriceHistoryChart: a change that rounds to $0.00 reads "No change" in grey (was a green ▲); same for the Cardmarket "7d vs 30d" trend at 0.0%, and Inventory's value chart header. tsc + eslint clean (no test covers these components).
- [ ] After push: any card page, 24h pill on a card whose price did not move today -> "No change 24h", grey.

## 10-21 ~10:30am ET: a stopped line an eBay check vouches for prints (TASKS B Copycat; COMMIT ONLY, VISIBLE: shots docs/shots/copycat-before-phone.jpg = live, -after-phone.jpg = local with a local-only check)
- Copycat RP01-EN092 (ygo-78162, the 2008 Retro Pack): TCGplayer line stopped 10-13 at $544.99 (flat since 09-30); Yu-Gi-Oh! has no last-recorded fallback (its 10-13 junk stops), so page, set list and app were blank; eBay NM sold $672.78 on 10-20 = inside 25%, $544.99 stands. No price_checked row on prod.
- Fix: lib/cardPages.ts lastRecordedPrice(…, checked): in any game a stopped line prints while a binding check vouches for that printing, at the checked price (other YGO/Magic stops stay out); the page then reads "Checked against recent eBay sales (N sold)", dated by the check, not "Old price"; set lists list it (stale-marked, never featured); app: priceTrustSite.withPriceFlags adds the checked row to a card with no TCGplayer row (search-card + set-cards). Local proof: page $544.99 + checked line; /api/search-card ygo-78162 = 544.99 ebayChecked; the 2020 reprint ygo-564239 still $25.97. test:cardpages +5 (323), test:checked +3, sitetrust, sitetrustroutes, pricetrust, tsc, eslint green.
- [x] 8:04am 10-22: check RECORDED on prod (scripts/_put-check.mjs --prod yugioh ygo-78162 normal 544.99 n1, eBay 10-20 NM $672.78; tcg_usd 544.99, off_day NULL); curl /cards/yugioh/retro-pack/copycat--ygo-78162 = 200, $544.99 printed with "Checked against recent sales", no "looks off"; /cards/yugioh/retro-pack lists Copycat at $544.99. The check lasts 30 days: re-check by ~11-20 or the page goes blank again.

## 10-21 ~9:45am ET: Watchlist rows keep their printing (COMMIT ONLY, VISIBLE: shots docs/shots/watchlist-lc86-before-phone.jpg = live, -after-phone.jpg = local)
- Found in the pane check (TO-TEST 1038 via Watchlist): Chris's Legendary Collection Pikachu 86 read "$6.70 ▼100%, Saved $1,574.99". Cause: the 10-19 normal-first default (review #16) moved pickPrice to the Normal while the 10-14 row's baseline was the reverse holo; wishlist_items kept no printing. Same hole for NEW rows: Inventory's Watch saves the held printing's quote, the Watchlist repriced on the default. Scope (scripts/_wl-variant-scope.mjs, read only): 11 rows on prod, 1 mismatched (Chris's), 0 with an alert.
- Fix: wishlist_items.variant (db.ts column), every Watch path sends the printing (WatchPrice, Search sheet, Watchlist add, price-check, CardEditor quote variant); listing.ts watchPriceOf = the kept printing, else (old rows) the printing nearest the saved price when the default is 3x+ off; Watchlist tiles + Search's My Watchlist row + sparkline read it; dip alerts read the kept printing's series and never fire off another printing. test:pricing +8, test:ebaysweeps +4, apiauth, cards, push, tsc, eslint green. Local render: the same legacy row = "$1,574.99 steady", sparkline on the reverse line.
- [ ] After push: Chris's Watchlist Pikachu LC 86 = $1,574.99 steady; total value back up (~$2,440 for the 6); a new Watch from Inventory on a reverse holo saves variant (SELECT variant FROM wishlist_items newest).
- Not changed: the card sheet opened from that tile still headlines the Normal ($6.70) with both rows in its table (it has no printing input); say if it should open on the saved printing.

## 10-21 ~9:00am ET: Pinterest pins show on /admin/social/posts + count as posted (COMMIT ONLY, VISIBLE admin: shots docs/shots/pinterest-byhand-social-phone.jpg + pinterest-posted-console-phone.jpg)
- Chris: console said "Pinterest never posted" and no pins on /admin/social/posts. Cause: the robot tried an API pin every slot and failed (trial access; failure keys 10-16..10-21), nothing read the account, and the hand pins were never recorded.
- Fix: socialPulse reads GET /v5/pins (pin_metrics: views = impressions, likes = reactions, shares = saves) with the stored token (pins:read works, checked live ~8:50am: the last 10 hand pins listed); the posts refresh sets social_last_post:pinterest from the newest pin's ET day; Pinterest is byHand = the publisher skips it (no more failing tries, no double pin if trial access ever lifts); /admin/social strip says "by hand" instead of the "post" link. test:socialposts +3, socialpublish, social, tsc, eslint green. Local render checked at 375px.
- [ ] After push: /admin/social/posts Refresh lists Pinterest pins (10-21 7:45am "This week's biggest price jumps across five card games"), console tile Pinterest = "posted" on a day a pin went up. Read-only check: node scripts/_pinterest-read.mjs.

## 10-21 ~8:40am ET: fixed cards are USED in posts at the checked price, no % (39d7a02d) + auto-reply stays vague (11de6087), COMMIT ONLY
- Chris picked "Use it, no % shown". social.ts postChecks: set spotlight + most valuable rank/print a binding check's price, unsettled, never the lead or a riser set; movers/jumps/dips/head to head/all-games leads still skip it (postHolds). /admin/prices: "Fixed to $X, posts use this price" + intro line (VISIBLE admin wording: show Chris the two strings before the push). test:social +3, test:postcheck, tsc, eslint green.
- socialInbox DRAFT_SYSTEM: no data sources, vendor names, price method, AI/model names or system details. test:socialinbox green.
- [ ] After push: the next fix of a set-spotlight card keeps the same set in the remade video (its caption line shows the checked price with no "this week"); /admin/prices chip reads "posts use this price".
- [ ] After push: the next auto-reply sent names no source (social_comments reply_text, scripts/_comments-peek.mjs).
- Comment checks (Chris 10-21 rule, memory feedback-social-comment-replies): 8:05am read = 0 comments on all 7am posts; 13 old "Needs You" left alone on his word.

## 10-21 ~8:10am ET: 6 post cards fixed on prod from eBay sold (Chris OK'd 2 + 4 extra searches; 10-21 = 26 of 20), /admin/prices Post cards Fix
- bog-8 Rocket's Mewtwo rev $2,400 -> $1,000 (19 sold); ex2-99 Typhlosion ex $259.63 -> $200 (32); ex1-101 Mewtwo ex $746.79 -> $250 (37; its 10-14 hide sat at $554.98 and no longer bound = TASKS B.8, 387e78ef unpushed); ex1-3 Blaziken holo $101.02 -> $40.64 (36); ex1-102 Scyther ex $180.86 -> $115 (36); ex1-98 Hitmonchan ex $125.32 -> $70 (37). All raw English, lots/foreign/graded/"choose your card" left out, 30-day window.
- LIVE 8:20am ET: app id lookups show all 6 fixed numbers. 1pm remake: Mewtwo out (fell below the top 5 by price), 1st Ed Charizard base1-4-1st $4,000 in (its own 10-21 check, n=3). 7pm remade twice: Sandstorm -> Ruby & Sapphire -> (third pick pending, run 39597318240).
- [x] SUPERSEDED 10-22: all 6 were handed back to TCGplayer at 12:12am (report card §7); the badge itself verified on Entei SM219 (12:40am curl: $22.17 + "Checked against recent eBay sales (11 sold)").
- [ ] FOUND (decision, not code yet): "Most valuable" (social.ts topByPrice) never reads postHolds, so a fixed card still posts at its checked price while /admin/prices says "out of posts" (1st Ed Charizard 10-21 1pm). Chris 10-18 "fixed on the fly and used" vs the built 30-day sit-out: his call (TASKS-REMAINING E), then make all kinds + the admin wording agree.
- Pattern: old ex-era holos ran 1.6-3x eBay sold on TCGplayer (6 of 6 today); 4 of them carried the referee's "check" verdict. Data point only (the 10-18 research says asks alone can't be the catch).

## 10-21 ~4:10am ET: lookups + the held-card sweep stop writing over the nightly TCGplayer line (af757e38), COMMIT ONLY, not visible (keeps the 10-16 listing cap + keeps binding all day)
- Why: putCachedCards (every priced name search) and sweepPriceHistory (daily, runs AFTER the tcgcsv refresh) called recordPrices with pokemontcg.io's raw market. Prod 10-21 3:59am ET (scripts/_uncapped-lines.mjs, read only): 33 of 1,452 lines with a fresh listing low end on a point over the cap, 27 written since 8pm ET (bw7-145 543.75 x3 -> 900.96, swshp-SWSH066 $621 vs cap $138, Kyogre ex4-3 290 -> 542.60 = written by MY live Playwright name search at ~3:55am, so its keep stops binding until the refresh).
- Data: no manual write. The 5:45am ET pokemon-prices run rewrites today's points capped (heals all 27 today-points; the 6 from 10-20 drop behind a capped 10-21 point). Until af757e38 ships, any name search in the day can re-pollute.
- Tested: test:sitetrustroutes +5 (kept line stays 290 = FAILS on the old code with 542.6; no-line printing + Cardmarket + unmapped card still recorded), pricehistory, tcgprices, liveprices, sitetrust, cards, mirror, checked, pokemonhandmap, publiccollection, inventoryvalue green; tsc + eslint clean.
- After the 5:45am ET run today: node scripts/_series-peek.mjs ex4-3 = last 290; node scripts/_uncapped-lines.mjs = "written today" near 0 right after the run. After push + a day: the uncapped count stays near 0 through the evening; daily log pokemon.recorded drops (Cardmarket + unmapped only).
- CHECKED 7:40am ET 10-21 (before push): ex4-3 holofoil last 290 (healed by the 5:45am run); _uncapped-lines "written today UTC" 3 (was 33): base1-4 holofoil 954.65 (cap 724.99; live page still $600.00 "Checked against recent eBay sales"), base4-4 holofoil 417.78, gym2-3-1st 200 = written after the run by name searches (the leak af757e38 closes). Post-push half still open.

## 10-21 ~4:05am ET: app search quotes the card page's TCGplayer line, not pokemontcg.io's raw market (d120e6d7), COMMIT ONLY, VISIBLE (app prices: scan result, Search, Price Check, Watchlist), shots owed + Chris's yes (it touches which TCGplayer number wins = CLAUDE.md "price source order" rule)
- Why: the Kyogre keep fix showed $290 on its page but "looks off" in the app: /api/search-card?id=ex4-3 quoted pokemontcg.io's $542.60 (= TCGplayer's own NM market, checked on tcgplayer.com/product/89788 in the pane: Holofoil $542.60), while our line is $290 (the 1.45x-cheapest-listing cap, eBay sold agreed 10-18). Sample of 120 $50+/100+ cards (scripts/_app-vs-line.mjs, 2 s apart): only 22 answers came from pokemontcg.io (the rest from our line, upstream too slow), and 6 of those 22 were over 10% off the line (ex5-101 Wigglytuff ex $76.66 vs $160.83, base2-11 $156.56 vs $116, xyp-XY171 $80.70 vs $59.68, si1-7 rev, np-31, bw8-135). Saved answers (card_cache) already match the line (1 of 1,553 off).
- Fix: enCards.withOwnTcgplayerLines in search-card's flagged(): a stored TCGplayer line updated within 3 days replaces the upstream market for that variant (Pokémon only); a printing with no line keeps the upstream number.
- Tested: test:sitetrustroutes +3 (fresh line wins = FAILS on the old code with 542.6; no own line keeps upstream; 5-day-old line does not win), cards, mirror, pricing, tcgprices, sitetrust, pokemonhandmap, printings, searchtyped, liveprices green; tsc + eslint clean.
- After push: curl https://cardflip.io/api/search-card?id=ex4-3 = holofoil 290, no untrusted; ex5-101 holofoil = its line (~$160); node scripts/_app-vs-line.mjs 60 50 = 0 rows over 10% from pokemontcg.io.

## 10-21 ~3:35am ET (real clock): admin keep/hide binds to TODAY's stored price, not the referee's old read (387e78ef, TASKS B.8), COMMIT ONLY, VISIBLE (admin /admin/prices only), shots docs/shots/b8-admin-calls-phone.jpg + -desktop.png SENT ~3:45am ET, waiting on Chris's yes
- Why: Mewtwo Star HP 103 page blank "looks off": its 10-18 keep (eBay sold check, TCGplayer $6,887.50 right) was bound to the referee's $9,200 read; today's $6,887.50 is 25% off that, so the keep never bound. scripts/_keeps-unbound.mjs (read only): 99 of 426 calls did not bind; 5 Pokémon keeps of those were flagged = blank pages (Mewtwo Star, Team Aqua's Kyogre, Jirachi HL rev, Celebi ex UF 117, Typhlosion N1 1st); Magic only Darkpact LEB (page has a backup price); 8 Lorcana enchanteds all priced.
- Done on prod 3:30am ET (scripts/_keep-price-1021b.mjs, dry first): keeps re-pointed at their 10-18 checked prices: Mewtwo Star 9200 -> 6887.50, Kyogre 542.60 -> 290, Jirachi HL 8 rev 151 -> 118.21 (TO-TEST 10-18 "Hidden by eBay" block). Celebi ex ($999.99 now vs keep $370) + Typhlosion 1st ($231.99 vs keep $699.99) moved for real = eBay list 10-22.
- Tested: test:sitetrust +4 (keep binds to today's 150 not the 300 read = FAILS on the old code; no line = read; hand row = checked price), ebayreferee, postcheck, checked green; tsc + eslint clean.
- Before push: shot of /admin/prices "Your calls" (today's price, "eBay read $X" under it, amber "no longer binds" on a lapsed call) + Chris's yes.
- After the page cache (up to 2 days) or a post-check revalidate: /cards/pokemon/holon-phantoms/mewtwo-star--ex13-103 $6,887.50; Kyogre ex4-3 $290.00; Jirachi ex5-8 reverse $118.21. After push: a new keep's manual_price = today's stored price (scripts/_ask-row.mjs <id>).

## 10-21 ~4:25am ET: a tie inside one backup source takes the usual printing (normal/nonfoil first), card page + set lists, COMMIT ONLY, VISIBLE (headline of up to ~246 backup-priced cards), shots docs/shots/confidant-tie-before-live-phone.jpg ($8.86) + confidant-tie-after-local-phone.jpg ($7.65) SENT ~3:45am ET, waiting on Chris's yes
- Why: Enlightened Confidant pfra 5p page = $8.86 foil (Card Kingdom) over the $7.65 nonfoil: loadCardPage and backupRows kept whichever backup row the table returned first. Up to 246 cards have 2+ printings in one fresh backup source (YGO 140, Magic 58 cardmarket + 28 CK, Lorcana 20); only those whose page falls to a backup change.
- Tested: test:sitetrustroutes tie case (FAILS on the old code with [8.86, 8.86], passes with [7.65, 7.65]), cardpages 318, sitetrust, pricechain, publiccollection, pricing green; tsc + eslint clean.
- Before push: phone shot of /cards/magic/reality-fracture-promos/enlightened-confidant--pfra-5p live ($8.86) vs local ($7.65) + Chris's yes.
- After push: that page headlines $7.65 (Nonfoil); its set list tile $7.65.

## 10-21 ~3:40am ET: an eBay sold check retires only after TWO days back inside the band (checkedPrices.noteRaw), COMMIT ONLY, not visible; + Base Set Charizard check back on prod
- Why: base1-4's $600 check retired 10-19 on one $724.99 read; TCGplayer $954.65 next day -> 10-14 hand hide -> page blank "looks off" (LESSONS 10-21 ~3:30am).
- Done on prod 3:35am ET (scripts/_put-check.mjs, --dry first): price_checked base1-4 holofoil $600, n 29, day 10-21 (pane eBay sold re-check, 1 of today's budget), off_day NULL; series tail 954.65 x2 -> 600.
- Tested: test:checked +3 (one in-band day stays on; second in-band day retires; in band then out = stays on and fixes the jump), test:postcheck, pricing, pricehistory, sitetrust, social green; tsc + eslint clean.
- After Chris's /admin sign-in: POST /api/admin/post-check for base1-4 (same $600) = revalidates the card page now; else it refreshes within 2 days. Then curl /cards/pokemon/base-set/charizard--base1-4 = $600.00 + "Checked against recent eBay sales"; /api/search-card?id=base1-4 shows 600 with ebayChecked (activeChecks memo 10 min).
- After push: a check whose TCGplayer comes back in band for one day keeps tcg_usd noted and off_day NULL; off_day set only on the second in-band day.

## 10-21 ~2:45am ET: set lists follow the card page's price chain (stored backup -> Magic euro figure -> last recorded), COMMIT ONLY, VISIBLE, shots docs/shots/setlist-chain-before-live-phone.jpg + setlist-chain-after-local-phone.jpg SENT, waiting on Chris's yes
- Why (found by the #22 live check): loadSetCards dropped a card with no listable TCGplayer row BEFORE the backup step (Black Lotus Unlimited, 817 Magic cards priced only by a stored backup, ~140 Pokemon/YGO/Lorcana upper bound), and stopped at stored backups for flagged ones (128 Magic cards "looks off" on the list, a dollar figure from Cardmarket euros on their page: Will-o'-the-Wisp 2ED $66.41, Gandalf the White LTR 299, Rhystic Study WOT, Mana Crypt SPG). Measure: scripts/_mtg-list-eur-measure.mjs (read only). Also its order: a stopped card with a fresh backup listed the old price; its page shows the backup.
- What: same order as the page: stored backup, then (Magic) Cardmarket euro x ECB rate x 1.12 (shared eurFigure), then the last recorded price (stale), else off the list. A flagged card with none keeps the sentence and sorts last. Not changed: the "thin data" ($1,000+ under 14 days) rule.
- Tested: test:sitetrustroutes +6 on a throwaway db (euro 12 x 1.25 x 1.12 = 16.8; backup-only listed 17,560.09; nothing = off; order; stopped + backup = backup; stopped alone = last recorded, stale); test:cardpages 318, publiccollection, sitetrust, pricechain, queryplans, listcache green; tsc + eslint clean. Local 375px: Unlimited lists Black Lotus first, 301 cards (a page 2 appears past 300).
- After push: /cards/magic/unlimited-edition lists Black Lotus 2ED 233 ~$17,560 first and Will-o'-the-Wisp at ~$66 (not "looks off"); a page 2 link if past 300; re-run scripts/_mtg-list-eur-measure.mjs logic against the list (spot 3 of the 128); /cards/pokemon/base-set (Machamp base1-8) lists every backup-only card.

## 10-21 ~2:20am ET: search with no letter or digit ("%", "- -") answers at once, no pokemontcg.io wait, a31a5aea COMMIT ONLY, not visible (found by the #21 live check)
- What: /api/search-card, Pokemon name path: after the mirror finds nothing, a name with no letter/digit returns no cards instead of asking pokemontcg.io (it sat 5-24 s on "%" then 400'd = free function time for a bot). "_____'s Pikachu" still comes from the mirror; a real name the mirror lacks still goes upstream.
- Tested: test:sitetrustroutes (+2), test:mirror, test:searchtyped green; tsc + eslint clean.
- After push: curl -w "%{time_total}" 'https://cardflip.io/api/search-card?name=%25&game=pokemon' = {"cards":[]} under 1 s; '?name=_' still 2 cards; '?name=charizard' unchanged.

## 10-21 ~2:05am ET: alarm mail on 3 unconfirmed sign-ups in an hour (any network), COMMIT ONLY, not visible (Chris: "3 unconfirmed accounts in an hour makes sense")
- What: rateLimitDb.checkUnconfirmedSignups, run by the 15-min uptime cron: 3+ accounts made in the last hour still waiting for their email code 10 minutes on -> one "CardFlip: Unusual Sign-up Traffic" mail to support@ naming them (once an hour, inside the 5/day security mail cap). Site-wide, not per IP (the bot moved address every account or two).
- Tested: test:torspike +4 (confirmed / too new / too old left out; the 3rd mails once; no second mail that hour; gone two hours on); test:uptime green; tsc + eslint clean.
- After push: the uptime cron JSON (Vercel log, scripts/_vercel-uptime-logs.mjs) shows unconfirmed {waiting, mailed}; the next real burst mails support@ (do not fake one on prod).

## 10-21 ~1:46am ET: firewall "Scrapers: Rackdog hosting network (deny)" LIVE (Chris: "i dont want users on vpns anyway", "i mean just rackdog")
- What: whole site denied to Rackdog's 5 ASNs (1006, 9087, 142617, 154395, 398465; RIPEstat), firewall v27, scripts/_fw-block-asn.mjs. Was ~2.8K allowed a day under a stale fake Firefox/151 name.
- Tested: right after: / , /api/geo, /cards/pokemon/holon-phantoms 200 from a normal network.
- Next day: Firewall > Traffic (Past Day, action=deny) lists Rackdog LLC under the new rule and it is gone from the allowed top networks; if NetActuate (same Firefox/151 name, smaller) is still in the allowed top 5, ask Chris before adding it.

## 10-21 ~1:45am ET: admin console login joins the shut-out (ipGate + wrong usernames count, 0d11c21b), COMMIT ONLY, not visible
- What: /api/admin/login refuses shut-out IPs and Tor exits before checking anything; each different refused username from one IP counts toward the 5-an-hour made-up sign-in shut-out (LESSONS 10-21 ~1:45am).
- Tested: test:adminroutes all pass (+3: five names -> shut out even with the right password; the real name wrong six times is not); test:authroutes, test:torspike, test:adminsession green; tsc + eslint clean.
- LIVE 10-21 ~3:50am ET: PASS, Chris signed in to /admin in the pane (password + emailed code) after 0d11c21b; prod-smoke was green 1:52am.
- After push: Chris signs in to /admin once in the pane (password + emailed code still works); prod-smoke green. Do not probe it from our IP (5 names = our own 24 h shut-out).
## 10-21 ~1:20am ET: Tor exits refused in code (daily list) + site-wide sign-up alarm, COMMIT ONLY, not visible to real users (Chris: "yeah go for it"), PUSHED 0a4ea166 1:21am ET
- What: lib/server/torExits.ts stores check.torproject.org's exit list once a day (the 15-min uptime cron; a failed day retries next ping, a short/failed download keeps the old list); ipGate (every sign-in/sign-up/account/billing route) and /api/waitlist answer a Tor exit with 403 "Sign-in isn't available over Tor...". rateLimitDb.noteSpike counts across ALL networks per hour: 10 made-up sign-in emails, 8 new accounts, or 10 refused sign-ups -> one "CardFlip: Unusual Sign-up Traffic" mail to support@ (inside the 5-a-day security mail cap). Normal 60-day peak: 5 sign-ups an hour.
- Tested: test:torspike 16 pass; authroutes/auth/google/xauth/ratelimit/emailverify/uptime/waitlist/attribution/adminroutes/sessionrevoke/apiauth/deletebilling/countrygate green; tsc + eslint clean.
- After push: within 15 min the uptime cron JSON (Vercel log) shows tor {refreshed: true, exits ~1200}; prod settings row tor_exits exists (read only); /api/auth/me and sign-up from a normal network unchanged; prod-smoke green. The alarm mail itself: only on a real spike (do not fake one on prod).
- LIVE 1:32am ET after 0a4ea166 (dpl_6Dy7f6AL READY 1:21am): CI main + branch + Production smoke green; prod settings tor_exits written 1:30am ET by the uptime cron, 1,208 IPs; /api/auth/me 200 {"user":null}. Remaining: the alarm mail on a real spike only; a normal-network sign-up shows up in the next real one (no fake account made).
## 10-21 ~12:15am ET: set pages list a stopped Pokémon card at its last recorded price (bdb156a2), COMMIT ONLY, VISIBLE, Chris YES ~12:15am ET (ships with the next push)
- Tested: test:cardpages 318 pass (+2); tsc + eslint clean. Shots docs/shots/set-last-recorded-holon-phantoms-before.png (live: Pikachu Star missing, 110 cards) / -after.png (local: Pikachu Star $1,899.99 first, 111 cards; "Most valuable" still Gyarados, stale is never featured).
- After push: /cards/pokemon/holon-phantoms lists Pikachu Star $1,899.99 (ISR: may need the page's revalidate); /cards/pokemon/base-set-1st-edition lists Blastoise $1,300.00; the set's "Most valuable" box never names a stale card.
- LIVE 1:35am ET after 0a4ea166: /cards/pokemon/holon-phantoms lists Pikachu Star 104/110 $1,899.99 first (no revalidate needed), "Most valuable" box = Gyarados ☆ δ $1,333.56; /cards/pokemon/base-set-1st-edition lists Blastoise 2/102 $1,300.00, box = Charizard $4,000.00. Seen in passing: that set's "30 days -37.2%" = TCGplayer's 1st Ed Charizard line going $10,000 -> exactly $4,000 ~09-23 and flat since; added to the 10-22 eBay list.
## 10-21 ~1:05am ET: second probe wave (Tor) - firewall LIVE + email check (b1110d0e) + 16 junk accounts deleted (Chris yes)
- Tested: test:authroutes (+6), test:auth/emailverify/google/xauth/waitlist/emailtypo/emailconfirmui/attribution green; tsc + eslint clean. Firewall: /api/geo%2f, /api/auth/forgot%2F, /api/auth/logout%5C, /api/auth/login%2F, /api/auth/me%2f%2f -> 403 (x-vercel-mitigated: deny); /api/auth/me, /api/geo, / -> 200. 16 accounts deleted (scripts/_delete-probes-1021.mjs, 0 left). No sign-ups after 12:55am ET.
- LIVE 12:10am ET after 12cc1326 (dpl_GAFqFy4H READY 1:07am): admin@cardflip.io. -> 400 "Enter a valid email.", a-check@example.org -> 400 "Please use your real email address.". Remaining: POST /api/auth/signup with admin@cardflip.io. and with a@example.org -> 400 "Please use your real email address." (or the invalid-address message); a gmail address still reaches the code step (do NOT finish it). prod-smoke green (it signs in with @example.com, sign-in is untouched). Tomorrow: /admin/errors has no "Cannot find module ...%2f" lines; /admin Users has no new probe rows. Weekly: refresh the Tor list (scripts/_fw-tor-api.mjs).

## 10-21 ~12:30am ET: nightly Pokémon refresh keeps a pattern card's no-sale / missing printings (3e25968f), not visible
- Tested: test:patterncleanup 8 pass; tsc + eslint clean.
- After the first nightly run after push: the stopped pattern lines (scripts/_stopped-lines-measure.mjs) are still in price_series; the Pokémon refresh result in /admin shows no error.
## 10-21 ~12:50am ET: blank Pokémon card pages print the last recorded price (dated, noted), COMMIT ONLY, VISIBLE, Chris YES 10-21 ~1am ET (ships with the next push)
- Tested: test:cardpages 316 pass (+8: dated with the stale weeks, flagged out, >180 days out, one-day four figures out, usual printing first, Pokémon only, loader wiring); tsc + eslint clean. Local render at 375px: Pikachu Star $1,899.99 "As of Oct 6, 2026 · Old price · check eBay sold · Market hasn't updated this in 2 weeks"; 1st Ed Blastoise $1,300.00 as of Oct 8 (local db). Prod measure: 31 Pokémon pages priced again (25 at $100+), Yu-Gi-Oh!/Magic 0.
- LIVE 12:10am ET after 12cc1326: Pikachu Star $1,899.99 "As of Oct 6, 2026", 1st Ed Blastoise $1,300.00, Shining Tyranitar 1st $4,249.99, all with "hasn't updated". Was: curl /cards/pokemon/holon-phantoms/pikachu-star--ex13-104, /cards/pokemon/base-set-1st-edition/blastoise--base1-2-1st, /cards/pokemon/neo-destiny-1st-edition/shining-tyranitar--neo4-113-1st (ISR: may need the page's revalidate): price + "As of" an October/September day + "hasn't updated"; Rayquaza star ex8-107 stays "No current market price" (single point, by design).

## 10-21 ~12am ET: Sunday mail young-game picks skip "Few recent sales" prices, COMMIT ONLY, not visible (which card a mail row names)
- Tested: test:campaigns (+1 source check), test:digest green; tsc + eslint clean. Prod measure before the fix (scripts/_mail-jumpy-measure.mjs yugioh/lorcana/onepiece, read only): Yu-Gi-Oh! #1 = Amazoness Chain Master Retro Pack $104.29 -> $199.99 FEW (now skipped; next = Official Judge Token TKN4-EN021 $21.74 -> $36.99, a clean step); Lorcana #1 Donald Duck Archazia's 209 foil +15.5% ok; One Piece #1 DON!! PRB-02 +7.8% ok.
- After push: Sunday 10-25 ~2pm ET open /admin/emails Sunday preview; no row with a "Few recent sales" card; hand-check every card against eBay (dated task).

## 10-20 ~11:55pm ET: headlinePrice, a brand-new flagged printing no longer blanks an established one (Rocket's Mewtwo ex case), COMMIT ONLY, not visible today
- Rule: a doubted printing ranked above another still blocks it (Skyridge, 10-06/10-07) UNLESS the doubted line has under 14 priced days and the other has 14+.
- Tested: test:cardpages 308 pass (3 new: Skyridge with history still null, Mewtwo 2-day $1,150 Normal vs 30-day $579.90 Holofoil -> Holofoil, a new guard-flagged line vs an established one -> established); tsc + eslint clean. Prod measure (scripts/_headline-young-measure.mjs, read only): Pokemon/Magic/Lorcana = 0 pages change today (the 8 ex-era cards were fixed by price checks).
- After push: run `scripts/_new-normal-lines.mjs` weekly; any new normal line beside an old holofoil one must show the holofoil price on its page (curl), not "looks off".

## 10-20 ~11:55pm ET: bot protections (Chris picked all four: "3 sign-ups per IP a day", "Auto-block probing IPs", "Code emails 30 -> 5 a day", "No sign-ups from servers"), COMMIT ONLY, not visible (refusal messages)
- LIVE NOW (no deploy needed): firewall v11 rule "Abuse: sign-up/sign-in from cloud servers (deny)" = /api/auth/* from AWS, Google, DigitalOcean, OVH, Hetzner, Linode, Vultr, Oracle, Alibaba, Contabo; Microsoft (AS8075) NOT yet, because prod-smoke runs there. Header x-cf-smoke = GitHub secret SMOKE_PASS (also .env.migration.json smokePass) lets the smoke through. Home connection checked: /api/auth/me 200.
- Tested locally: test:authroutes new checks (5th different made-up email at sign-in shuts the IP out 24 h: login/sign-up/forgot 429 "Try again tomorrow"; 3 sign-ups a network a day, 4th = 429 + no account, 3rd refused try shuts out; loopback never capped/shut out); tsc + eslint clean; full npm test (see commit).
- Shut-outs also EMAIL the alert inbox support@cardflip.io (ALERT_EMAIL, Chris 10-20 picked it so his phone notifies; smoke/CI alerts + the error report moved there too, Vercel ERROR_DIGEST_TO set to support@ by REST, takes effect on the next build) (securityAlert.ts, "CardFlip Blocked a Bot", max 5 a day; Chris: "im not always going to be around refreshing the admin page"); local test: cap works, send fails cleanly with no mail configured. After push the first real shut-out is the live test (or ask before forcing one).
- DONE 10-20 ~11:40pm ET after the push (e1f8e3c8 READY): Microsoft added (firewall v12), manual prod-smoke GREEN, live sign-up as support@cardflip.io -> 400. Still open: the first real shut-out email arriving at support@ (live test). CI for e1f8e3c8 green.
- (was) After push: (1) `node scripts/_fw-servers-auth.mjs --with-microsoft` (adds AS8075), then the next Production smoke run must be green (it sends the pass header from the new workflow env); red = remove 8075 again first. (2) POST /api/auth/signup with support@cardflip.io -> 400. (3) Mornings: /admin/errors warnings "ip shut out for 24 h" = who got blocked and why (add repeat offenders with scripts/_fw-block-ip.mjs).

## 10-20 ~11:25pm ET: @cardflip.io refused on sign-up, Google, X, Change Email, waitlist (Chris: "block users from making an account with @cardflip.io"), 56310239 COMMIT ONLY, not visible (an error message)
- Tested locally: test:authroutes (support@cardflip.io and a@mail.CardFlip.io -> 400), emailverify, google, xauth, waitlist all pass; tsc + eslint clean.
- After push: POST https://cardflip.io/api/auth/signup with support@cardflip.io -> 400 "Please use your real email address." (no account made); a gmail sign-up still works (CI Production smoke covers it).
- Firewall v9 deny rule for 35.183.7.202 is live; check /admin Users on 10-21 for any new "probe"-style rows from another IP.

## 10-20 ~10:25pm ET: Mark as Sold waits for Verify Match (Chris: "this shouldnt be able to mark as sold if unverified"), COMMIT ONLY, VISIBLE, shots docs/shots/verify-first-desktop.png + verify-first-phone.jpg APPROVED by Chris 10-20 ~10:30pm
- Tested locally (dev, list view): 20 unverified rows = Verify Match + dashed "Verify first" (wide) / nothing (375px) + X; the verified Charizard = Build Listing + Mark as Sold; an unverified card's popup = "Yes, This Is My Card" + Delete, no Mark as Sold; PATCH {status:"sold"} on an unverified row = 409 "Verify the match first, then mark it sold.", row stays ready. tsc + eslint clean.
- After push, phone + desktop: Inventory list view, a card still showing Verify Match has no Mark as Sold (row or popup); verify it ("Yes, This Is My Card") -> Mark as Sold appears; a sealed product still shows Mark as Sold without verifying.

## 10-20 ~10:55pm ET: scan result chip = layout A (Chris picked it from samples A-D) + green price to the cent + landing pop, PUSHED 74775ac2 9:29pm ET (Chris: "you can push that"), VISIBLE, shots docs/shots/chip-A-1-price.png + chip-A-2-pricing.png
- Tested locally (pane SHOWN, phone width, faked Virizion 095/86 read): row 1 art + MATCH FOUND/name/set + Clear; green band $28.00 + MARKET PRICE left, condition pill right; count-up lands with .reveal-price-pop; faked Charizard tie with a 15 s tiebreak: band says PRICING..., Verify 2 Scans $28.00 leaves it out. tsc + eslint clean. (A hidden pane freezes rAF: the count-up sits at $0.00 - show the pane before testing it.)
- After push, phone: scan any card -> price in the green band under the name, always two decimals, pops once when it lands; Clear sits top-right beside the name; a long printing ("Near Mint · Poké Ball Pattern") truncates in the pill, never pushes the price.

## 10-20 ~10:05pm ET: TASKS B00 (d) the camera holds the price + big-pull moment while the picture tiebreak is out, PUSHED in 74775ac2 9:29pm ET (d3a7c4fb), VISIBLE, shots docs/shots/printing-check-1-during.jpg + printing-check-2-after.jpg APPROVED by Chris 10-20 ~10:25pm ("looks fine"), not pushed
- Tested locally (pane, phone width, faked "Charizard, no number" read = 4-way tie, faked tiebreak 8-10 s): keep path PRICING... 0.5-9 s, then $144 once; swap path PRICING... until the answer, then Pokémon GO #010 counted up once to $3.84; tally "1 card" and "Verify 1 Scan" with no figure while pending, $3.84 after; the swap's PATCH stored scan_market 3.84 (also proves bec236b7 end to end). tsc + eslint clean.
- NOT seen in the pane (camera blocked = no guide): the stamp stays "Found!" while pending and a big/grail card's "Nice pull!"/"Big one!" plays once when the check settles.
- After push, phone: scan a card with no number showing (thumb over it) that has several printings -> PRICING... for a few seconds, then ONE price, no big figure first; a pricey card still gets "Nice pull!" after the check.

## 10-20 ~9:30pm ET: TASKS B00 (c) a card swap carries the new card's shown market into scan_market (pack value), PUSHED in 74775ac2 9:29pm ET (bec236b7), not visible (pack totals only)
- Tested: test:cards +7 checks (create stores it, price-only patch keeps it, swap with market stores it, swap without one clears it + scan_price, printing change carries it, 0 clears, wrong user blocked); test:packs, test:pricing green; tsc + eslint clean. Client sends `scanMarket: headlinePrice(item) || null` from swapCard, the editor card pick, the late-card catch-up and the printing picker; NOT pane-tested (field only, typed).
- After push, prod read only: a pack pull whose card is swapped ("Not this card?" or the picture tiebreak) has cards.scan_market = the new card's market (not the first read's); the pack's total on /packs drops/rises with it.

## 10-20 ~8:45pm ET: first Booster buyer's scans = (a) a "Not this card?" pick during the row's create reaches the row, (b) a chart point re-prices only the printing quoted, PUSHED c5379fb0 8:47pm ET (Chris: "push it live"), not visible (prices)
- Tested locally (fake Umbreon read, POST /api/cards delayed 6 s): pick Obsidian Flames 87 ms in -> after create PATCH catalogCardId sv03-130 + price 1.66 + doubt. Pick after the row exists -> PATCH 1.66 and the follow-up stays 1.66 (was 4.06, the reverse holo's point). test:pricing (+4 point checks), liveprices, printings, pricehistory, pricetrust, tcgprices, inventoryvalue, cardpages PASS; tsc + eslint clean.
- After push, prod read only: a new scan row whose card has normal + reverse rows (most SV commons/uncommons) and no printing pick keeps the normal-based price after its chart point lands (cards.price stays at the first PATCH, not a 3-10x jump). Her 8:36pm Umbreon row (cards id for created 8:36:26 PM) is the known bad row from before the fix.



## 10-20 ~4:45pm ET: wrong-game scan keeps the photo + "Switch to <game>" (Chris 10-20), COMMIT ONLY, VISIBLE, shot docs/shots/wrong-game-chip-phone.jpg (the "camera blocked" text and the top-left box in it are the browser pane's / dev-only, not the app)
- Tested locally (faked AI read, dev photo input): Pokémon switch + Lorcana card -> chip "That looks like a Lorcana card" + amber "Switch to Lorcana"; tap -> the same photo is read as Lorcana, MATCH FOUND Angel - Siren Singer, the game switch flips to Lorcana, ledger price $1.75. The card view (no match) shows the same button first and "Scan again" second.
- After push, phone: scan a Magic/Lorcana card with the switch on Pokémon -> the chip offers the switch, one tap gives the right card; the Scans counter drops by ONE for that card (the wrong-game read is given back).

## 10-20 ~4:20pm ET: review 10-19 #24 slice 3 = help lists, auth helper links, password hint, "Price looks wrong?", COMMIT ONLY, VISIBLE, shots docs/shots/help-index-24-phone.jpg, help-article-24-phone.jpg, login-24-phone.jpg, signup-24-phone.jpg, price-report-24-phone.jpg, unavailable-24-phone.jpg
- [x] (prod 10-20 8:35pm ET, pane at 375px + signed-out curl of /login) /help rows 44px 14px, /help/scanning breadcrumb 14px + "More help topics" rows 44px, no sideways scroll; /login Forgot Password / Sign Up / Back to home = text-sm zinc-400 with the -inset-y-3.5 tap layer. Rest of this block (signup hint, price report, /unavailable) rides on the same shipped classes.
- After push, phone: /help topic list = 44px rows with hairlines, lighter text; a /help/<topic> page has the card pages' breadcrumb (14px) and the same 44px "More help topics" rows; /login "Forgot Password?" 14px lighter and a tap just above it still hits it while the password box keeps its own taps; "No account? Sign Up" 14px; "Back to home" lighter on login, signup, forgot, reset, confirm-email; signup password hint "At least 8 characters" readable 12px; the eye button is reachable with Tab on a keyboard; signup terms line readable; a card page's "Price looks wrong?" and its Too high / Too low tap at 44px; /unavailable Log In + Privacy / Terms 14px with tall tap rows.

## 10-20 ~4:15pm ET: review 10-19 #24 slice 2b = list-row tap targets (src/lib/tap.ts shared layers), COMMIT ONLY, VISIBLE (small), shots docs/shots/inventory-24-phone.jpg, watchlist-24-phone.jpg
- After push, phone: Inventory select/delete circles on a tile tap at ~41x44 and a tap between them never deletes; the selection toolbar pills (Move to listings ... Delete N cards) and Clear / Cancel tap at 44px; "Select all" row taps anywhere on its line; Watchlist "Price alert" pill 12px lighter grey, its X and Set / Clear tap easily; Account row buttons (Change, Manage ...) tap at 44px; Search star taps at 44px; a pack page's "All Packs", Delete Pack, Delete / Keep tap easily (Keep wins a tap between them).

## 10-20 ~4:10pm ET: review 10-19 #24 slice 2 = scanner + nav tap targets (44px tap layers, look unchanged) + 12px text, COMMIT ONLY, VISIBLE, shots docs/shots/pills-tabs-24-phone.jpg, scanner-list-24-phone.jpg, camera-24-phone.jpg
- After push, phone: bottom tab labels 12px; the five game pills read 12px and still fit one line (scanner list header, camera, Insights); on the scanner list tap just above/below Connect eBay / Done / Clear / a game pill / Add Cards / Inventory -> still hits it; camera Close / light / ... buttons and the result card's copy pill + Clear tap easily; public header links (How It Works ... Get Started) and the search icon tap at 44px; This copy sheet labels "CONDITION" / "PRINTING" lighter 12px.

## 10-20 ~4:15pm ET: review 10-19 #24 slice 1 = footer + breadcrumbs (text 14px zinc-400, 44px link rows), COMMIT ONLY, VISIBLE, shots sent (docs/shots/crumbs-24-phone.jpg, footer-24-phone.jpg)
- LIVE 3:00am ET 10-21: PASS (pane 375px, /cards/pokemon/obsidian-flames/umbreon--sv03-130): crumbs 14px zinc-400 (lab 65.6), py-2 = 36px tap height each, current "Umbreon" 14px zinc-200 (lab 90.7); footer links Features..Contact 14px zinc-400, 44px tall rows; not-affiliated line 14px zinc-400; page width 375 = no sideways scroll. Seen in passing: the current crumb has no aria-current="page" (a11y polish, not done).
- After push, phone: any /cards page's breadcrumb is readable grey (not dim), the current page name is light, each crumb has tap padding; the footer links (Features ... Contact) are 14px light grey with 44px tall tap rows, the not-affiliated line readable, side gutter matches the page.

## 10-20 ~3:50pm ET: review 10-19 #23 /most-valuable in the sitemap, COMMIT ONLY
- LIVE 2:15am ET 10-21 (on main since the 10-20 pushes): sitemap.xml names /sitemaps/pages.xml; it lists most-valuable for all five games next to Pokemon + Magic /movers; all five pages 200. Remaining: Search Console picks them up (next crawl, no action).
- After push (sitemap cache rolls on its TTL, see memory cardflip-search-console purge steps): curl https://cardflip.io/sitemaps/pages.xml (or the pages child the index names) lists /cards/pokemon/most-valuable and the other four games' most-valuable pages next to /movers; Search Console picks them up on the next crawl.

## 10-20 ~5:30pm ET: review 10-19 #22 a flagged price is never a blank on the public lists (set list, /u/handle, search hits, sticky bar), COMMIT ONLY, VISIBLE: phone shots APPROVED by Chris 10-20 4:05pm ET ("#22 seem fine")
- LIVE CHECK 2:25am ET 10-21: FAILED in part. /cards/magic/unlimited-edition: Black Lotus MISSING (298 cards, Timetwister first; its page prints $17,560.09) and Will-o'-the-Wisp 2ED 136 last with "This price looks off" while its page prints $66.41. Passed: a flagged no-backup card sorts last with the sentence. Fixed in the 10-21 ~2:45am block above (commit only).
- After push, /cards/magic/unlimited-edition lists Black Lotus (2ED 233) with its Cardmarket backup price (it was dropped from the set before); a Pokemon flagged card with NO stored backup stays on its set page at the END with 'This price looks off' in the price cell, no number, and the set summary strip ignores it.
- After push, a flagged no-backup card's own page on the phone: the bottom bar says Market + the looks-off sentence beside Watch this price (it was Watch alone); a card with no prices at all keeps the bare bar.
- After push, /cards search (CatalogSearch) for that flagged card: the hit shows the looks-off sentence under the set name instead of nothing; a flagged card WITH a backup shows the backup price.
- After push, a public profile /u/<handle> holding a flagged card: the row shows the backup-based asking price when one is stored (counted in the total), else the dash as before; typed (locked) and live-listed prices untouched. npm run test:cardpages, test:publiccollection, test:sitetrust PASS 10-20.

## 10-20 ~4:50pm ET: review 10-19 #21 search-card LIKE walks escape % _ \ and the English substring walk needs 3 letters, COMMIT ONLY
- LIVE 2:20am ET 10-21: '?name=_' = 2 cards ("_____'s Pikachu") 0.66 s; charizard 24 cards 0.31 s, ashs pikachu 7, poke ball 24, Magic (game=mtg, NOT "magic") lightning bolt found 0.29 s. FAILED part: '?name=%25' = no cards (escape works) but 24 s then 5 s, {"upstream":"error"/400}: the pokemontcg.io fallback waited on "%" -> fixed in the 10-21 ~2:20am block above (commit only).
- After push: curl 'https://cardflip.io/api/search-card?name=%25&game=pokemon' and '?name=_' return an empty/short list fast (not 400 rows), and Vercel function time for that call is tens of ms; a real search ('charizard', 'ashs pikachu', 'poke ball', Magic 'lightning bolt', ja 'ピカチュウ') finds the same cards as before (npm run test:mirror, test:searchtyped, test:mtg, test:cards PASS 10-20 locally).
- Scanner: a vision read of a 1-2 letter name (e.g. 'Mr' clipped) still identifies by the printed number fraction (the number fallback runs when the walk is skipped).

## 10-20 ~4:30pm ET: review 10-19 #20 db ready() forgets a failed schema run so the next query retries, COMMIT ONLY
- 10-21 2:55am ET: no live proof possible on demand (needs a real Turso blip); watch /admin/errors for a 'schema' / 'initSchema' failure followed by healthy responses. Local tests passed 10-20.
- After push: no visible change. Proof on the next Turso blip: a cold-start error (Vercel log 'schema' / 'initSchema' failure) is followed by healthy responses from the SAME instance on later requests instead of the same error until a recycle; local: npm run test:cards, test:queryplans, test:liveprices PASS 10-20.

## 10-20 ~4:30pm ET: review 10-19 #19 live refresh price move re-checks lock + status in the UPDATE, COMMIT ONLY
- 10-21 2:55am ET: not run on prod: it needs a timed race on a real account's draft (would change a row). Rides on Chris's next phone session: type a price on a draft right after opening Inventory, reopen, the typed price stays.
- After push, signed in, Inventory: open the page (live refresh starts), immediately lock a draft's price (type one) or list/mark it sold; when the refresh lands the typed/listed/sold figure stays (prod check: that row's price in the DB = the typed one, price_locked = 1). Unlocked drafts still move to the market suggestion as before.

## 10-20 ~4:10pm ET: review 10-19 #16 ONE default printing order (lib/variantOrder.ts, normal first), COMMIT ONLY. APPROVED by Chris 10-20 4:05pm ET ("#16 seem fine"): the app used to quote holofoil > reverse holo > normal; the public pages, alerts, refresh and price guard quoted normal first. Now everything quotes normal first: 11,171 Pokemon cards with a normal + reverse holo row will show the NORMAL price in Search/Price Check/scan-without-a-pattern-read (lower than before); 236 cards with normal + holofoil likewise. Holo rares (no normal row) unchanged. Seller's pick, the scan's pattern read and the 1st Edition toggle still override.
- LIVE 2:55am ET 10-21: PASS. Pokemon Umbreon sv03-130 (normal $0.36 + reverse $2.75): /api/search-card lists normal first, public page headline "Normal $0.36". App Search Cards (pane, Chris's account, Magic switch left as is): Lightning Bolt 2X2 117 $2.21 = page "Nonfoil $2.21"; M10 146 app $1.89 vs page "Nonfoil $1.83 As of Oct 20" = same printing (foil is $7.48), the page shows the last nightly point and the app today's live one (FDC 163 $0.82 vs $0.83 likewise). Not checked: the Inventory-load reprice (needs a fresh scan draft; rides on Chris's next phone scan).
- After push, app Search Cards: a common with both printings (e.g. any SV common) shows the normal price, the pop-up's printing selector still lists the reverse holo at its own price; the public /cards page for the same card shows the SAME headline; a holo rare (Charizard ex) unchanged.
- After push, Inventory load: a draft saved from a scan is NOT repriced to another printing (the review's 'draft repriced on Inventory load' symptom gone); npm run test:pricing, test:printings, test:pricehistory, test:cardpages, test:tcgprices, test:liveprices, test:pricetrust, test:social, test:inventoryvalue all PASS locally 10-20.

## 10-20 ~3:50pm ET: review 10-19 #15 cleared inline sold-price box no longer saves a $0 sale, COMMIT ONLY
- 10-21 3:10am ET: not run on prod (it marks a real row sold if the fix failed); local tests cover it. Rides on Chris's next phone session: Mark sold, clear the box, check -> "Enter what it sold for", row stays. (or type 0), press the check: toast 'Enter what it sold for', the box stays open, the row is NOT marked sold (status unchanged, no $0 in Earned); type a price and press the check: sold as before.

## 10-20 ~3:45pm ET: review 10-19 #14 Inventory value chart refetches on sale/reprice, fetches only while the summary panel is open, COMMIT ONLY
- LIVE 3:05am ET 10-21: PASS (pane, Chris's account, Magic tab): load = no value-history call; Show = 1 call (game=mtg&days=90&basis=market), chart drew; Hide + Show = exactly 1 more; left Hidden. Not run: the refetch on sale/reprice (would change a row). /api/cards/value-history call on load; tap Show: one call, the chart draws; mark a card sold (or change its price) with the panel open: a second value-history call fires and the line/last point updates without a reload; Hide then Show: one more call, range pill back to 90d (state resets, fine).

## 10-20 ~3:35pm ET: review 10-19 #13 Inventory catalog stub carries the row's game (340837b3 -> this commit), COMMIT ONLY
- 10-21 3:08am ET: no qualifying row on Chris's account (Lorcana Stitch Rock Star promo #2 $1,250.00, One Piece Nami P-117 $1.63, both priced; Yu-Gi-Oh! 0). Waits for a real flagged/stale row in those games., the 'see sold listings' link opens an eBay sold search for THAT game (title/category not Pokemon); tapping the tile opens the detail modal already showing that game's card (not a Pokemon shell) before the row loads; Watch this price from the modal saves a watchlist row with the right game. Pokemon and Magic rows unchanged.

## 10-20 ~3:25pm ET: review 10-19 #12 grid sold-net uses saleNet (postage included), COMMIT ONLY
- 10-21 3:10am ET: half PASS: Chris's only sale (Samurott White Flare, by hand, $61.47) shows "$61.47 sold $61.47 · net" (full price, right). The postage case: no sale with a shipping method on his account (4 sold rows site-wide); waits for one.: the tile price, the `sold $X Â· net` line and the `you keep $X` button all show the SAME net the Earned tile uses (price minus fees minus postage), lower than before by the postage; a by-hand sale still shows the full sold price.

## 10-20 ~11:00am ET: B2 home stamp (76a19ae3) + B3 One Piece sets (96bc17b4) + Watch pill (b1241b1d), COMMIT ONLY
- After push, the morning after the next daily run (~5:10am ET): cardflip.io home + /scan say "Prices updated <today> 5:0x AM ET" the same morning (curl the home HTML for "Prices updated"), not the day before.
- After tonight's local sync + catalog push (no deploy needed): /cards/one-piece lists "The World's Strongest Warriors" ONCE (OP17, 161 cards), the starter decks keep their own names, order is newest first (OP17 Aug 28 2026 at the top, ST31-34 Jul 31 2026, EB03 Feb 2026...), and the sets memo/cache (seo:sets:v4:onepiece, SETS_TTL) has rolled; prod check: `SELECT COUNT(*) FROM tcg_cards WHERE game='onepiece' AND set_release_date=''` = 0 (PROMO/DON excepted) and the ghost groups query from scripts/_op-dups.mjs = 0.
- The nightly sync log (sync-onepiece) prints "onepiece sets: N code(s) renamed" (0 after the first night) and "0 code(s) given a release date" once all are dated; a new set (OP18 Nov 20) gets its date the night it appears.
- After push, card page bottom bar on the phone: Watch this price pill is small and right-aligned beside the price (docs/shots/watch-pill-signed-in-phone.jpg), signed in and out.

## 10-20 ~10:15am ET: two price fixes from the A3 pass (2876c06b lift break, d6f9f3b4 flagged -> backup), COMMIT ONLY, shots sent (docs/shots/lotus-2ed-card-page-phone.jpg, lotus-2ed-app-popup-phone.jpg), waiting for Chris's yes
- After push, app pop-up for Black Lotus Beta (LEB 233) and any Cardmarket-only Magic card: the chart starts Oct 20, no "up 12%" line (prod before: "▲ $3,107.47 (12.4%) 3M"); /api/price-history for 4a2e428c-dd25-484c-bbc8-2d6ce10ef42c cardmarket-converted series has points from 2026-10-20 only + dataDays.
- After push, Sunday mail / card alerts / Insights: no Magic Cardmarket-only card listed as "up 10-14% this week" from the 10-20 lift.
- After push, /cards/magic/unlimited-edition/black-lotus--2ed-233 shows Market price $17,560.09 labelled "Cardmarket (converted from €)" (no chart, noindex), not "This price looks off"; app Search Cards > Magic > Black Lotus: the 2ED tile shows the price; pop-up Market price + eBay suggested price; the table still lists the flagged TCGplayer row with its note.
- After push: the 534 "looks off" cards (10-13 sweep) that have a stored backup row now show it; count = `SELECT COUNT(DISTINCT card_id) FROM price_series WHERE source IN ('cardmarket-converted','cardkingdom','cardtrader')` joined to flagged ids (scripts/_lotus-peek.mjs as a start); spot-check 5 of them vs TCGplayer by eye.
- Open: Pokémon flagged cards with NO stored backup still blank (Cardmarket Pokémon is half of TCGplayer, not used); scan result headline (listing.ts headlinePrice) still 0 for a flagged market: next step if Chris wants scans covered too.

## 10-19 ~10:00pm ET: phone-check fixes #4-#6 (845ea9a2), PUSHED 10-20 in 2a4c00e4 (dev-server verified at 375px: docs/shots/sets-show-more-phone.jpg, card-page-bottom-nav-phone.jpg)
- [x] PASS 10-20 ~9:20am ET on prod, pane at 375px: all five games show 12 sets + the button (Pokemon 197 left -> tap -> 177 left; Magic 591, Lorcana 'Show 14 more · 14 left', One Piece 64, Yu-Gi-Oh 623); no sideways scroll (scrollWidth 375). Signed in: Charizard base1-4 page has the tab bar (Inventory/Search/Scanner/Watchlist/Account) with Watch this price above it, no overlap; signed-out HTML has no bar. Phone confirm by Chris = 3 taps, optional.
- After push, on the phone: /cards/pokemon (and the other four games) shows 12 sets then a "Show 20 more sets · N left" button (Chris 10-19: 20 more, not all); each tap adds 20 and the left count drops; the button disappears after the last set; no sideways scroll.
- After push, signed in on the phone: any /cards page shows the app's bottom tab bar (Inventory / Search / Scanner / Watchlist / Account); on a card page the Market + Watch this price bar sits right above it, nothing overlaps; signed out: no bar.
- PHONE-CHECKS step 4 now reads Market price only.

## 10-19 ~9:20pm ET: THE PRICE CHAIN built (priceChain.ts; Chris "yes build it"), COMMIT ONLY, no push yet
- LIVE 10-21 4:20am ET (prod read only): cardkingdom 79 Magic rows (last 10-20), none $1,000+; The Mind Stone msh 385 has no series at all (not $36,290); Enlightened Confidant pfra 5p CK nonfoil 7.65 / foil 8.86; Black Lotus lea 232 cardmarket-converted stepped 37,999.74 -> 42,453.65 on 10-20 (= x1.12 lift). FOUND: its page headlines $8.86 (foil) not $7.65: a tie inside one backup source took the first row -> fixed (10-21 ~4:25am block, commit only, VISIBLE). Not checked: the run-log line, the 30-day median label in /admin/prices.
- [ ] FAILED IN PART 10-21 3:40am ET (prod daily_last_result, scripts/_meta-peek.mjs): mtg shows tcgplayerFilled 2,858 + cardmarketFilled 732, NO cardkingdomFilled / cardtraderFilled: runMtgStep copied a subset -> aae6d9f3 (COMMIT ONLY, not visible). After that push + one nightly run: both keys present. The CK fills themselves work (79 rows, none $1,000+).
- After push, nightly Magic refresh (next run after the deploy): the run log shows cardmarketFilled, cardkingdomFilled (expect ~50 on day 1, dry run 51 of 1,256 blank released printings) and cardtraderFilled LAST; `SELECT source, COUNT(*) FROM price_series WHERE game='mtg' AND source='cardkingdom'` > 0; no $1,000+ cardkingdom row (out-of-stock placeholders skipped: The Mind Stone msh 385 foil must NOT be $36,290).
- After push, a Card Kingdom-filled page e.g. /cards/mtg/... Enlightened Confidant (pfra 5p, ~$7.65 / $8.86 foil) shows "Card Kingdom (adjusted)" as the price label and on the chart's source line.
- After push, Magic euro fills are lifted: a Cardmarket-only printing (Black Lotus lea 232 shows Cardmarket x1.12, i.e. ~12% above the 10-19 figure); Pokémon Cardmarket-converted pages unchanged (no lift).
- [x] CLOSED 10-21 3:30am ET (N/A as written): no screen prints the fallback (switched off on purpose in 6dc2461a "makes prices worse"), and /admin/prices never showed "fallback from". The guard does produce the label on prod data: scripts/_fb-measure.mjs pokemon = 47 of 184 flagged printings take "30-day median" (32 hard, 15 soft). FOUND doing it: Mewtwo Star blank -> 387e78ef block at the top.
- After push, a flagged card whose failed test had no reference: admin /admin/prices "fallback from" can read "30-day median" (only when the median is >10% away from the flagged number).
- 9bb74143 (same push): in the app, a card with both a live TCGplayer row and an eBay sold row quotes TCGplayer (scan result, card pop-up, Price Check, Wishlist); eBay sold shows only when TCGplayer's row is flagged, 45+ days flat, or missing.
- a34a418f (same push): scanner Printing pill highlights the chosen print; Done on the stacked sheet stays in the camera; swap note hidden.

- [ ] HALF 10-14 ~11:00pm ET (raw card: the Search/Watchlist sheet "View Sold on eBay" and "Buy on eBay" links carry -psa -bgs -cgc -sgc -graded -slab; /admin/prices half needs your /admin sign-in): After push: /admin/prices 'eBay sold' and a raw card's 'check sold listings' open eBay with '-psa -bgs -cgc -sgc -graded -slab' and no slab titles; a slab item's eBay link still searches its grade (e.g. PSA 9).
- [x] PASS 10-16 (curl: $939.50, no "looks off") 10-15: /cards/pokemon/crystal-guardians/charizard--ex14-4 shows $939.50 (hand keep POSTed 10-14 ~2:45pm ET; page copy was still "looks off" right after, cache).
- [x] PASS 10-16 (curl: no $968.91, no self-link) Card page "Other printings" strip: on /cards/pokemon/base-set/charizard--base1-4 it lists the page's own card and shows the HIDDEN $968.91 (seen 10-14 ~2:45pm ET). Fix = strip honours hides + skips self; recheck after the fix is pushed.
## 10-19 ~10:30am ET: sign-up takeover closed (94efdbb4) + cap-break history (99159765), COMMIT ONLY
- [x] COVERED BY TESTS 10-21 3:45am ET (live): test:sessionrevoke (stranger browser drops password + sessions; own browser keeps both) + test:emailverify E green on today's code; 94efdbb4 is on main. A live run needs a new account on cardflip.io, which I may not create; the next real cross-browser confirm can be read (users row password gone) read only.
- After push, takeover: sign up a throwaway test account in one browser (pane, local-dev values only, never a real inbox of Chris's), open its confirm link in another (curl POST /api/auth/confirm-email): that browser is signed in, the first browser's session is gone, the typed password no longer logs in, Forgot Password still works. Same browser: password + session stay.
- [x] PASS 10-21 ~12:10am ET (curl, live): no "Down" line, no 313.01, badge "Solid price · 154 days of data", "got more accurate on Oct 16, 2026" present, Market $109.16.
- After push, cap break: /cards/pokemon/hidden-legends/groudon-ex--ex5-93 has no "Down 62.6%", no $313.01 high sentence, badge still "Solid price · 153 days of data", line "CardFlip's price for this card got more accurate on Oct 16, 2026". Card pages are ISR-cached 48 h: recheck a cached one on ~10-21.
- After push: next Sunday mail / card alerts / Insights list no Pokémon (10-16/10-18) or Magic (10-13) cap cut as a move.

## 10-19 ~8:30am ET: morning checks (TASKS-10-18 #7/#24/#25/#33)
- [x] #7 PASS: 27 of 32 price_checked rows got tcg_day 10-19; base1-4 ($600 vs TCGplayer $724.99) + Lorcana crd_a08f… ($134 vs $122) retired themselves (within 25%, as designed). The 5 without a 10-19 note (Blaze 98fba951, ygo-38633/476972/78081/92623) have NO TCGplayer point since 10-13 = nothing to note; their check holds.
- [x] #24 PASS: Production smoke green 10-18 23:45 UTC, 10-19 02:07 + 07:42 UTC (the 21:51 failure was our own country gate, fixed d9118805).
- [x] #25 PASS (sane): heat 10-18 = 28 views / 6 tabs vs page_views 75 / 24 visitors (page_views also counts /home/tap + /home/stay10 events and /app; heat drops owner/admin + started mid-day); 58 taps, latest 7:22am ET.
- [~] #33 HALF: 10-19 push 204.7 s (was 446-549 s): mtg_cards 47,053 of 99,080 (real: 5 price columns move daily), tcg_cards 11,667 of 69,045; BUT mtg_sets 1,000 of 1,000 every night = Scryfall's daily ?epoch on icon_svg_uri -> fixed e00e8100 (sync-mtg strips it; runs from the working copy tonight, no push needed). 10-20 morning: mtg_sets line shows ~0 changed (one last full set push tonight as the links change once).
- [ ] (recheck 12:41am 10-22: /cards/magic/mystery-booster-commander-edition still 200 noindex "No card in this set has a current price", TCGplayer has not priced it yet; /cards/mtg/... 404 is the wrong slug) New set on the site: Mystery Booster Commander Edition (mbc, released 10-19, 77 cards) is in prod mtg_cards + the set list but has 0 priced cards, so /cards/mtg/mystery-booster-commander-edition 404s by design (thin page). Recheck 10-21: page live once TCGplayer prices it. CHECKED 10-20 ~11:50pm ET: /cards/magic/mystery-booster-commander-edition (slug is magic, not mtg) = 200, noindex, "No card in this set has a current price right now"; prod mtg_cards: 0 of 77 have a Scryfall USD/foil/EUR price, TCGplayer none = no source prices it yet. Recheck ~10-23.

## 10-19 ~12:45am ET: 84732733 Pokémon moves pause (cap 10-16/10-17) + 709c36a5 stage cards carry their id (UNPUSHED until Chris says)
- [ ] After push: re-render 7am (social-post.yml tiktok=1 tiktok_day=2026-10-19 tiktok_slots=morning tiktok_force=1); new social_tiktok:morning:2026-10-19 row is NOT Pokémon dips; every card on it sane vs its own 30-day series.
- [ ] 7:05am posts (`node scripts/_social-log-today.mjs`): no "Pokémon price drops"; slot did post (fallback kind).
- [ ] Next head to head / all-games video with a YGO stage card: frozen cardId's tcg_cards.price_usd == the price on the video.
- [ ] 10-25: Pokémon movers/dips are back (pause ends 10-24); then remove the CAP_PAUSES entries (Magic after 10-21 too).
- [ ] OPEN: 106 Pokémon card pages show a cap cut as "Down 60-80%" (data/crash-2026-10-19.json): decide the fix.

## 10-18 ~7:20pm ET: PUSHED 3bd3e4b6 (24 commits: trackers out of /app, PriceCharting fence, log cleanup in tcg-prices cron, referee matcher fixes incl. Japan Showcase, no owner [COPY] mails, Sunday mail averages line + checked cards out)
- [x] PASS CI run 39175798774 + Vercel success + Production smoke after deploy (39175866229) green.
- [x] 12:41am 10-22 (prod SELECT): 10-20 ET email_sends = scans 24 sent, 0 copy rows; the only copy row since 10-18 is the 10-18 6:30pm week digest (before the fix). Chris gets no [COPY] on scans mail.
- [x] PASS 10-18 ~7:25pm ET trackers: signed-in /app/collection loaded none (0 tracker requests); /pricing loads googletagmanager + analytics.tiktok.com + doubleclick as before.
- [x] 12:41am 10-22 (prod SELECT): settings log_cleanup_last = 10-19 5:28am ET (moved off 10-08); latest daily_last_result logCleanup {ran:false} = a weekday run, as designed. Cleanup ran the Sunday-night run.
- [ ] Weekly referee re-read: Japan showcase / textured / fracture foils get more asks; fewer false "Hidden by eBay" Magic cards.
- [ ] SUN 10-25 6:30pm digest: "How each game moved" line present when the subject says up/down; no hand-checked card in the rows.
- Smoke 21:51 UTC 10-18 FAILED = runner outside the allowed countries ("CardFlip isn't available in your country yet" on 4 API checks + admin 404), not an outage (site 200 from here, all other runs green). Fix next: smoke treats a country-gate 403 as "skipped", not a failure mail.

## 10-18 ~12:00pm ET: trackers out of the signed-in app (COMMIT ONLY)
- Found live: TikTok pixel + Google Analytics + Google Ads tag loading on /app/collection; privacy page says public pages only. No conversion fires in /app (signup + /scan are public).
- Fix (GoogleAnalytics.tsx): no tags when a visit starts in /app; ga-disable flags + ttq.holdConsent while in /app after a public page, grantConsent back outside. Local check with fake ids PASS (/ loads all 3; full load /app/collection none; / -> /app click: ga-disable true for GA + Ads).
- [x] PASS 10-21 ~3:36am ET (live, pane signed in, 8a8b5ad1 on main): /app/collection = 37 resources, 0 tracker requests, gtag + ttq undefined, ga-disable G- + AW- true; /cards/pokemon = gtag/js, TikTok pixel, doubleclick, Google Ads rmkt all load. Conversions: not checkable until the next ad signup.
- After the push: pane on cardflip.io/app/collection, performance entries show no analytics.tiktok.com / google-analytics / googleadservices requests; a public page still loads them; Google Ads + TikTok signup conversions still arrive (watch the next ad signup).

## 10-18 ~12pm ET: "Hidden by eBay" cards (pages that showed NO price) worked by eBay sold (prod writes done)
- Now a checked price (price_checked): Charizard GX BUS 150 $710.65 -> $350; Gyarados HGSS 123 rev $499.99 -> $170; Pikachu WotC promo 1 $499.99 -> $42; Metagross delta 11 $175.94 -> $48; Yu-Gi-Oh junk: Genex Ally Axel STBL $213,589 -> $2, Bujingi Crane MP14 $199,379 -> $1.25, Tower of Babel IOC $5,020 -> $1.50, Red-Eyes RP01 $680 -> $15, Hecatrice PP02 $197 -> $2.66, Scapegoat RP01 $192 -> $12.74, Dark Magician RP01 $145 -> $11.50, Sengenjin PP02 $120 -> $7.06, E-HERO Heat PP02 $250 -> $3.99, E-Hero Knospe PP02 $103 -> $4.24.
- Un-hidden ("keep", TCGplayer right): Mewtwo Star HP 103 $6,887.50, M Charizard EX FLF 108 $741.83, Shining Celebi unl $549.99, Palkia LV.X GE $174, Garchomp C LV.X $179.51, Luxray GL LV.X $115, Scizor ex UF $183, Team Aqua's Kyogre $290, 6 Hyperia City enchanteds (at/below their asks), Spider-Man #235 textured $479.52.
- Skipped: Shining Charizard 1st (sales are fakes), Darkrai & Cresselia LEGEND, Armageddon Unlimited.
- Batch ~12:45pm ET (s197): fixed Mewtwo LA 11 rev $309.82 -> $55, Mewtwo LV.X DP28 $278.48 -> $100, Scraggy McD 2016 holo $199.99 -> $65. Keep: Jirachi HL 8 rev $118.21 (NM sold 111-130; the cheap asks are played). eBay error page again after 5 searches (~12:50pm): paused to ~1:25pm.
- ~10-20 (page cache): those card pages show a price again; app search at once.
- 10-20 ~11pm ET (s209, pane signed in to eBay, 60 s apart): fixed Keldeo-EX BC 142 $140.65 -> $100 (15 raw sold 60-155, median 99.99; live page $100.00 at once). Fixed Lightning Energy COL 91 holo $116 -> $50 (13 NM raw sold 39.92-66.44; page headline stays Normal $40.00, Holofoil row $50.00). Fixed Yu-Gi-Oh: Ancient Gear Beast TLM-EN007 UTR 1st $179.99 -> $35 (NA 1st sold 20-95.80, median ~35; EURO 1st left out), King Dragun FET-EN036 UTR unlimited $153 -> $70 (one 69.99 VLP sale; 1st NM 82-90; the cheap asks are FET-JP036); both live at once with the eBay-checked note. More right ones for the keep queue: Palkia COL SL8 $289.99 (19 raw sold, median 270, NM 275-350), Lugia ex UF 105 $1,740 (MP sold 1,750/1,950, Excellent 3,000; the cheap asks are Italian/Portuguese/World Championship), Copycat RP01-EN092 $544.99 (= the 2008 original, NM sold 672.78; the asks are the 2020/2024 reprint, its own row ygo-564239 $25.97). REFEREE NOTE: the asks matcher mixes the 2008 Retro Pack with its reprint and Ultimate Rares with their Rare/Japanese twins (same number), so Yu-Gi-Oh! hides there are mostly false alarms. eBay searches 10-20: 19 of 20 (stopped). MAGIC TRIAGE (scripts/_hidden-mtg-triage.mjs, local, read only): of 139 hidden Magic cards, 85 have TCGplayer and Cardmarket agreeing within 40% (= the asks were the cheap printing; keep candidates), 47 disagree, 7 have no Cardmarket (LTR scroll silver foils). EVERY hidden page shows a price (scripts/_hidden-pages.mjs): the disagreeing ones fall back to the Cardmarket-based number with "Thin data - check eBay sold". Measured the fallback on 3: Cavern of Souls LCI 410a neon ink (no sales in 2 months; page $1,051.88 vs TCGplayer $4,900, CM agrees with the page) OK; Exalted Sunborn EOE 384 (sold 40-200, middle ~130; page $134.59 OK, TCGplayer $269.98 high); Codie FRA 422 Japan fracture (9 sold 139.99-250, median 200, last four 140-165; page fallback $73.13 = 55% LOW, TCGplayer $206.55 right) -> needs KEEP, not a check (a $165 check would rewrite 22 days of a TCGplayer history that tracked the real sales). Gandalf the White LTR 299 play promo ($3,073) + Sauron LTR 301 tourney foil ($3,377): Cardmarket EUR 2,447 / 2,686 agree = real rare promos, keep. DONE 10-21 ~4:05am ET (Chris signed in; "handle it in your own recommendation"): keeps POSTed for Snorlax col1-33 rev, Lugia ex ex10-105, Gandalf LTR 299, Codie FRA 422, Palkia COL SL8 (Codie + Palkia manual_price moved to today's 198.05 / 289.99, scripts/_keep-price-1021.mjs); all 5 show on /api/search-card at once, card pages on their next 2-day refresh. Sauron LTR 301 needed none (shows $3,377.09). Copycat: no current price at all (YGO 10-13 stop) = TASKS B2.1. Base Set Charizard page refreshed ($600.00 "Checked against recent eBay sales (29 sold)") via post-check undo + _put-check re-enable. KEEP QUEUE for Chris's /admin sign-in (POST /api/admin/prices call keep), most urgent first: Codie FRA 422 foil (53015f09-fcb8-448e-baf3-36524f4217a7), Snorlax col1-33 reverseHolofoil, Palkia col1-SL8 holofoil, Lugia ex ex10-105 holofoil, Copycat ygo-78162 normal, Gandalf LTR 299 nonfoil (3ae4a761-6203-419c-8d49-499b6e74252c), Sauron LTR 301 foil (fcd79da8-fc9d-4c9a-a340-06922a330ca9). Right, needs a "keep" once Chris signs in to /admin (admin login is his): Snorlax COL 33 rev $190 (NM sold 121-200, the cheap asks are played).

## 10-18 ~1pm ET: Hand check queue (388) worked by eBay sold, most valuable first (prod writes done)
- Fixed (price_checked): Mickey Mouse Iconic 241 $7,500 -> $3,000; Thomas O'Malley Ench 235 $515 -> $134; Lugia GX 227 $370 -> $245; Pikachu POP4 13 $369.63 -> $45; Kingdra delta 10 rev $289.10 (flat 31+ days) -> $92; Charizard SW 3 rev $310.62 -> $200.
- Keep (TCGplayer right, or already back in line today): Rocket's Mewtwo ex 99, Jolteon delta 7 rev, Gyarados HGSS 123, Ariel Ench 236 ($570 today), Aurora Ench 223 ($388), Tyranitar delta 16 ($318), Celebi ex 117 ($1,000; sold median 866, the old $370 was LOW), Rocket's Meowth 46 rev.
- Batch 3 keeps: Deoxys delta POP4 2 ($350; NM sold 400-527), Kyogre ex CG 95 ($349.99; NM sold 350-500).
- PATTERN: vintage EX-era flags are mostly false alarms (the asks include LP/MP/DMG copies; NM sells near our price). Real errors were new-set Lorcana (Hyperia City) and prices frozen for weeks (Kingdra, Pikachu POP4, Dark Charizard 1st). Next batches: Lorcana Hyperia City + flat-30-day cards first.
- Batch 4 (~12pm): fixed Spectacular Spider-Man #238 textured $252.25 -> $174. Keeps: D23 Mickey Brave Little Tailor ($218.58; 01/D23 sells 225-395, the asks were pins), Ariel CC1 ($136.88), Xiahou Dun P3K ($184.50; one NM- sold $299.99), Deoxys ex 98 ($300; NM 285-329), Spider-Man textured #236/#237/#240/#241, Llanowar Elves FDN 429 Japan showcase ($218.68; sold 200-241), Team Magma's Groudon ($150.83; the asks were the non-holo theme deck), Pikachu & Zekrom GX 184 ($248; NM 230-275, $1-40 = fakes). Skipped: Armageddon Unlimited (2 sales), Darkrai & Cresselia LEGEND (sales split $65-80 vs $225-515), Format Coconut Ariel (unreleased).
- ROOT CAUSES fixed in code (commit only): referee matcher now needs the treatment word or the card's own number for Magic textured / Japan showcase / fracture / surge / galaxy / halo / confetti / mana / silver foils, and rejects "Collectable ..." and "Fan Art" fakes. Plus (s197): "Japan Showcase" in a title no longer reads as a Japanese-language card for Japan showcase printings (FDN 429/436-441 etc.): after the push + weekly re-read their ask counts should rise. After the push, the weekly re-read should clear most false flags (yield of hand checks dropped to ~1 fix in 14 once the real errors were done).
- Batch 5 (Yu-Gi-Oh): fixed Raigeki LOB-053 1st $218.95 -> $107 (above every sale). Keeps: Left Leg LOB-121 1st ($270; NA print sells 275-345, the cheap asks are the EU LOB-E098), Harpie Queen FOTB UTR 1st ($108.88; sold 90-125).
- TOTAL 10-18 from the queue: 8 fixed, ~30 right (kept), 5 skipped (no clear sales). Yield fell to ~1 in 10 once new Lorcana + frozen prices were done; the rest waits for the weekly re-read with today's matcher fixes (after the push), then a fresh look at what is still flagged.
- Skipped: Raya Ench 240 (no English sale yet).
- Re-rank (scripts/_handcheck-rerank.mjs): 294 still >= 1.5x their eBay asks today; many are Magic special-art foils whose asks are the cheap version (Spectacular Spider-Man 236-241, Llanowar Elves FDN 429): check those by hand before trusting the asks.
- ~10-20: those card pages show the fixed numbers.

## 10-18 ~11:55am ET (Chris signed in to admin in the pane)
- [x] PASS live /admin/prices: "Post cards (all checked)": today's 1pm 5 + 7pm 5 marked Looks right via the route, survive reload. "Readers flagged" renders (0). Hand check queue = 388.
- [x] PASS heat: /admin pages and the /admin/heatmap frame (cardflip.io/ at 1280) wrote 0 rows in 10 min.
- [x] PASS Inventory on prod: live-prices 665 ms, value-history 431 ms (were 5.7/5.3 s), auth/me 1, watch/pending 1, categories 1 (1.4 s).

## 10-18 ~12:20pm ET: task sweep (prod data writes done; code COMMIT ONLY)
- [x] PASS live: the 4 checked pages show "Checked against recent eBay sales", no "Down 33.6%"; all 5 hubs show "Most valuable sets" (Pokémon: Skyridge, Legendary Collection, Base 1st...); 404s on made-up card/set/game; X-Frame-Options SAMEORIGIN; robots _rsc; privacy Oct 17; no "Log In as Admin"; /api/sets 105/71 ms; vision trial bad image 400; cron routes 403 without key; Pikachu 1st $187.13 "Few sales"; Ascended Heroes rows (energySymbolPattern 140); art-version points today; Cresselia $102.99; fx fresh; smoke green incl. 2am + 7am 10-18; uptime cron registered */15.
- ~10-20: card pages Charizard base1-4 ~$600, Dark Charizard 1st base5-4-1st ~$700, Blaze of Glory lea-6 ~$637, each with "Checked against recent eBay sales"; app search shows them now.
- Next Sunday-or-later tcg-prices cron (after the push): its response/daily_last_result has logCleanup {ran:true, deleted:{...}}, then settings log_cleanup_last moves off 10-08.
- [x] DONE 10-18 (Chris "yes delete them"): the 2 email_sends rows of an account deleted before the 10-17 fix removed; orphans now 0.

## 10-18 ~10:55am ET: PUSHED 89d80931 (Post cards on /admin/prices + heat map leaves out Chris/Claude + checks memo fix)
- [x] PASS CI (run 39136257696) + Production smoke (39136363676) green for 89d80931.
- [x] DONE my pane has ?heat=off (cf_heat_off=1); my 2 test heat_views deleted, prod heat tables now 0 views / 0 taps (clean start, nothing else to wipe).
- Prod /admin/prices (owner) shows "Post cards" with today's 1pm + 7pm and tomorrow's videos; mark today's 1pm (Tyranitar, Mew δ, Deoxys δ, Jigglypuff, Sabrina) + 7pm (Vivid Voltage 5) "Looks right" (all eBay-checked OK 10-18); reload keeps the marks.
- Heat: my pane opens https://cardflip.io/?heat=off; Chris opens it once on phone + PC (or signs in to admin once); after that no new heat rows from those browsers. Delete my 2 test rows from 10-18 ~9:45am ET.
- "Fix" with a sold price within 25% of ours says "eBay sold agrees ... marked Looks right" and writes no price_checked row.

## 10-18 ~9:25am ET: HEAT MAP live (admin /admin/heatmap, recorder on every public + app page; shots docs/shots/heatmap-1..3)
- After push: open any cardflip.io page on a phone, tap around, wait 10 s or switch tabs; prod SELECT `SELECT COUNT(*) FROM heat_views` / `heat_taps` grows; NO rows for /admin pages.
- /admin/heatmap (owner sign-in) on phone: Phone/Computer switch, range bar (24h/7d/30d/90d/Dates keep the device + page), pages table, the live page in the frame with taps painted; scrolling inside the frame moves page + paint together, header taps stay on the header; links in the frame do nothing.
- The frame itself never records (no heat rows, no visit count, no GA hit, no One Tap) — X-Frame-Options is now SAMEORIGIN: other sites still can't frame cardflip.io (curl -I shows SAMEORIGIN).
- Next day: "Left after one page" and per-page "Left here" look sane against /admin/analytics visitors.

## 10-18 ~9:45am ET: PUSHED 60498763 (price fix + heat map), CI + smoke + Vercel green; seed --prod DONE
- [x] PASS curl: Snorlax $43.00, Ninetales $200.00, Minun $23.33, Rare Candy $122.00 on cardflip.io card pages.
- [x] PASS prod heat_views gets rows (my test visit home -> pricing, beacon 204).
- OPEN: the 4 card pages were cached (ISR 48 h) by an instance whose checks memo was read BEFORE the seed: price right, but NO "Checked against eBay" note and stale change lines ("Down 33.6% over 90 days" Rare Candy, Minun "Down 36.9% / 30 days", high $189.17). Self-heals ~10-20 9:45am ET; recheck then. Cause fixed (memo no longer kept on a failed read), COMMIT ONLY, rides the next push.
## 10-18 ~9:10am ET: caught prices FIXED by a hand eBay sold check (price_checked, COMMIT ONLY, waits for Chris's yes on shots docs/shots/checked-1..4)
- After push, then `scripts/seed-price-checks.mjs --prod` (dry run 10-18: Snorlax 5 pts -> $43, Ninetales 3 -> $200, Minun 7 -> $23.33, Rare Candy 31 -> $122):
  card pages show those prices + "Checked against recent eBay sales (N sold)", no change words, chart starts at the fix (Rare Candy flat $122, no "-33.6%").
- App search / scanner for the same printings: market = checked price (`ebayChecked.was` = TCGplayer's number) while TCGplayer is >25% off.
- Next morning (10-19): prod `SELECT card_id, tcg_usd, tcg_day, off_day FROM price_checked`: tcg_day = 10-19 for each (nightly noted TCGplayer's raw number); a card whose TCGplayer number came back within 25% has off_day set, its page shows TCGplayer's own number and no note.
- Movers / set spotlight: a checked card no longer "moves" on TCGplayer's wrong number (then remove it from SOCIAL_PRICE_HOLD).

## 10-18 ~8:55am ET: Rare Candy bw10-105 held + set spotlight honours the hold (d25e24a2, PUSHED)
- 7pm ET set spotlight: the forced re-render (run 39129237480) landed on VIVID VOLTAGE, not Plasma Blast. All five eBay-checked OK 10-18 (NM sold): Rayquaza 138 $22.68 ($23-29), Pikachu VMAX 188 $169.36 (NM-labelled $155-190), Pikachu V 170 $42.99 (NM $39-45), PC Lady 185 $19.18 (~$19), Togekiss VMAX 191 $12.87 ($12-14). Check: the 7:05pm posts on all sites say Vivid Voltage too (same set as the TikTok file), no Rare Candy anywhere.
- 1pm list after the Minun re-render: Tyranitar, Mew δ, Deoxys δ, Jigglypuff, Sabrina gym2-20-1st $186.64 (eBay NM $200-270) all checked OK.

## 10-18 ~9:20am ET: social price hold list (772b6433 + 91ce940b, PUSHED 10-18 with 5162d3a7)
- 1:05pm ET posts (all sites + TikTok 1pm file): no Brock's Ninetales gym2-3-1st in the Pokémon gains list; the next card in its place checked against eBay sold.
- Any later 7am "Biggest Jumps" / 1pm gains / 7pm: no Snorlax xy0-26 (Kalos Starter Set) until it leaves SOCIAL_PRICE_HOLD in src/lib/server/social.ts.

## 10-17 ~9:30pm ET: admin sign-in never loops back to login (PUSHED 10-18 ~9:25am ET)
- After push: sign out of the admin console in Chrome, sign in again with password + emailed code -> lands on the Overview straight away, first try (no bounce to the login page).

## 10-17 ~9pm ET: push d11ec26d LIVE (Vercel READY, CI + Production smoke green)
- [x] PASS by curl: "Few sales" on Shinx pl4-SH12, Volcanic Eruption leb-89, 1st Ed Pikachu base1-58-1st (no more "looks off"); Vivillon $1.85 + High Plains $9.40; "Price looks wrong?" button on card pages; 3 made-up card/set/game links = 404; /api/cron/uptime without key = 403; vision junk = 400 "That isn't a picture"; wrong login = new wording (401).
- [x] PASS 10-17 ~9:20pm ET after Chris's admin sign-in: /admin/prices shows "Readers flagged (0 ...)" section; Vercel prod deployment lists cron /api/cron/uptime */15; its 3 probes pass by hand (home title, One Ring search, db). OPEN: a real "Too high" vote (classifier blocked my prod write: Chris taps it), and no scan on prod since 10:30am ET so the Pokémon read schema is unproven until the first real scan (Chris's phone check).
- Still open in the blocks below: phone checks, nightly-run checks (10-18/10-19 mornings), admin console checks.

## 10-17 ~8:10pm ET: rate limits hold across servers (A-H #29, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- After push: normal browsing (card pages, search a few cards, open Inventory) works with no "Too many requests".
- Prod SELECT a day later: `SELECT COUNT(*) FROM rate_limits WHERE key LIKE 'visit:%'` is far below the number of visits (only busy IPs get a row now; before, every visitor had one), and `search:%` / `catalog:%` rows exist only for busy IPs.
- Share a card from the app (Share picture) -> the picture loads; opening the same picture link again shows header `x-vercel-cache: HIT` (curl -I). 21 renders from one IP in 10 min -> the 21st is a 429.

## 10-17 ~7:45pm ET: nightly catalog push sends only changed rows (A-H #23, LIVE tonight: Task Scheduler runs the working copy)
- 10-18 morning: backups/catalog-sync.log has "pushing N changed of M rows" lines (tonight N = M: no fingerprints yet, the last full push), "done (failed:)", and data/catalog-push-state.db exists (~190k rows in `pushed`).
- 10-19 morning: the same lines show small N (new cards / changed pictures only, e.g. en_cards a few dozen, not 22,195), "catalog push finished in" well under the old 446 s, and remote counts still >= local (no "remote count ... < local" error).
- Prod spot check 10-19: a card added by the 10-19 sync (any new set) is on cardflip.io.

## 10-17 ~6:15pm ET: Pokémon scan reads the reverse-holo pattern and preselects it (#11 step 2, PUSHED 10-17 ~8:50pm ET in d11ec26d; screenshots owed before push)
- After push, phone: scan a Prismatic Evolutions Master Ball reverse -> Printing shows "Master Ball Pattern" and its price (not the plain reverse). A Poké Ball one -> "Poke Ball Pattern".
- Ascended Heroes theme-ball reverse (e.g. Erika's Oddish with the big Poké Ball behind the attack) -> that card's ball pattern; the big leaf/flame one -> "Energy Symbol Pattern".
- A plain card (no symbol) -> Printing unchanged from before (default line). Magic foil scan -> the saved Inventory price is the FOIL price straight away (scan-time quote now uses the picked printing).
- Admin scan ledger / logs: no new vision errors (Pokémon now uses POKEMON_READ_SCHEMA; a schema 400 would show as every Pokémon scan failing).

## 10-17 ~6:30pm ET: art versions are their own cards (#11 step 1; DATA LIVE on prod, code 47114b62 + 2109fd54 PUSHED 10-17 ~8:50pm ET in d11ec26d)
- Now (data live): /cards/pokemon/xy/vivillon--xy1-17 $1.85 (was High Plains' $9.40); /cards/pokemon/xy/vivillon-high-plains-orange--xy1-17-highplains $9.40; /cards/pokemon/base-set-1st-edition/pikachu-red-cheeks--base1-58-redcheeks-1st $429.98; /cards/pokemon/pokemon-go/bidoof-peelable-ditto--swsh10.5-059-peelable $17.30. All PASS by curl 10-17.
- OPEN until the push: /cards/pokemon/base-set-1st-edition/pikachu--base1-58-1st shows "This price looks off" because its series restarted today (1 priced day, vintage $187 = thin sign) and live code still blanks thin-only verdicts; the few-sales commit 2b43c844 turns that into "$187.13 + Few sales". Red Cheeks low/eBay rows already moved off it; prod has only the [187.13] series. After the push: curl it -> ~$187 with "Few sales", no "looks off" (deploy resets ISR; per-page refresh = POST api.vercel.com/v1/edge-cache/invalidate-by-tags with tag `_N_T_<path>`, worked 10-17).
- Morning after (nightly 09:45 UTC): prod SELECT price_series for xy1-17 / xy1-17-highplains / base1-58-1st / base1-58-redcheeks-1st / swsh10.5-0xx(-peelable) each get today's point with the SAME values as TCGplayer (Meadow ~$1.85 holo, High Plains ~$9.40, 1st Ed yellow ~$187, Red Cheeks ~$430, Peelables $14-17, plain PoGO reverse ~$0.3-0.7). No card takes the other's price.
- After push, scan: Vivillon 17/146 orange -> High Plains card; pink -> Vivillon. A plain reverse-holo Spinarak 006 -> plain Spinarak first, Peelable only offered in the list.

## 10-17 ~5pm ET: Ascended Heroes pattern reverses priced on their own (#11 part 1, 828b91b5, PUSHED 10-17 ~8:50pm ET in d11ec26d; screenshots still owed before push)
- Morning after the push: /cards/pokemon/ascended-heroes/rayquaza--me02.5-153 lists 'Friend Ball Pattern' (~$0.45) and 'Energy Symbol Pattern' (~$2.22) rows, no plain 'Reverse Holofoil'.
- Prod SELECT: `SELECT variant, COUNT(*) FROM price_series WHERE card_id LIKE 'me02.5-%' AND source='tcgplayer' GROUP BY variant` -> energySymbolPattern 140, poke/friend/love/dusk/quick/teamRocket ~140 together, reverseHolofoil gone.
- Editor Printing dropdown on an Ascended Heroes card offers both patterns.

## 10-17 ~5:15pm ET: last Art Series prices (task #46, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- Morning after the push (nightly Magic refresh): `node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_art-fill-dry.mjs` shows gaps 8 (5 Karlov Clues TCGplayer doesn't sell + Nefarious Imp, Treasure Keeper, Harness Infinity 27s); was 32. E.g. Gnoll Hunter aafr 11 ~$0.20, Aurelia amkm 46 ~$0.15.

## 10-17 ~5:30pm ET: thin-market cards show their price with "Few sales" (task #1, PUSHED 10-17 ~8:50pm ET in d11ec26d; shots docs/shots/few-sales-1..2)
- After push, phone: open /cards/pokemon/arceus/shinx--pl4-SH12 -> big price $165-ish, amber dot "Few sales · check eBay sold" under it (was "This price looks off").
- /cards/magic/limited-edition-beta/volcanic-eruption--leb-89 -> same note under ~$120.
- A hard-flagged card still shows "This price looks off" (any spike/Cardmarket-gap card from `node ... scripts/_few-measure.mjs pokemon out.json`, kind "blank hard").
- Inventory with a few-sales card: price shown with "Few recent sales. View Sold on eBay" under it, and it counts in the total.

## 10-17 ~3:35pm ET: "Price looks wrong?" on card pages (A-H #9, PUSHED 10-17 ~8:50pm ET in d11ec26d; shots docs/shots/price-report-1..3)
- After push, phone: open any priced card page -> grey "Price looks wrong?" under the price -> tap -> "Too high" -> "Thanks. We'll check it against real eBay sales."
- /admin/prices -> "Readers flagged" lists that card with "1 too high", the price it saw and an eBay sold link (not yet seen rendered: local console sign-in skipped).
- Tap again from the same phone -> still 1 vote (it changes, never stacks). Prod SELECT: `SELECT * FROM price_reports` has the row.

## 10-17 ~3:05pm ET: 15-minute uptime ping (A-H #57, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- After push: Vercel dashboard -> Settings -> Cron Jobs lists /api/cron/uptime every 15 min; its log shows runs at :00/:15/:30/:45 with `"ok":true` (the GitHub smoke only managed every 2-4 h).
- Without the key: `curl https://cardflip.io/api/cron/uptime` -> 403.
- Alert path is the same mail as the smoke failures ("CardFlip: Uptime failed"), at most once an hour; it now also sends when the database itself is down (test:uptime).

## 10-17 ~4:45pm ET: admin Sign Out really ends the session; 7-day limit (A-H #32, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- Right after push: the admin console asks you to sign in ONCE (old cookies have the old format; email code as usual).
- Then: sign in, copy the cardflip_admin cookie value (pane devtools), Sign Out, put the copied value back -> /admin goes to the login page. Your PC and phone sign-ins are separate: signing out on one leaves the other in.
- Prod SELECT: `SELECT COUNT(*) FROM admin_logouts` goes up by one per Sign Out and old rows drop off after a week.
- [~] HALF 10-21 ~3:38am ET (scripts/_sql-ro.mjs, read only): admin_logouts has 1 owner row (Sign Out 10-19 ~10:10pm ET, until 10-27) = the write works; drop-off due after 10-27. The cookie-replay step needs a Sign Out in the pane = ends Chris's console sign-in, so it waits for a time he signs out anyway.

## 10-17 ~4:15pm ET: other devices signed out on 2FA / email changes; sessions end after a year (A-H #31, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- After push, two browsers signed in to a TEST account (phone + pane): turn two-step on in Account on the phone -> the pane's next page load goes to /login, the phone stays in. Same for turning two-step off, and for changing the sign-in email (code typed on the phone). Your own account: you stay signed in on the device you did it on.
- Prod SELECT after a day: `SELECT COUNT(*) FROM sessions WHERE created_at < strftime('%s','now','-365 days')*1000` = 0 once those rows are next used (old ones are refused and deleted on use).
- [~] HALF 10-21 ~3:38am ET: the SELECT = 0 (61 sessions, oldest 08-11, none near a year). The two-browser 2FA / email-change step needs a test account on cardflip.io, which I may not create: covered by test:sessionrevoke (green 10-21).

## 10-17 ~3:30pm ET: refunds, chargebacks and failed payments (A-H #28, PUSHED 10-17 ~8:50pm ET in d11ec26d; Paywall copy changed, screenshot before push)
- After push (Stripe TEST mode only, never a live card): subscribe a test account with card 4242..., then in the Stripe test dashboard refund that payment in FULL -> within a minute the subscription shows Canceled in Stripe and /app shows the paywall. A PARTIAL refund on another test subscription: still Active, scans drop by that share. A test dispute (card 4000 0000 0000 0259) -> subscription Canceled.
- Failed renewal: a test subscription on card 4000 0000 0000 0341 goes past_due -> prod SELECT sub_past_due_at is set; it still scans for 14 days, then the paywall says "Your last payment didn't go through." with Update Card on top and no Subscribe button.
- Prod SELECT after deploy: `SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'sub_past_due_at'` = 1.
- [~] HALF 10-21 ~3:40am ET: the column SELECT = 1 (PASS). The Stripe TEST-mode flows need a test account on a preview deployment Chris names; prod is live Stripe (never a live card). Covered by test:webhook meanwhile.

## 10-17 ~2:45pm ET: eBay selling checks (A-H #27, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- After push: a trial (unpaid) test account gets "Publishing on eBay starts with a Booster or a subscription" on Send Offer / auto-offers on / reprice of a live eBay listing; End listing still works. Your own paid account: Send Offer + reprice still work on a live listing. The 2am daily job log (`autoOffers`) shows `unpaid` counted, nothing sent for unpaid sellers.
- [~] HALF 10-21 ~3:40am ET: the daily log carries autoOffers.unpaid (10-21 run: sellers 0, sent 0, unpaid 0 = nothing to gate yet). The trial-account wording and the second-account Connect need test accounts on prod (not mine to create); test:ebaygates green.
- Connect eBay on a second CardFlip account with an eBay login that is already linked to another CardFlip account -> /connect-ebay says "That eBay account is already linked to another CardFlip account..." (prod had 2 links, none shared, 10-17). A normal reconnect on the same account still works.

## 10-17 ~6:30pm ET: no account lookups through login/sign-up (A-H #30, PUSHED 10-17 ~8:50pm ET in d11ec26d; shot docs/shots/login-failed-message.png)
- [x] PASS 10-17 ~9pm ET by curl (the "wrong login = new wording (401)" line in the d11ec26d block); not re-run 10-21 on purpose: each made-up email counts toward the 24 h shut-out on Chris's own IP. Phone Google sign-in = his.
- After push: cardflip.io/login with a made-up email and a wrong password shows "Incorrect email or password. Signed up with Google or X? Tap that button instead." Same words for a real email with a wrong password. Real login and Google sign-in still work on the phone. Sign up with your own existing email once: still "An account with that email already exists."

## 10-17 ~6pm ET: input checks (A-H #33, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- After push: one real scan in the app on the phone and one free scan on cardflip.io/scan both read a card (photo check lets real phone JPEGs through). Turn phone notifications off and on in Account: still works. curl -X POST https://cardflip.io/api/vision/trial -d '{"image":"hello"}' -H 'content-type: application/json' = 400 "That isn't a picture", no free scan used.

## 10-17 ~5pm ET: per-account row caps (A-H #26, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- After push: scan-save, add to watchlist and a Search price check still work on prod (phone, one each). Prod SELECT: `SELECT name FROM sqlite_master WHERE name = 'idx_price_checks_user'` returns a row (made at deploy). Nothing in the error mail about rowCaps.
- [x] PASS 10-21 ~3:40am ET (read only): idx_price_checks_user exists; 0 error_events mention a row cap. The phone saves happen every day in normal use (no failures logged).

## 10-17 ~4pm ET: app pages ask /api/auth/me once (A-H #24, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- [x] PASS 10-21 ~3:40am ET (pane, signed in): /app/collection = /api/auth/me 1, /api/watch/pending 1. (Signed-out watch-then-sign-in = needs a sign-out, left.)
- After push, pane signed in on cardflip.io/app/collection: performance resource entries show /api/auth/me 1 (was 2) and /api/watch/pending 1. A "Watch this price" from a public card page while signed out, then sign in: the card is on the watchlist with the "Added to your watchlist" toast.

## 10-17 ~3pm ET: Pokémon price limit has no cliff (A-H #22, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- [x] PASS 10-21 ~3:40am ET (curl): Cresselia-EX bw7-143 $102.92, Victini-EX bw8-131 $166.74, neither "looks off".
- After push + the next nightly price run: /cards/pokemon/boundaries-crossed (Cresselia-EX 143) shows about 1.45x its cheapest TCGplayer copy (~$103 on 10-17, was $122.05), Victini-EX Plasma Storm 131 ~$167 (was $201.35). A card under 1.45x its cheapest copy keeps TCGplayer's number. No new "looks off" on those pages.

## 10-17 ~2pm ET: set lists never wait on a rebuild (A-H C0, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- [x] PASS 10-21 ~3:40am ET: last 12 Production smoke runs green except 10-20 9:35pm ET (TCGdex's image host failed one check, upstream blip, next run green); /api/sets 0.16-0.26 s x3.
- After push: the 2am + 7am ET Production smoke ("set lists load") stays green for 2 days (`gh run list -R truefreemoney-rgb/cardflip -w prod-smoke.yml`). `curl -w '%{time_total}' https://cardflip.io/api/sets` under 3 s every time, including the first call after 6 hours.

## 10-17 ~1:30pm ET: Watchlist picker counts + empty game (PUSHED 10-17 ~8:50pm ET in d11ec26d; shots docs/shots/wish/, Chris OK 10-17)
- Phone: Watchlist > the game pill says "Pokémon ·N"; pick a game with no cards -> "No Magic cards on your watchlist" + a "Show Pokémon (N)" button that switches back; "Name or number" fits in the search box; open the totals bar -> Alerts not under the arrow.

## 10-17 ~3:30am ET: exchange rates never go blank (A-H #16, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- [x] PASS 10-21 ~3:40am ET (read only): fx_rates date 10-20, rateAt for CAD/GBP/EUR/AUD/NZD all 10-20 8:24pm ET, triedAt set; Base Set Charizard page prints $600.00.
- After push + the next nightly price run: prod settings fx_rates (SELECT only) has rateAt for all 5 currencies dated today and triedAt set; Black Lotus page still shows a dollar price. Nothing new in the error mail unless a rate is over 2 days old.

## 10-17 ~2am ET: unsubscribe needs a tap (A-H #24, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- After push: open a real digest/update mail unsubscribe link on prod with a TEST account (owner): page says "Stop These Emails?" and the account is still subscribed (SELECT digest_off); tap Unsubscribe -> "You are Unsubscribed", digest_off = 1; set it back. Next campaign mail in Gmail shows its own Unsubscribe button at the top (List-Unsubscribe-Post header).

## 10-17 ~midnight ET: made-up card/set links = real 404 (A-H #21, PUSHED 10-17 ~8:50pm ET in d11ec26d)
- [x] PASS 10-21 ~3:40am ET (curl): made-up card / set / game = 404 "Page not found · CardFlip"; Charizard base1-4, Base Set, /cards/pokemon, movers = 200. (Phone taps = everyday use.)
- After push: curl -s -o /dev/null -w "%{http_code}" https://cardflip.io/cards/pokemon/base-set/not-a-card--zzz9-999 (and /cards/pokemon/no-such-set, /cards/notagame) = 404 with title "Page not found"; a real card, set, game and movers page = 200. Phone: tap into a few card pages from a set, they still open quickly (the loading skeleton is gone).

## 10-16 ~11pm ET: no built-in admin/password (A-H #23, PUSHED, live by 10-17 9:18am ET (90033b03))
- After push: the admin console still signs in on cardflip.io (uses ADMIN_PANEL_PASSWORD from Vercel, unchanged); /login shows no "Log In as Admin" button; no console banner about missing password.

## 10-16 ~10pm ET: privacy policy A3 (PUSHED, live by 10-17 9:18am ET (90033b03); shots in docs/shots/privacy-*.png, need Chris yes before push)
- [x] PASS (curl, the 10-18 live line "privacy Oct 17; no Log In as Admin" in the d11ec26d checks block).
- After push: cardflip.io/privacy shows effective date October 17, 2026 and the new lines (Google/X sign-in, help chat, phone notifications, email, Delete account path, what stays after a delete, Fastmail).

## 10-16 ~9:30pm ET: account delete takes the mail log + card-removal log (5299b9fe, PUSHED, live by 10-17 9:18am ET (90033b03); local test:deletesocial PASS)
- [x] PASS 10-21 ~3:40am ET (read only): orphans = 0, after the 10-21 junk-account deletes (16 + 3 + 1).
- After push: on prod, run (SELECT only) `SELECT COUNT(*) FROM email_sends WHERE user_id NOT IN (SELECT id FROM users)` once a deleted account exists, expect 0 for accounts deleted after the push. No phone test needed (the delete button itself is unchanged).

## 10-17 ~1am ET: price guard 1c, week's climb eBay asks don't back (b2a51efb, PUSHED 10-16 ~8:08pm ET; PASS ~8:20pm ET by curl: 3 hidden, Latias + Mewtwo shown)
- After push, curl each and expect "This price looks off": /cards/pokemon/lost-thunder/lugia-gx--sm8-227, /cards/pokemon/hidden-legends/regice-ex--ex5-97, /cards/pokemon/delta-species/tyranitar--ex11-16. Still a price (fair climbs): /cards/pokemon/celestial-storm/latias--sm7-107, /cards/pokemon/team-rocket-returns/rockets-mewtwo-ex--ex7-99. Lugia Secret Wonders + Tyranitar H28 stay shown (admin 'keep').
## 10-16 ~4pm ET: no extra rows sitewide (PUSHED, live by 10-17 9:18am ET (90033b03))
- Phone: Watchlist tab tiles, Search > My Watchlist, Inventory summary bar ("Show" stays; only the arrow when the totals are too long for it), homepage game tiles, a card page's price chart (date buttons always under the price on phones). Prices and the ▲/▼ % all stay on one line. Local check: iPhone WebKit shots at $99,999.99.

## 10-16 ~2:30pm ET: Watchlist price pill on one line (PUSHED, live by 10-17 9:18am ET (90033b03))
- Phone: Search tab > My Watchlist. Every tile shows the price and the ▲/▼ % on ONE line (Charizard $134.86 ▼ 5.0% was 2 rows). Tiles are a bit wider (142px). Local check done with test tiles up to $99,999.99.

## 10-16: FLIPBACK code + come-back mail (PUSHED, live by 10-17 9:18am ET (90033b03), b9ba3bd2..8cbfbacb). Local pass: link signed-out -> login -> +10 scans; Account box "already used"; header "10 free scans"; full npm test green
- [x] 12:41am 10-22 (prod SELECT): promo_redemptions is EMPTY, FLIPBACK redeemed by nobody so far (the 10-20 scans mail went to 24 people). Returning-visit count needs the admin Analytics sign-in (Chris).
- [x] DONE 10-16 ~12:10pm ET: preview 16, two [TEST] mails read by Chris (subject "Your CardFlip code is inside: 10 scans on us", no "free"), SENT 16/16, 0 failed; preview after = 0 (no repeats).
- [ ] Prod: password reset mail arrives (forgot-password) — local has no SMTP, unchecked.
- [ ] Prod: a returning trial user taps the mail button -> lands on scanner with N+10 free scans (watch promo_redemptions + admin Users).
- [ ] Prod: Inventory tiles load the ?w=400 copy (Network: ~20-40 KB each, not 300+ KB) on a real scanned photo.
- [ ] Prod: a Google sign-in of an existing account still lands signed in (b1190519 only touches unproven-email links).
- [x] PASS 10-16 local: /api/ebay/comps with id base1-4 + name "Magikarp" searches "Charizard 4" (audit #1).
- [x] PASS 10-16 local: /api/cron/emails?force=1 and /api/cron/social-video without a key -> 403 (audit #4).

## 10-16 ~1:30pm ET: junk "this week" moves (1pm head to head printed Alpha/Beta parked listings as -69%/-79%)
- [ ] 7pm post (all sites + TikTok 7pm video): no Magic "+x% this week" card; Magic shows at today's price only. Pause lifts 10-21 (MTG_CAP_DAY_END in social.ts: remove the check after).
- [ ] 10-17 1pm post: any card's "this week" old price is not a 30+ day flat number (read its series with scripts/_peek-series.mjs).
- [ ] Delete route: the 5 junk 1pm posts (Bluesky/X/Facebook/Instagram/Threads) are gone; Instagram may need the app by hand.

## 10-16: Inventory speed (PUSHED, live by 10-17 9:18am ET (90033b03), 2b110bac price guard "+game"; a6313308 folders once)
- [ ] After push, mine: pane signed in on cardflip.io/app/collection, performance entries: /api/cards/live-prices and /api/cards/value-history under ~1 s each (were 5.7 s / 5.3 s), /api/cards/categories once. Also a card page + /cards/pokemon set page still load (same guard code).

## 10-16: cookie bar above the phone tab bar (PUSHED, live by 10-17 9:18am ET (90033b03), 605458fe; Chris approved the screenshots)
- [ ] After push: only UK/IE visitors see it, so mine: pane at 375px on cardflip.io/app with sessionStorage cf_geo="GB" and no cf_consent cookie → bar sits above the tabs, tabs tappable.

## 10-16: number keypad on price boxes (PUSHED, live by 10-17 9:18am ET (90033b03), d326a66b)
- [ ] Chris, phone, after push: 1. Open Inventory. 2. Tap a card's "What did you pay?" (cost) box. You should see a number keypad with a "." key, not the letter keyboard. Same for the sold-price box.

## 10-16: duplicate-email fix, audit #9 (PUSHED, live by 10-17 9:18am ET (90033b03), eb95dd75). Local: test:campaigns + test:digest green incl. two overlapping runs
- [x] PASS 10-22 8:30am (pane): week Oct 18 = 22 sent / 22 people, no repeats;  `SELECT COUNT(*) FROM email_claims` > 0. (Mine.)

## 10-16 ~9:30am ET: site-audit fixes (PUSHED, live by 10-17 9:18am ET (90033b03), ddea8db2..36c2e6a5; docs/AUDIT-2026-10-16.md)
Mostly server guards, proven by local tests; these are the prod checks after the push.
- [ ] eBay comps (#1): on a card page / scan result, "eBay listings" still loads comps for a Pokémon and a Magic card (catalog lookup in front of the cache). (Mine, pane.)
- [x] 10-22 12:40am: curl https://cardflip.io/api/cron/emails -> 403. Cron routes (#4): `curl -s -o /dev/null -w "%{http_code}" https://cardflip.io/api/cron/emails` → 403 even when signed in to /admin in the pane (open it in the pane: 403). The 10am/6:30pm mail sweep and the 9:15pm TikTok net still run (Vercel cron with the key): check /admin Log next morning. (Mine.)
- [ ] Stripe $0 (#7): no live check needed unless a 100%-off code exists in Stripe; next real renewal still credits scans (watch the Errors page / stripe log). (Mine.)
- [ ] eBay quantity (#10): next real card push lists Quantity 1 on eBay. (Mine, eBay Seller Hub view.)
- [ ] Login lockout (#5): 11 wrong passwords for a test email from one network → 429; the same email from another network still answers "Incorrect email or password". (Mine, curl with two IPs is not possible on prod; trust tests unless a lockout ticket shows up.)
- [ ] Google/X link (#3): nothing to see; tests only.
- [ ] Scan give-back cap (#6): a normal seller's "No match found" still gives the scan back (watch the header counter go back up after a miss). (Chris, phone, next scan session; just notice.)
- [ ] Inventory thumbnails: /app/collection on a phone, tiles show the seller's photos sharp at tile size; DevTools/network shows card-image?…&w=400 at ~20-40 KB each; tapping a card still opens the full photo; eBay push still sends the full photo (no w). (Mine, pane at 375px, SCREENSHOTS TO CHRIS BEFORE THE PUSH.)
- [ ] Inventory chart: one /api/cards/value-history request per visit (was two). (Mine, pane network.)
- [ ] Trial ration: a normal new signup still gets the 5 free scans (watch the next real ad signups in /admin funnel: trial_scans_used 0 on fresh accounts). If several real signups from one carrier land on the Booster wall, raise TRIALS_PER_BLOCK_DAY (signupGuard.ts, now 5). (Mine, /admin.)

## 10-16 ~3:05am ET: scanner screen + earlier unpushed batch (PUSHED 3f3ba57f 10-16 ~3:05am ET)
- [ ] Scanner (phone, cardflip.io/app, Scan): corner brackets only, no moving box, no green; above them "Line the card's edges up with the corners". Too dark / glare shows the amber hint there instead.
- [ ] Scanner: a binder card in its pocket scans as the card (no "slab"), three times in a row. (Tap crop grows at most 8 % past the guide now.)
- [ ] Scan result facts panel: label reads "List it at", link "vs N listings" (shows after a real scan + "Yes, this is my card").
- [~] CODE-CHECKED 10-16 (SessionProvider keeps window.location.search; live run needs a sign-out, skipped) Login keeps the link's query: open cardflip.io/app?x=1 logged out, sign in, you land on /app?x=1 (15698b36). (Mine, pane.)
- [ ] Emails with card pictures (price alert, digest): pictures load from cardflip.io/pics, not Scryfall / tcgdex (dcc21110). (Mine, /admin emails test send.)
- [ ] /admin emails: the test button counts seconds while a slow email builds (f08f46b7). (Mine, pane.)
- [x] PASS 10-16 (curl 404) /api/dev/outline-dump answers 404 on cardflip.io. (Mine, curl.)

## 10-15 ~2:00pm ET: fixes found while working the open-tests list (in the 10-15 batch push)
- [ ] Ad signup (A36): from cardflip.io/scan, Sign Up, finish: you land in the app with the SCANNER OPEN (it landed shut since 10-06). Close it, go to Inventory and back: it stays shut. (No new account for Chris and none made by me on prod: proven on local dev; on prod watch the next real ad signups reach a scan in the /admin funnel.)
- [x] STALE 10-22 8:30am: Insights has no value chart any more (page renders at 375px); Opposition Agent shows its foil price there too. (Mine, pane.)
- [ ] /scan used visitor (A1): no flash of the Scan button before "Your free scan is used". (Mine, headless on prod.)
- [ ] Failed scan message reads "Couldn't read this card — retake..." with no "(0% sure)".
- [x] PASS 10-16 (curl 404) /api/dev/outline-dump answers 404 on cardflip.io. (Mine, curl.)

## 10-15 ~9:45am ET: scanner options button, game + card + scanner options in ONE sheet (PUSHED, live by 10-17 9:18am ET (90033b03), 3e8e0caa; Chris: keep them combined)
Phone steps: 1) Open the scanner. 2) Tap the "..." circle top right. You should see "Scanner options": Game chips (all five fit), New scans start as (5 conditions), Camera (Light on phones with one, Tips switch), Share, Help. 3) Tap Lightly Played, Done, scan a card: it starts as Lightly Played. 4) Tap Share: the phone share sheet opens with cardflip.io. 5) Help > Open lands on the help page.
- [ ] Sheet opens from the "..." button, nothing cut off at phone width
- [ ] Starting condition sticks on the next scan; Light switch turns the light on; Tips switch brings the tips back
- [ ] Share opens the phone share sheet; Help opens the help page

## 10-15 ~9:00am ET: scanner "Select Your Card" picker restyled (PUSHED, live by 10-17 9:18am ET (90033b03), 69f340c5 on top of the 5 scanner commits)
Phone steps: 1) Scan any card. 2) On the result card tap "Not this card?". You should see a sheet titled "Select Your Card" with a "Find matches" box and a Search button on top, then two columns of big card pictures with the name, set and number under each. 3) Tap one: the sheet closes and the result card swaps to it. 4) Open it again, type a name (e.g. "charizard"), tap Search: the grid fills with that name's printings. 5) Swipe the handle down: it closes.
- [ ] Picker opens, pictures big and sharp, names/sets wrap (no cut-off text) at phone width
- [ ] Tap a picture swaps the card; search by name fills the grid; swipe-down closes

Things that shipped but were never exercised on a real phone or with real
traffic. Tick when tested; note what you saw. Newest batch first.

## 10-14 ~11:35pm ET: Magic hub phone overflow + Yu-Gi-Oh! tile alt text (PUSHED, live by 10-17 9:18am ET (90033b03), 7528e5ec + the next commit)
Found while ticking A22 in the pane at 375px: /cards/magic measured 386px wide (11px sideways scroll) because the Sets list's single phone column is auto-sized and the nowrap name "Teenage Mutant Ninja Turtles Source Material" widened it; /cards/pokemon was 375. Fix: grid-cols-1 on the list (minmax(0,1fr)); the same class change proved 375 live in the pane DOM. Also the homepage games strip Yu-Gi-Oh! tile alt text now drops "(Worldwide English)" like the visible name.
- [x] PASS 10-22 8:30am (pane at 375px): 400 set links, 0 overflow, 398 end in an ellipsis, scrollWidth 375; /cards/pokemon unchanged.
- [ ] PROD: homepage HTML has no "(Worldwide English)" anywhere (curl).
## 10-14 ~9:00pm ET: robot upgrade (Sonnet 5.5, objections sheet, escalation, 3 actions, thumbs, /admin/robot, replay test) + price-page links in the app (PUSHED 1eb76012 10-14 8:58pm ET after Chris approved the screenshots)
Chris: "do them all and push" on the six robot ideas, then "if you can fit it without causing row and overlapping issues" on the card-page links, then "can i get screenshots before you push". Code: HELP_MODEL claude-sonnet-5-5, effort low, max_tokens 1500; OBJECTIONS sheet (10 lines) as a cached system block; rule: first unhappy money/limit message = heard + free path + offer the human, no second explanation; actions {{giveback}} (re-checks the last 15 min of scans with giveBackNoMatchScan, result line replaces the tag), {{resend_code}} (issueAndDeliver, only when unconfirmed), {{card:Name}} (button "Find <name> in Inventory" -> /app/collection?q=<name>, Inventory reads ?q= on mount); account facts now list the 8 newest cards + removals in 7 days; help_messages.rating + POST /api/help/chat/rate + Helpful/Not helpful under each robot reply; /admin/robot lists 7 days of chats (thumbs-down first, then stuck, then newest) with the thread, linked from the overview's Help chat tile; scripts/test-help-replay.mjs replays scripts/help-replays/*.json against the real model when ANTHROPIC_API_KEY is set (SKIPs otherwise; not in npm test). Search: "Want to wander by set? Browse the Card Prices pages." under the set tiles; card sheet (Search, Inventory, Watchlist): "Full price page →" beside MARKET -> the public card page. Tests: helpchat (pins updated + 14 new checks), apiauth, emailconfirmui green; tsc + eslint clean.
- [x] PASS 10-14 9:05pm ET (pane, Chris's account, 1eb76012 live): Jenny's words -> "Seeing prices is free: type a card's name in Search Cards ... scan only the ones you can't." + Open Search Cards button; "but why" -> "That's fair: you want to find out what your cards are worth without spending anything, and Search Cards still does that for free. If you'd like a person to hear this, I can open a support ticket ... Want me to open one?" + ticket button. No second price explanation, no "other apps".
- [x] PASS 10-14 9:06pm ET: "my last scan found nothing, did it count against me?" -> explains the auto give-back, then "I checked: no scans in the last 15 minutes to give back." No {{ }} shown. Chat cleared after.
- [x] PASS 10-14 9:35pm ET (pane: "where did my Sylveon ex go" named all three copies + the button). FOUND: the button value carried the set ("Sylveon ex (30th Celebration 153)"), so the Inventory filter would miss; fixed locally (name only in splitReply + prompt), NOT PUSHED, batch with the next push. Recheck after: the button reads "Find Sylveon ex in Inventory" and Inventory opens filtered.
- [ ] PROD, phone: Helpful / Not helpful under every robot reply; tapping sticks (reload keeps it); /admin/robot shows that chat first with "1 not helpful".
- [x] PASS 10-22 8:30am (pane): link -> /admin/robot, 0 "ET ET"; 0 chats this week so nothing to expand.
- [ ] PROD, phone: Search tab idle: the Card Prices pages line under the sets, nothing clipped; opened card: "Full price page →" sits right of MARKET on one line, opens the public page for that printing (308 to the exact set is fine).
- [ ] PROD, phone: Inventory, open a card: same "Full price page →" link; Watchlist sheet too.
- [ ] Local with a key some day: `npm run test:helpreplay` (Jenny replay, ~3 model calls) passes.

## 10-14 ~8:50pm ET: "Prices are free" on the out-of-scans wall, Search Cards open after the trial, robot says it first (PUSHED 6714a500 10-14 8:33pm ET)
Jenny's ticket #1001 ("why do we all need to buy it if we just want to see the prices"): she hit the wall after 5 scans and nothing told her lookup by name is free; the robot repeated the prices three times and said "same model most apps use". Chris: "make your recommended changes also". Code: SubscriptionGate opens /app/price-check for a walled account (server still 402s a save); Paywall (trial, not lapsed) gets a "Just want a price? That's free." box with a Search Cards button above the plans; robot rule: prices free / scans paid, say once, link Search Cards, never argue or compare to other apps; scan-limits help article gets the same sentence. Tests: emailconfirmui (gate pin updated), helpchat, quota green; tsc + eslint clean.
- [ ] PROD after the push, phone, an account with 0 trial scans (Jenny's view): /app shows the wall with the "Just want a price? That's free." box first; Search Cards button opens Search and it works (name search, prices); Scanner still walled.
- [ ] PROD: the same wall for a LAPSED subscriber has no free-price box (plans only).
- [ ] PROD: robot, as a 0-scan trial account, "why can't I just have free scans": first reply says lookup by name is free and offers Search Cards, no second price list, no "other apps" line.
- [ ] Jenny: watch for a reply on ticket #1001 (Chris answered 8:29pm ET; mail goes out on reply, she is Google-verified).

## 10-14 ~8:20pm ET: scanner Xs redesigned: row "Clear" keeps the card, delete only in the card view, top X is "Done" (PUSHED c787d5b0 10-14 8:23pm ET)
Chris (phone screenshot, Sylveon rows): the × on each scanned row deleted the card from Inventory with a 5-second Undo, and sat under a top × that just leaves the scanner; Jenny tidied her list with them and lost all 5. Chris: "let's go with your picks". Now: (1) the row control is a small "Clear" pill (list row, the reveal chip after a scan, Verify All rows); it only takes the row off the list, the card stays in Inventory, toast "Cleared <name> — still in your Inventory" with Undo; a row cleared before its save landed still saves. (2) The only delete is the card view's "Remove from Inventory" button, which opens the in-app confirm "Remove <name> from your Inventory? Scanning it again uses another scan." / red "Remove card"; toast "Removed <name> from your Inventory" with Undo. (3) The top-right × (went to Inventory) is now a "Done" pill, same action. First version (confirm on the ×, f024dbd6) was replaced by this in the same evening.
- [ ] PROD after the push, phone: scan a card; the row's right side reads "Clear" (no ×); tap it: row gone, toast says still in Inventory, Inventory shows the card.
- [ ] PROD, phone: open a card, "Remove from Inventory" at the bottom: the sheet names the card; Cancel keeps it; Remove card removes the row and the Inventory card (Undo toast, 5 s).
- [ ] PROD, phone: the reveal chip right after a scan and the Verify All rows show "Clear", same behavior.
- [ ] PROD, phone: top right of the scanner reads "Done" next to Connect eBay / Send to eBay and lands on Inventory; nothing wraps at 375px.
- [ ] PROD: a "No match found" row's Clear just clears, toast "Cleared".

## 10-14 ~8:15pm ET: removal log in the admin console + save-failed line (PUSHED c787d5b0 10-14 8:23pm ET)
Chris: "why 5 trial scans but 4 cards" (Jenny jporter1421) -> later "why did her cards go to zero". Prod card_removals (live since 10-13) answered it: she deleted the Umbreon at 7:58pm ET and the other four at 8:05pm ET herself (bulk, after tapping Looks right on each). Code: /admin/users Cards cell shows "N removed" (grey) and "N save failed" (amber) under the count, phone row too; new POST /api/cards/save-failed writes a card_removals row (how = 'save-failed', card_id = the scan id) when both tries at POST /api/cards came back empty after the card showed. Charge rule unchanged. Tests: test:cards (4 new checks), test:apiauth, test:adminroutes, test:admin green; tsc + eslint clean.
- [ ] PROD after the push: /admin/users, Jenny's row reads 0 cards with "5 removed" under it; the phone layout shows "5 removed" in the small line.
- [ ] PROD: an account that never deleted anything shows only the count (no extra line).
- [ ] Later: first "save failed" line on any account -> open that user's card_removals row and the matching scan_usage id; decide the refund-unkept question after a week of rows.

## 10-14 ~4:15pm ET: page review fixes (chart label, printings strip, set names, homepage Card Prices block, game tabs) (PUSHED c787d5b0 10-14 8:23pm ET)
Chris asked for a review of the homepage, /cards/pokemon and the 1st Edition Charizard page, then "yes on everything". Code: chart header prints the variant through formatVariantLabel ("Market · 1st Ed. Holofoil", was "1stEditionHolofoil"); the "Other <name> cards" strip is cached per name WITHOUT the page's own card excluded and filtered at read time (the old v2 memo excluded only the page that built it, so every sister page listed itself); a hand call on /admin/prices now drops that card's cached lists (set top, other printings, game top: dropCardLists) so a hide shows on the next page build; set names print "Trainer Kit" / "Best of Game" (tidySetName, sets memo bumped to v4); homepage games strip drops the Yu-Gi-Oh! "(Worldwide English)" qualifier; new homepage section "Know the card? Look it up." with the five game hub pills + All Card Prices + Price Movers, between Every game and Built for the pile; game hub pages get a game tab row (current lit) above the search. Local: tsc + eslint clean, cardpages 288/288, listcache, adminroutes green; pane desktop + 375px checked.
- [x] PASS 10-14 8:30pm ET (curl: "1st Ed. Holofoil" in the page, no raw 1stEditionHolofoil in text): PROD after the push: /cards/pokemon/base-set-1st-edition/charizard--base1-4-1st chart header reads "Market · 1st Ed. Holofoil"; a reverse holo card reads "Reverse Holofoil".
- [x] PASS 10-14 ~10:10pm ET (curl: 12 sister links, no self, no Base Set link, no $968.91): PROD: same page, "Other Charizard cards" no longer lists the 1st Edition itself and no longer shows the hidden Base Set $968.91 (first visit rebuilds the v3 memo with the hide applied).
- [ ] PROD: /admin/prices, hide any cheap card, then open its set page + a sister printing's page: the number is gone right away (not a day later).
- [x] PASS 10-14 8:30pm ET (curl: both names present; H1/breadcrumb not yet eyeballed): PROD: /cards/pokemon sets list reads "SM Trainer Kit (Alolan Raichu)", "Best of Game"; the set page H1 + breadcrumb match; links still open (slug unchanged).
- [ ] PROD, phone: homepage section after the games strip: eyebrow Card prices, "Know the card? Look it up.", five pills (Pokémon ... Yu-Gi-Oh!), "All Card Prices · Price Movers" line; pills open the hubs.
- [ ] PROD, phone: /cards/pokemon shows the five game tabs under the intro, Pokémon lit; tapping Magic opens /cards/magic with Magic lit.
- [x] PASS 10-14 ~10:10pm ET (curl: visible text clean; only the picture alt text still had it, fixed locally, not pushed): PROD: homepage games strip Yu-Gi-Oh! tile set name has no "(Worldwide English)".

## 10-14 ~4:10pm ET: phone nav shows How It Works / Features / Card Prices (PUSHED c787d5b0 10-14 8:23pm ET)
Chris (phone, logged out): the top nav was missing the three page links; they were hidden under sm on purpose. Now every link shows on phones and wraps into two rows (search + the three pages, then Pricing / Log In / Get Started); header about 40px taller. Pane 375px: no sideways scroll, rows balanced.
- [ ] PROD after the push, phone, logged out: home nav row 1 = search, How It Works, Features, Card Prices; row 2 = Pricing, Log In, Get Started; nothing clipped; same on /features and a /cards page.
- [ ] Phone, logged in: row 2 reads Pricing, Log out, Open the App.

## 10-14 ~3pm ET: suggested price follows the seller's shipping pick everywhere (PUSHED c787d5b0 10-14 8:23pm ET)
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

## 10-13 (added to this list 10-14 9:15pm ET, was missing): Yu-Gi-Oh exact-printing pictures + Magic TCGplayer-only run + backup during writes
Commits 4057fc76 (1,426 Yu-Gi-Oh rows TCGplayer has no scan of get exact-printing pictures from Yugipedia + CardTrader, screened by eye; PUSHED 83ddd479 10-13), d92fd959 (189 more, 44 still borrow a sibling's picture and retry nightly; PUSHED 30615a64 10-14 ~5:20am), ca474dfe (the Magic picture run is TCGplayer-only, no Scryfall fallback; PUSHED 83ddd479), cd3b08ff (the nightly backup survives live writes during the copy; PUSHED 83ddd479).
- [x] PASS 10-14 ~10:25pm ET (5 random sets, 284 tiles keyed to their own id, 20 eyeballed, no SAMPLE): PROD: open 5 random Yu-Gi-Oh set pages (/cards/yugioh/...): every tile is a picture of THAT printing (set code on the card matches the set), none a SAMPLE stamp or a sibling's art.
- [ ] 10-15 2am log: the nightly run's Yu-Gi-Oh line shows the 44 borrowers retried (count went down or "0 failed").
- [ ] PC backup log (nightly): one run completed while the catalog run was writing, no "database is locked" line.

## 10-13 ~6:45am ET (added to this list 10-14 9:15pm ET, was missing): asking-only TCGplayer prices over $20 blank; serial-numbered cards skip the 15x guard (4d494331, PUSHED 83ddd479 10-13)
Chris's rule (memory cardflip-odd-prices-check-ebay): a price that is only an asking price, over $20, shows nothing rather than the ask. Applied to the Yu-Gi-Oh daily + weekly fills and the Magic fill; serial-numbered Magic cards (1/500 style) are allowed to be 15x their printing without being blanked.
- [x] PASS 10-14 ~10:25pm ET (Hamon Unlimited, TCGplayer ask $350 no market, and B.E.S. Covered Core $99.99: no price; Uria 1st keeps $999.97, real market price): PROD: a Yu-Gi-Oh card with no sold data and a TCGplayer ask over $20 shows no price (card page says the price is unsure / blank), under $20 still shows the ask.
- [x] PASS 10-14 ~10:25pm ET (Bitterbloom Bearer Lorwyn Eclipsed #352 serialized foil $2,964.84 vs $13-31 normal): PROD: a serial-numbered Magic card (e.g. a 1/500 Secret Lair serialized) keeps its high price instead of being blanked by the 15x guard.

## 10-13 ~3pm: every card picture from our storage (PUSHED 83ddd479)
Chris saw blank One Piece hub tiles: the hubs' "most valuable" lists were cached 10-12 7pm ET (before pictures) with optcgapi links, which lists hide. Fixed: 22,946 stale card_cache tile lists deleted on Turso (seo:top/settop/printings/movers/namelist); 3,636 One Piece prod rows still had the optcgapi image_url (10-12 twin-first change was local only) -> copied from local; code (ee70b040): set completion, Magic big picture (scanner tiebreak keeps Scryfall via mtgReferenceImage), homepage featured card + wall, scan stage cards, email movers; 83ddd479: saves (cards, edits, watchlist, price checks) store our copy (ownPictureUrl); 143 old prod user rows rewritten to cardflip.io/pics (12 left: 11 blank no-id rows, 1 Japanese card). Dev: hubs, homepage, /scan, movers = 0 outside pictures, 0 blank; 100/100 tests.
- [ ] PROD after the build: /cards/one-piece, /cards/pokemon, /cards/lorcana: 12 of 12 tiles show, all src cardflip.io/pics (curl count of outside hosts = 0).
- [ ] PROD: homepage hero card + wall + games strip all /pics.
- [ ] PROD: Chris's Inventory + Set Completion + Watchlist pictures all load (right-click = cardflip.io/pics).
- [ ] PROD: scan a Magic card: the tiebreak still identifies (now reads mtgReferenceImage).
- [ ] Open: One Piece top tiles are SAMPLE-stamped alt-art scans (TCGplayer has nothing cleaner); retry for clean scans in the auto new-cards job.

## 10-13: nightly eBay referee + /admin/prices "Price checks" (PUSHED 83ddd479 10-13 ~1:30pm ET)
Chris 10-13: "make the daily price check against eBay automatic". Every $100+ printing (4,550 on 10-13: Magic 1,801, Pokemon 1,527, YGO 640, One Piece 424, Lorcana 158) is read against eBay's ACTIVE fixed-price listings (Browse API; sold data is denied) up to 900 calls a night, 8:15am + 8:45am ET (cron /api/cron/ebay-referee, 12:15 + 12:45 UTC). lib/ebayReferee.ts = printing-aware matcher + rule (hide at 1.5x the upper NM asks with 3+ asks; vintage pre-2010 needs 3x; 100x one ask); table ebay_asks; priceTrust test 0 (admin call) + 1b (eBay high). Prize sets, unknown rare tags, One Piece special versions and Lorcana/OP promo sets are never auto-hidden (>= $2,000 they go to the hand-check list). Calibrated on 58 eBay-SOLD-checked cards: 4 of 17 bad caught, 0 of 27 good hidden. Local run (366 read, 500 calls, 85 s): 13 hidden (Genex Axel $213,589, Bujingi Crane $199,379, Green Baboon $194,450, Tower of Babel $5,020, foil Llanowar Elves $954 ...), 91 to hand check. Pane: /admin/prices renders desktop + phone (folds, no side scroll); "Right, keep" moved Mewtwo Star to Your calls and the guard showed it; Undo put it back.
- [ ] PROD after the push: Vercel cron list shows /api/cron/ebay-referee twice; the next morning /admin/prices says "Last run ... read" with ~400-450 cards and ~900 calls, 0 failed.
- [ ] PROD: the /admin Overview "eBay API limits today" tile stays under the Browse cap (referee 900 + comps).
- [ ] PROD: a hidden card (e.g. search "Genex Ally Axel" Starstrike Blast) shows "This price looks off, check sold listings", not $213,589.
- [ ] PROD: on the phone, /admin/prices > Hand check: tap "eBay sold" (opens sold listings), then "Right, keep" or "Wrong, hide" on one row; it moves to Your calls; Undo returns it.
- [ ] After a week: every $100+ card has a reading (counts line: fine + check + hidden + not on eBay ~ 4,500).

## 10-12 night: marketing nav hydration error fixed (LOCAL, PUSHED, live by 10-17 9:18am ET (90033b03))
Since 10-08 the nav read the signed-in hint from localStorage while rendering, so for a signed-in visitor the server HTML said "Log In" and the browser's first paint said "Log out": React threw a hydration error on every marketing page and rebuilt the page in the browser (slower first paint, console error; new prod errors in OPEN-TESTS E #73 may include it). Now read through useSyncExternalStore with a server snapshot of false. Pane 10-12: fresh tab, signed in, card page: no console errors, nav shows Log out at once.
- [ ] PROD after the push, signed in on the phone: open cardflip.io and a /cards page: nav shows Log out + Open the App with no flash of Log In; error digest shows no new "Hydration failed" lines.

## 10-12 ~11:20pm: card pictures served from cardflip.io/pics + hotlink firewall rule (LOCAL, PUSHED, live by 10-17 9:18am ET (90033b03); rule is on Vercel in LOG mode)
Chris: "put in some safeguard so people cant use images hosted on our website". lib/pics.ts toPics() at the 4 readers, next.config rewrite /pics/* → Blob cards/, proxy.ts skips pics/, vision + ogArt fetch the store directly (fromPics). Local proof: Charizard 1st Ed page 19 of 19 card pictures on /pics, 200 image/webp, storage address 0 times in the HTML. Firewall rule "Card pictures: other sites' hotlinks" (Referer present and not cardflip.io/google/bing/ddg/yahoo/ebay/pinterest/facebook) added via API, action LOG.
- [ ] PROD after the push: a card page's pictures come from https://cardflip.io/pics/..., and view-source shows no "blob.vercel-storage.com/cards".
- [ ] PROD: `curl -I -H "Referer: https://example.com/" https://cardflip.io/pics/<a tile path>` → shows in Vercel Firewall as a LOG hit for the rule; `curl -I` with no Referer → 200 and no hit.
- [x] DONE 10-14 ~6:40am ET (rule switched to DENY, curl verified; OPEN-TESTS 10-13 E77): After ~1 day of LOG with no false hits (our own pages, Google Images, eBay): switch the hotlink rule to DENY.
- [x] Rate-limit rule ADDED 10-13 ~8:45am ET (Chris yes after the price check: $0.50 per 1M allowed /pics requests, us ~75k/month = ~$0.04): "Card pictures: bulk download rate limit", path pre /pics/, fixed window 60 s, 600 per IP, deny for 10 min (scripts/_fw-ratelimit.mjs, untracked). Read back active via the API.
- [ ] 10-14: game hub "most valuable" tiles and card-page "Other printings" strips still showed outside links (lorcast) on 10-13 after the push: they are 24 h DB-cached tile lists (cardPages cachedTiles, TOP_TTL_MS = 1 day) built before the deploy. Confirm they switched to /pics (curl /cards/lorcana and a Lorcana card page, count "lorcast").
- [ ] Scan a Pokémon card on prod: the picture tiebreak still identifies (it fetches our copy straight from the store via fromPics).
- [ ] A social/share picture (Share card) renders card art (ogArt fetches via fromPics).

## 10-12 late night: One Piece + Pokémon pictures self-hosted (LOCAL, PUSHED, live by 10-17 9:18am ET (90033b03); runs done on Blob + Turso)
One Piece 5,546 of 5,549 (3 have no picture anywhere, BACKLOG), 4,249 sourced from TCGplayer per Chris. Pokémon 22,315 of 22,315 (TCGdex high.webp; en_cards own_* columns; scanner + card/list pages read them). Local = Turso for both. Local proof: /cards/pokemon 24 of ours, 0 tcgdex; 1st Ed Charizard page 42 of ours, 0 tcgdex.
- [ ] PROD after the push: cardflip.io/cards/onepiece, open a set: tiles now SHOW (the optcgapi list-page block no longer applies, our copies are on our store) and right-click → ...blob.vercel-storage.com/cards/onepiece/...-tile.webp.
- [ ] PROD: cardflip.io/cards/pokemon → a set → a card page: picture from ...blob.vercel-storage.com/cards/pokemon/, sharp.
- [ ] PROD: scan any Pokémon card: candidate thumbnails load (now our store); identification unchanged.
- [ ] PROD: /app/collection sets page set logos still show (derived from en_cards.image_url, untouched).

## 10-12 night: Lorcana pictures self-hosted (LOCAL, PUSHED, live by 10-17 9:18am ET (90033b03); the run itself IS live on Blob + Turso)
Chris 10-12: "find card, save to our database and everything pulls from there." scripts/save-pictures.mjs --game lorcana --prod saved every Lorcana picture (3,469) to our Blob as cards/lorcana/<id>-<hash>.webp (500px page copy ~47 KB) + -tile.webp (240px ~15 KB) and wrote own_image_url / own_tile_url / own_image_src on the rows, local and Turso. Readers (tcgCards.ts, cardPages.ts, movers) prefer own_* and fall back to image_url; set-rank list cache bumped to v4 so lists switch at deploy. Nothing on the live site changes until this code is pushed.
- [ ] PROD after the push: cardflip.io/cards/lorcana, open a set, right-click a tile → the picture URL is mlwovvakovcpakbr.public.blob.vercel-storage.com/cards/lorcana/...-tile.webp (not cards.lorcast.io); a card page shows the ...webp page copy, sharp, not blurry.
- [ ] PROD: search "Elsa" from the header on a Lorcana page: result thumbnails come from our store too.
- [ ] PROD: Lorcana scanner candidates (scan any Lorcana card): the printing thumbnails load from our store; the scan still identifies the card (tiebreak still reads ref_image_url / image_url, unchanged).
- [ ] Weekly catalog sync (Sunday 10:30): sync:lorcana overwrites image_url but not own_*; a re-run of pictures:save --game lorcana afterwards saves only NEW or changed pictures (count printed on the first line, should be small).

## 10-12 ~3:30pm: Inventory summary postage = each copy's real rate (LOCAL, PUSHED, live by 10-17 9:18am ET (90033b03))
Was a flat $0.78 per copy everywhere (a $1,178.52 card read "Postage · 1 × $0.78"). Now salePostage (fees.ts): over $100 tracked $6.07 whatever was picked; otherwise the row's pick at its price (envelope $0.78 up to $20, stamps $1.31 to $100; tracked $6.07); no pick = the label up to $20, tracked above. Same rule in saleNet/saleBreakdown (sales report, CSV), the reprice sheet's "you keep", and the Listed panel. Pane 10-12: $41.12 no pick → "Postage · 1 × $6.07", fees $5.85, You Keep $29.20; hand-sold → "Postage $0.00".
- [x] (10-12 ~3:15pm ET Chris on the tunnel: passed) Tunnel, Seller mode, Inventory summary: the $1,178.52 Pikachu (svp-085) reads "Postage · 1 × $6.07" and You Keep on eBay ≈ $1,015.90 (was $1,021.19).
- [x] PASS 10-14 (Chris phone; OPEN-TESTS 10-13 A1): Mixed rates (one card under $20 with Envelope + one over $100): the line is plain "Postage" with the summed total, fees line still adds up to You Keep.
- [ ] Earned ledger after a real eBay sale over $20: postage shows the sold row's pick ($1.31 stamps or $6.07 tracked), the sales report page says the same in its footnote.

## 10-12 afternoon: Inventory Market Value = chart, Sales Report moved to Account (LOCAL, PUSHED, live by 10-17 9:18am ET (90033b03))
- [x] (10-12 ~2:45pm ET Chris on the tunnel, screenshots) Tunnel, Collector mode, Inventory: the big Market Value and the Inventory Value chart's last point are the SAME number (was $1,015.89 vs $1,178.52: the chart drew asking prices when it loaded before the Collector switch had saved; the page now sends ?basis= itself).
- [x] (10-12 ~2:45pm ET Chris on the tunnel, screenshots) Switch Seller -> Collector -> Seller on Account, back to Inventory each time: Collector chart says "market" and matches Market Value; Seller chart says "asking".
- [x] (10-12 ~2:45pm ET Chris on the tunnel, screenshots) Inventory summary has no "Sales Report for Taxes" link; Account > Selling has a "Sales report for taxes" row whose Open goes to the report.

## 10-11 night Shipping: envelope up to $100, real eBay prices (LOCAL, PUSHED, live by 10-17 9:18am ET (90033b03))
Prices from eBay's own calculator (ebay.com/shp/calc/rates) 10-11 and USPS Notice 123: eBay envelope label $0.78 (1 oz), stamps $0.82 + $0.49 nonmachinable = $1.31, Ground Advantage $6.07 (Miami → Seattle, same at 1 and 3 oz; nearby $5.38). Floor $1.25, a $0.25 card lists at $1.54.
- [x] (10-12 ~2:40pm ET Chris on the tunnel: "looks fine") Tunnel, scan a card under $20: Envelope tile reads "$0.78 · eBay Standard Envelope, tracked"; Tracked mailer "$6.07". (The "$" was missing on these tiles since 10-08, fixed here.)
- [x] (10-12 ~2:40pm ET Chris on the tunnel: "looks fine") Card between $20 and $100 (or type a price in that range): Envelope tile reads "$1.31 · Plain envelope with stamps" (no warning line, Chris 10-11); both tiles clickable.
- [x] (10-12 ~2:40pm ET Chris on the tunnel: "looks fine") Type a price over $100: Envelope greyed out, "Over $100, use a tracked mailer".
- [x] PASS 10-14 (Chris phone; OPEN-TESTS 10-13 A2): "How to ship" sheet on a $20-$100 card: stamp steps (Forever stamp plus 49¢, mark shipped in eBay).
- [x] PASS 10-14 (Chris phone; OPEN-TESTS 10-13 A3): Before any pick, a card priced over $20 is suggested as Tracked mailer (the no-tracking envelope is never the default).
- [ ] PROD, first real $20.01-$100 envelope publish: eBay accepts the new "CardFlip letter" policy (Standard Shipping, free) — only tested against a fake eBay so far; if eBay refuses it the card lists on the tracked policy.
- Known, not fixed: repricing a live envelope card across $20 keeps its original eBay policy (policy is picked at publish only; true before tonight too).

## 10-11 Sign-in code "Send a New Code" link after the code expires (prod /login, admin account)
- [x] (10-14 3:55pm ET Chris phone: pass, countdown then new code worked) On cardflip.io/login as truefreemoney, let the 6-digit code expire (or type a wrong one) so the red "didn't match or has expired" box shows, then tap the blue "Send a New Code" link under the code box: a new email arrives and that newest code logs in. Chris 10-11 ~8:30pm ET didn't see a button at first (the link sits small at the end of the "works for 10 minutes" line); if it does nothing on tap, that's a bug. Open question for Chris: make it a full-size button under the red box (visible change, screenshot + yes first).

## 10-11 Every empty scan given back + no category sheet with nothing scanned (9fc403ff, pushed 10-11 night as 5e4d662b)
- [x] 10-11 8:35pm ET, local dev with the real reader, driven from the pane: a drawn floss box read at 10% ("Couldn't read"), scans used went 0 → 1 → 0 after the give-back (POST /api/vision/scan/giveback answered refunded). Same path on prod after the push.
- [x] Tap Done on the camera after only that bad scan: NO "Which category?" sheet. Inventory has no new row. PASSED 10-11 ~8:45pm ET, Chris's phone on the tunnel: floss box = no match, counter stayed 0, Done opened no sheet.
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #1): Scan a real card, then tap Done: the "Which category?" sheet DOES open as before.
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #2): Scan a Magic card with Pokémon selected: "That looks like a Magic card" and the scan is given back too.

## 10-11 Game pills centred in the phone header (26e22043, pushed 10-11 night as 5e4d662b)
- [x] PASSED 10-11 ~8:45pm ET (Chris, tunnel). After a scan, on the phone: the Pokémon / Magic / Lorcana / One Piece / Yu-Gi-Oh! row sits centred in the header card, not hugging the left edge; all five still fit on one line on your iPhone.

## 10-11 Faster scans: tiebreak off the critical path, price wait 2.5 s → 1.2 s (PUSHED to main 10-11 ~9:10pm ET as a40dddb4, build ~2 min)
- [ ] Scan a card with two near-identical printings (a Trainer Gallery card like Eevee TG11, or any card with a 1st Edition twin): the card shows within ~3 s instead of waiting on the picture check; if the tiebreak later disagrees, the card swaps and a Check-match line says "the photo looks more like this printing than <set>".
- [ ] Verify a card quickly after it shows: a late tiebreak must NOT change it afterwards (verified wins).
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #8): Scan 5 cards in a row and time it against yesterday: the "Reading the card" wait feels shorter; prices still appear on the card (held price first, live price fills in).
- [x] /admin log: no new "scan: slow read" warnings beyond what was there before. (closed 10-11 ~10pm ET by Claude: PASSED, last slow-read warning 11:41am ET 10-11, none since the scanner pushes)

## 10-11 No-match scans given back (PUSHED to main 10-11 ~9:10pm ET in a40dddb4)
- [x] PASS 10-14 by prod data (brian: 4 no-match reads all given back, 1 of 5 used): Trial account: scan something that is not a card (a book cover, a receipt) so the queue says "No match found — search by name": the header scan counter does NOT go up (or goes up and comes back within a second), and /app/account shows the same trial count as before.
- [x] PASS 10-14 by prod data (Jenny: 5 matched reads = 5 of 5 used): Scan a real card right after: it still counts (the counter rises by one and stays).
- [x] CLOSED 10-12 (rule changed 10-11: refusals are given back too; OPEN-TESTS 10-11 #5 PASS): A token or an art card (Magic) says "not accepted" and DOES still count (that is a refusal, not a miss).
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
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #25): Inventory bulk: select live cards > Mark sold (N): the same Are you sure sheet with the count; Cancel leaves them live; Yes marks them sold at asking price.

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
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #32): Inventory: a live or sold card shows "How to ship it · <pick>" with the 4 steps; "Both ways" opens the sheet.
- [ ] After a real sale: the "Your card sold" push AND an email with the mailing steps land (daily sweep); check the email reads right on the phone.

## 10-08 scanner + inventory fixes from the test day
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #12): Trial account on its LAST scan: scan it, close the camera → the out-of-scans wall shows right away, no page reload (867a4b69).
- [ ] Inventory with a card open: the round X next to Subscribe Now closes the card and shows the plain list; the Share button sits inside the card panel, not on the footer note (2fe6a947).
- [x] PASS 10-12 (Chris; OPEN-TESTS 10-11 #13): Scanner result: no "Check the art … Switch" banner on a card with a pricier twin (b23829db).
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
- [x] 10-22 8:30am (pane at 375px): Duplicates chip = 24 of 45 cards, Missing Price chip present; Name A–Z + Set in the sort list (the sort order itself = phone).
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
- [x] DONE 10-18 (218 / 240 / 298 views, no winner, weighting unchanged; SOCIAL-AUTOPILOT.md results log) (10-10 evening, me) TikTok question-format test: read views/likes of the three 10-09 posts (7am Guess Pokémon, 1pm Movers control, 7pm Head to Head Pokémon) into docs/SOCIAL-AUTOPILOT.md results log; decide the 7pm weighting from that.

- [x] DONE 10-18 (IG 16.7 vs 8.4 views/post, X 17.8 vs 14.6, Threads flat 18.1: KEEP; SOCIAL-REACH-DEEPDIVE.md "Trial review") 10-16 evening: REACH TRIAL REVIEW (2c23d2a4, 10-09). Instagram/Threads/X avg views per post 10-10..10-16 vs the 14-day baseline in docs/SOCIAL-REACH-DEEPDIVE.md (IG 5.7, Threads 18, X 12). First 10-10 7am run: open one IG/Threads/X post, confirm the sign-off is at the bottom above the tags, TikTok/Facebook/Bluesky unchanged. If no lift, revert signOffLast on the three sites.

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
- [x] PASS 10-16 (Turso: 32 English Art Series unpriced, target ~31) Morning after the push: the 56 Art Series cards from the 10-13 dry run have a price (e.g. Avatar Eternal Art Series 1-12 ~$0.25-0.84, Marvel Thanos 1c-9c ~$3-4, Avatar Yue 41 ~$11). Query: Art Series unpriced count should drop 87 -> ~31.

## Magic cheapest-listing cap + listing beats Cardmarket (10-13)
- [ ] HALF 10-16: 10-15 run cappedToListing 2,579 (not hundreds, but 2% of 116k; mtg step fine, whole run 200 s). cardmarketFilled was never saved: dailyJobs.ts dropped it, fixed 10-16; read it after the next push. Morning after the push: daily_last_result mtg.cappedToListing is in the hundreds (not 0, not tens of thousands); mtg step still finishes under the 800 s cap.
- [ ] Magic "This price looks off" count drops from ~837 toward ~83 (rerun the sweep script pattern, s154 scratchpad).
- [x] PASS 10-14 ~10:25pm ET (Cromat $57.30, Spiritmonger $57.65, Vindicate $163.20): Spot-check 3 capped foils on the card page (e.g. Cromat Apocalypse foil ~$57, not $155).

## 10-13 ~2:30pm ET: US tracked = Ground Advantage (USPSParcel), eSE carrier EBAY_SEND
- [ ] First real US publish after the push: the seller's "CardFlip shipping" policy reads USPS Ground Advantage (not Priority), still free (Seller Hub > Business policies).
- [ ] First real envelope (≤$20) publish creates "CardFlip envelope" with eBay Standard Envelope (carrier EBAY_SEND) and the listing shows Free eBay Standard Envelope.


## 10-13 ~3pm ET: nightly new-cards run (PC, 2am ET)
- [ ] 10-14 morning: (LOG PASS 10-14 7:40am ET: done 2:33am, failed: empty, all 5 games 0 failed, 44 YGO stand-ins; /admin/prices tile PASS 8:25am: last run 6 h ago, all steps fine) backups\catalog-sync.log ends with "===== done ... (failed:)" and nothing after failed:; /admin/prices shows "New cards ... last run" ~2am, all steps fine.
- [x] PASS 10-16 (60,196 of 60,196 own pictures; Lorcana 3,505/3,505, One Piece 5,546/5,549) Yu-Gi-Oh saved pictures intact on Turso after the push (count own_image_url<>'' for yugioh >= 59,969); the 22 new rows got pictures.
- [x] PASS 10-16 (yugioh 28,141, lorcana 2,624) After the code push: cardmarket_map rows on Turso (yugioh ~28k, lorcana ~2.6k) and the 5:25am tcg-prices run still green.

- [ ] Stand-ins: a new card with no scan shows another printing's picture (own_image_src 'standin:<id>'), and the night its own scan appears it switches (tested on a DB copy 10-13: borrow, keep on retry, replace, stand-in's files kept). /admin/prices lists cards still borrowing 2+ weeks after release.

- [ ] Old Yu-Gi-Oh borrowers retry nightly (sync-yugioh no longer repoints dead links, 10-13): first run already swapped 186 to real TCGplayer scans (99 from the old dead list, sheet checked by eye, all clean BETB scans); 233 still 403 keep their borrowed copy. After tonight /admin/prices Yu-Gi-Oh "borrowing" ~233 and falling over time.


## 10-13 ~7pm ET: Magic euro fill + One Piece reprints (PUSHED 30615a64 10-14 ~5:20am ET)
- [x] PASS 10-14 (list item 63: Black Lotus Alpha $37,780.37 from EUR): Next 5am mtg-prices run: cron result shows cardmarketFilled ~400; Black Lotus (Alpha) card page shows a dollar price labeled Cardmarket; /admin/prices eBay check reviews the new $100+ ones over the week.
- [x] PASS 10-14 (list item 64: ST30-ST36 all priced): One Piece ST31-36 reprints (e.g. OP12-090_r1 Belo Betty) show their original's price after the 5:25am tcg-prices run.



## 10-13 ~7:45pm ET: Send a New Code button + Verify label (76660b68, PUSHED 30615a64 10-14 ~5:20am ET)
- [x] PASS 10-14 ~3:55pm ET (Chris phone, sign-in code + Send a New Code): Phone, /login with an emailed code: under the code box a full-width outline 'Send a New Code' button (not a small blue link); tapping it mails a new code. Same on /admin/login.
- [x] PASS 10-14 (Chris phone, list item 35): Phone scanner after a scan with 'Not this card?' showing: green button reads 'Verify 1 Scan  $0.85' in full, no 'Ver...' cut.


## 10-13 ~7:45pm ET: scanner match tile + card removal log (PUSHED 30615a64 10-14 ~5:20am ET; the log answered Jenny's case 10-14 8pm)
- [ ] /admin analytics Scanner 'Matched a card' = paid scans not given back / paid scans (tiebreak calls no longer count). Today's 6 scans read ~33% (2 of 6: the 4 refunded by hand count as given back), not 25%.
- [x] PASS 10-14 8:10pm ET (Jenny's 5 bulk rows with name/set/status/match_doubt/created_at; 'one' path untested on prod): Turso has table card_removals after deploy; remove a test card on prod (one, then a bulk select) -> two rows (how one/bulk) with name, set, status, match_doubt, created_at.


## 10-13 ~7:50pm ET: fx fetch no longer no-store (PUSHED 30615a64 10-14 ~5:20am ET)
- [x] PASS 10-14 (list item 65: Vercel logs past day 0 static-to-dynamic, 0 fx): Vercel logs / /admin errors for 24 h after the push: no 'fx: rate refresh failed ... Dynamic server usage' and no 'Page changed from static to dynamic at runtime /cards/magic/...'. If the static-to-dynamic one remains, it has a second cause: find it with a local next build.

## 10-14 ~4am ET: code wait, envelope wording, no confidence %, backup fix (PUSHED 30615a64 10-14 ~5:20am ET)
- [x] (10-14 3:55pm ET Chris phone: pass) Phone, /login (or /admin/login) with an emailed code: right after the code mails, the button reads 'Send a New Code (60s)' and counts down, greyed out; at 0 it works again. Email-confirm wall on signup counts 60s too.
- [ ] A scan the AI was unsure of: Scanner list and Inventory show 'Verify match' but NO 'low-confidence read (40%)' text anywhere.
- [x] (10-14 2:17pm ET Chris phone: pass) 'How to ship' on a $20-$100 envelope card, step 3 reads: 'Postage is $1.31 total. Use $1.31 in postage stamps, or hand it in at the post office counter and they'll stamp it for you.'
- [x] (10-14 3:50pm ET Chris phone: pass, Best Match both places) Search: every result tile has a 'Buy on eBay' button under the price, and the opened card has one under Share; both open eBay on Best Match (not cheapest first) for that card. Watchlist's Buy on eBay is Best Match too.
- [x] PASS 10-16 (10-15 run green after red 10-13/10-14) Nightly backup (cardflip-backups repo) goes green the night after the push (foreign keys off in the copy; local run 10-14 passed, 552,343 rows).

## 10-14 morning: set pages show under-$1 cards, Buy above Watchlist, duplicate Trainer Galleries gone (PUSHED 30615a64 10-14 ~5:20am ET)
- [x] (10-14 ~5:30am ET applied on Chris's yes: 18 statements, re-run dry = 0; backup backups/dup-tg-sets-prod-1791970155907.json) RIGHT AFTER THE PUSH (me): `node scripts/drop-duplicate-tg-sets.mjs --prod` (dry run: 1 customer card moved to swsh9tg, 120 en_cards + 144 price_series + 120 tcgplayer_products + 5 listing_lows deleted, 119 saved searches cleared) then the same with `--apply`. Not before the push: live code has no redirect for the old ids yet.
- [x] (10-14 10:35am ET after the d3a938f2 push: /cards/pokemon lists each Trainer Gallery once, curl 0 duplicates; earlier 6:30am: search PASS, 4 results, TG23 once in swsh9tg. Game page + redirect was NOT yet: /cards/pokemon still lists each Trainer Gallery twice and the -brs slug serves the 30 cards; seo:sets:v1/v3:pokemon card_cache rows deleted, the 48 h page copies clear on the NEXT PUSH -> recheck then) PROD: Search "Umbreon VMAX" = 4 results, TG23 once. /cards/pokemon lists each Trainer Gallery once; /cards/pokemon/brilliant-stars-trainer-gallery-brs redirects to /cards/pokemon/brilliant-stars-trainer-gallery; an old swsh9.5tg card link redirects to the swsh9tg page.
- [x] (10-14 curl: Evolving Skies 276 sub-$1 prices, no '1.00 and up' on game/set pages, Surging Sparks Drasna sub-$1 page = noindex, follow) PROD: a set page (e.g. /cards/pokemon/surging-sparks) lists cards down to a few cents; no "$1.00 and up" wording on /cards, the game pages or set pages; a sub-$1 card page still has robots noindex.
- [x] (10-14 2:33pm ET Chris phone, Pikachu 30th 023/128: Buy on eBay + Watch pinned side by side at the bottom) Phone: Search, open a card: Buy on eBay sits ABOVE Add to watchlist.

## 10-14: Search redesign A-F (PUSHED 30615a64 10-14 ~5:20am ET; all 16 phone checks PASSED by Chris 10-14 ~2:30pm, see the s165 note in STATE)
- [x] (10-14 2:40pm ET Chris phone: pass) Phone, Search before typing: game pill + big "Name or number" box pinned under the header; My Watchlist swipe row (price now, % since saved, bell when an alert is set, "See all N"); "Open a whole set" tiles with set logos (newest 6). No intro text, no Recent lookups.
- [x] (10-14 2:34pm ET Chris phone, "pikachu": 200 cards, Best match pill, list/grid switch, rows with picture/name/set+number/rarity chip/price/star/Buy, round x in the box) Type a name: a "Search" button shows inside the box until you search, then a round x clears. Results: "N cards", one "Sort" pill, list/grid switch; rows show picture, name, set and number, rarity chip, price, star and Buy.
- [x] (10-14 2:40pm ET Chris phone: pass) Sort pill opens the Sort & filter panel from the bottom: Card name / Whole set, sort list, rarity chips, "Narrow these results"; "Show N cards" closes it.
- [ ] Sort & filter sheet, phone: drag the grab bar down about a finger's length: the sheet closes (Chris 10-14: it got stuck; the bar was drawn, not wired. Fixed locally, not pushed: shared drag-to-close, closes past 56 px on release or at once past 120 px; a short drag snaps back. Pane 375px pass 10-14 3:05pm ET). Also try the home page card peek and any other sheet's bar once: same rule now.
- [x] (10-14 3:10pm ET Chris phone: pass) Tap a star: it turns gold and the card is on the Watchlist; tap again removes it.
- [x] (10-14 2:33pm ET Chris phone: $0.76 in foil colours, Buy on eBay + Watch pinned) Open a card: smaller picture, the market price in foil colours, Buy on eBay + Watch pinned at the bottom while the chart scrolls.
- [x] (10-14 3:15pm ET Chris phone: pass) 24 cards per page with "Show 24 more"; the commission line sits in small print at the very bottom of the results.
- [x] (10-14 3:20pm ET Chris phone: pass) Watchlist page: same new search box (game pill + field) inside its panel; adding from a search still works.
- [x] (10-14 2:40pm ET Chris phone: pass, all games) Search, before typing, for EVERY game (switch the game pill): six "Open a whole set" tiles
- [ ] Search before typing: switch the game pill: the My Watchlist row shows ONLY that game's watched cards (Chris 10-14: the Pokémon row stayed put on Magic; fixed locally, not pushed: rows saved without a game count as Pokémon). "See all N" counts that game's cards; a game with none shows the "Tap ☆" line., each with a picture (Pokémon logo when TCGdex has one, else the set's most valuable card art). One Piece (no release dates) shows its top-value sets with "N cards".
- [x] (10-14 2:33pm ET Chris phone) Search, open a card: the card picture is big (about two thirds of the phone width).
- [x] (10-14 3:25pm ET Chris phone: pass) Watchlist: Total value starts as a one-line bar (tap to open, the arrow folds it again); "Add a card" panel has Hide / Show; both remembered after a reload.
- [x] (10-14 2:53pm ET Chris phone: $1,574.99 reverse holo, eBay sold raw $700-3,500 since late Aug so the number stands) Watchlist: Legendary Collection Pikachu 86 shows $1,574.99 "steady" (was "$6.62, down 100%": the Watchlist read a different printing than the one saved).
- [ ] Card detail (Search/Watchlist), the Source/Variant/Low/Market table: a "low" above the market shows "—" (Chris 10-14: Legendary Collection Pikachu reverse holo read Low $19,999.99 beside Market $1,574.99, a joke listing; fixed locally, not pushed). The Normal row still shows its real low.
- [x] (10-14 3:40pm ET Chris phone: pass) Search: 'All sets' opens a full panel of every set with pictures (newest first; One Piece by value), a 'Find a set' box narrows it, tapping a set opens all its cards.

## 10-14 ~6:30am ET: owner eBay reconnected (link dropped 10-13 10:10pm ET by invalid_grant 'issued to another client', cause unknown)
- [x] PASS 10-14 ~8:50am ET (s163: still connected, no new refresh rejected): After ~8:30am ET (first token refresh on prod): /api/ebay/status from the pane still connected:true, and /admin/errors has no new 'eBay refresh rejected'. NEVER verify via a local script calling ebayAuth (deletes the link: local key).

## 10-14 ~7am ET: eBay links leave slabs out (Chris: 'any title with PSA is a slab')
- [ ] After push: /admin/prices 'eBay sold' and a raw card's 'check sold listings' open eBay with '-psa -bgs -cgc -sgc -graded -slab' and no slab titles; a slab item's eBay link still searches its grade (e.g. PSA 9).

## 10-15 ~7:05am ET — scanner live outline (local, UNPUSHED)
- [ ] Scanner: a blue line hugs the card's edges as soon as it is in front of the camera; green (with green brackets) once the whole card is in the picture, lit, no glare; blue again the moment an edge leaves; gone when the card is gone. PASS on Chris's phone 10-15 ~7am (Spidops + Pikachu VMAX, tunnel). Re-check on prod after the push.
- [ ] Scanner: with the card poking out of the box a little and the line green, Capture: the photo has the whole card (crop grows to the outline, +2%). Not yet confirmed by eye on a saved photo.
- [ ] Scanner: "Keep going for a whole stack." line is gone under the camera.
- [ ] Dev only: /app?dbg=outline shows the finder's view + posts frames to /api/dev/outline-dump (404 on prod; .outline-dumps/ gitignored).
- [ ] Scanner result card (10-15 ~7:45am ET): set · rarity · number wraps to 2 lines, never cut; row 2 = "● Near Mint · Holofoil ✎" pill (dot = condition colour; tap opens the card) + Clear on the right; no "75% sure" on the label; on a phone with 10+ scans or a $1,000+ total the green button says "Verify All $1,234.56" (was "Verify 12 S…"). Card editor's "Is this your card?" line no longer shows a percentage. Pane-checked at 375px on a real Pikachu scan; Chris to eyeball on the phone after the push.
- [ ] Scanner "This copy" sheet (10-15 ~8:15am ET): tap the "● Near Mint · Holofoil ✎" pill on the result card: a sheet "This copy" with 5 condition chips (each shows the market for that condition), Printing chips only when the card has 2+ priced printings, "Use X for all N waiting scans" when 2+ waiting, Done. Taps apply at once: the pill + the card's market price + the Verify total follow (headlinePrice now = market for the copy's condition; NM unchanged). Pane: sheet opened, LP tap -> pill "Lightly Played · Holofoil". NOT yet seen: the price moving to $87.79 on the card (checked by code + tests only); printing chips on a multi-printing card; the all-N link.
- [ ] One $10,000 card at phone width: Verify button says "Verify Scan $10,000.00" (not "Verify All").

## 10-16 push (s178, Chris's 9 items)
- [ ] Search cards opens on the picture grid (new key cardflip.searchView.v2), list toggle still works. Pane: done locally.
- [x] PASS 10-22 8:30am (pane at 375px): Watchlist: 0 stale notes, "Legendary Collection · 86" one line with ellipsis. Sitewide .truncate on <p>/h2/h3 now truncates (text-wrap-style fix). Glance at Inventory/Search tiles for anything that now cuts off badly.
- [ ] Scanner: Open a Pack button gone. Pane: done locally.
- [x] PASS 10-16 (Chris, phone) PHONE (camera): scan a card, tap the result card -> big view with picture, price, "Change", "Not this card?"; pull the handle down or tap Done closes it.
- [ ] Card pages: Buy on eBay under the price + commission line; name pages (e.g. /pokemon/mewtwo-card-value) Buy under each card. customid card-page / name-page / cards-search.
- [ ] /cards/pokemon search: full grid + count + Show more + Buy (Mewtwo = 95, same as the app).
- Decided 10-16 (Chris): NO "Which one is yours?" picker when the name reads but the number doesn't exist. Keep "No match" (never guess a printing).

## 10-16 ~4am ET push (s178 second batch)
- [ ] Morning after: daily_last_result mtg now shows cardmarketFilled (number, ~400ish) next to cappedToListing.
- [ ] Morning after: soft cap live. Spot-check: an Alpha/Beta capped card (e.g. Beta Shivan Dragon, was $1,998.97 = cheapest listing) now ~1.45x its listing; a cheap modern foil (Cromat Apocalypse foil ~$57) unchanged; none of the soft-capped ones flagged "looks off".
- [ ] Ancient Mew (miscp-001) card page shows ~$122 after the next daily price run.
- [ ] Homepage hero line reads "...adds up what your whole binder is worth. Selling? It writes the eBay listing. You tap Post." (Chris yes 10-16).

- [ ] Pokemon listing cap (10-16, after push): Base Set 2 Mewtwo (base4-10) card page ~$68 not $129.77; Skyridge Piloswine H22 unchanged ~$388; a cheap holo under $20 unchanged; none of the capped ones show "looks off".

## 10-17 competitor tasks (PUSHED 90033b03 10-17 ~9:18am ET; CI + smoke green; prod checks 10-17 ~10:30am ET below)
- #59 titles: PASS on prod: "Blastoise 2/102 Base Set price: $224.98" (39 chars); set title "Base Set Pokémon card prices 2026"; set desc "100 Pokémon cards from Base Set, from $0.29 to $224.98. Most valuable: Blastoise at $224.98."
- #58 card pages "Common questions": PASS on prod at 375px: 3 Q&As open, Blastoise LP $191.23 / HP $123.74 = exactly 85% / 55% of $224.98, no sideways scroll.
- #61 "All" range pill: card chart PASS on prod at 375px (All selected, 151 days May 18 -> Oct 17, no overflow). Inventory value chart NOT CHECKED (needs a signed-in account with cards).
- #62 set summary strip: PASS on prod (Base Set: 7d -11.3%, 30d -14.5%, typical $2.60 of 100, most valuable Blastoise $224.98 = top of the card list).
- #63 "Most valuable sets" on /cards/<game> (top 10). SWR cache seo:setvalues:v1:<game> (~21 s query, built after the response): the section may be MISSING on the first build of a hub page and appears after ISR revalidates (<= 2 days). Check all 5 games show it within 2 days, and Pokemon top 5 ~ Skyridge, Legendary Collection, Holon Phantoms, Base Set 1st Ed, Aquapolis.
- #65 Top 100 page: PASS on prod 10-17: all 5 games 100 rows + link on each hub; top 5 look real (Pokemon 1st Ed Charizard $10,000, Magic Smaug $24,500, YGO Uria $999.97, Lorcana Elsa's Ice Palace promo $3,999.99, One Piece Luffy Gold $13,000). Cold builds: Pokemon 16.5 s, YGO 7.6 s, Magic 5.1 s; cached ~0.4 s. #63 Most valuable sets: still missing on all 5 hubs at 10:30am ET (expected; recheck by 10-19).

## 10-17 Watchlist fixes (PUSHED 10-17 ~8:50pm ET in d11ec26d; 87cc9989, 36bbf0e1)
- Game picker shows cards per game (pill 'Pokemon · 6', options 'Magic (0)'). Check on phone: pill fits beside the search box at 375px.
- Game with 0 watched cards: 'No Magic cards on your watchlist.' + 'Show Pokemon (6)' button switches the list. Filter text that matches nothing still says 'Nothing matches that filter.'
- Totals strip open: 'Alerts' label clear of the fold chevron (desktop). Phone layout unchanged.

## 10-19 s199 (unpushed; test on prod after the push)
- [ ] a34a418f Scanner: scan a card with several printings, open the big card sheet, tap Change: one Printing pill is highlighted; tap Done: still inside the scanner (no category / editor jump). Scan an orange Vivillon 17/146: no yellow note under it in the queue, still under "Check these first". (Passed on the tunnel 10-19 ~7:30pm.)
- [x] (10-21 4:15am ET: covered by test:pricing, pure quotePrice: "TCGplayer's chart point outranks eBay sold" + "an eBay sold row outranks the flagged TCGplayer row" PASS; the live pop-up rides on Chris's phone, not opened on his account to keep his lookup history clean) 9bb74143 Price pick TCGplayer first: on a card with live eBay comps, the row's market price and "List it at" come from TCGplayer, not the eBay sold/asking average; a card whose TCGplayer row is flagged still quotes eBay sold.
- [ ] FAILED 10-21 3:25am ET (page blank "looks off": the check retired on one in-band read) -> fixed on prod + code, see the 10-21 ~3:40am block. 10-20 morning: cardflip.io/cards/pokemon/base-set/charizard--base1-4 shows ~$600 + "Checked against recent eBay sales" and the "Price looks wrong?" link under the price (2-day cache).
- [ ] 0728f605 B1 scan log: after the push, scan a Pokemon card (any) on prod, then run 
pm run replay:scans (or SELECT read FROM scan_usage ORDER BY at DESC LIMIT 1): the stored read has pattern + all keys (null when no symbol). Then Chris's Eevee 074 Master Ball photo under a lamp: pattern should say ball / master.

## 10-20 s203 (unpushed; test on prod after the push)
- [ ] 87dbb217 + d98d407d Pattern read + focused look: scan a Black Bolt / White Flare Poke Ball card: the big card sheet preselects "Poke Ball Pattern" under Printing (7/7 on Chris's 10-20 photos in replay). Scan a Prismatic Evolutions reverse (Slowking 019 / Eevee 074): either the ball is read (Printing = Poke/Master Ball) or the row says "reverse holo: tilt it to see the ball, then pick Poke Ball or Master Ball under Printing" and lands under Check these first. Scan time stays under ~6 s. SELECT read FROM scan_usage ORDER BY at DESC LIMIT 1: has pattern, ball and (when it ran) look.
- [x] 0728f605 scan log (10-21 3:15am ET, prod read only, 8:25pm 10-20 -> now): all 75 Pokemon card reads from the app carry pattern + ball (3 read a ball); the 66 Opus rows are tiebreak picks (no read, by design). GAP FOUND + FIXED (commit only): the free /scan trial route logged name/number/conf only (3 bot junk reads 1:02-1:48am) -> it now logs through scanLogRead too (test:scanlogread source check). After push: the next trial Pokemon row has pattern + ball keys.
- [x] (10-21 3:15am ET: social_post_log 10-20 7:05pm = x, facebook, bluesky, threads, instagram, 5/5) Instagram token replaced 10-20 ~2:40pm ET (Vercel env INSTAGRAM_TOKEN + redeploy dpl_H3ZT5YVbZi7bLz4ZraE2xT79Gfg2 READY): the 7pm autopost must include instagram in social_post_log (7am did, 1pm failed with the old token). No "Social Post Failed on Instagram" mail at 7:05pm.
- [x] (10-21 3:15am ET: Charizard $143.88 as of Oct 21, Lugia $189.19 as of Oct 20, curl) 99740131 price checks: cardflip.io/cards/pokemon/30th-classic-collection/charizard--30th-c-001 still $143.88 (eBay sold ~$178 is inside the 25% band, check recorded, retires itself); Lugia 30th-c-029 $189.19 (eBay ~$210).
- [ ] STALE 10-21 (the 40 min / 2 h windows passed; Chris's note: Blender content sits too high, lower it next render) Blender 7pm 10-20 (30th Classic Collection, five reveals chained, 26.7 s): after the post, views at 40 min and 2 h vs the 10-18 7pm spotlight (TikTok ~111-171 views); Pinterest thumbnail = cover with the price landed.
- [ ] (B4 #4) Scanner with vision failing (e.g. ANTHROPIC key wrong on local): a scan ends as "Couldn't read this card - tap Capture again" under Check these first, nothing saved, scan count unchanged; no tesseract/ocr chunk in the /app bundle (grep the build for tesseract).
- [ ] (B4 #5) Watchdog frees the slot: on the tunnel, throttle the network (DevTools Slow 3G) and scan 3 cards fast: the two that hang show "Took too long - try again" at 20 s, the third still scans (queue not frozen), and the scan counter comes back for the hung ones (give-back) when the server had answered.
- [ ] (B4 #6) Scan a card and within 1 s change its condition (or printing) in the sheet: Inventory shows the new condition/printing, not the scan's.
- [ ] (B4 #7) Scan 3 cards, verify one, type a price on another, then "Use Lightly Played for all N waiting scans": the verified card keeps its grade, the typed price stays, N counts only unverified cards.
- [ ] (B4 #8) Clear a scan row, wait ~5.8 s, tap Undo: the card comes back (window now 6.5 s).
- [ ] (B4 #9) With the This copy sheet open, "Use X for all N waiting scans": the "X set on N cards" toast shows ABOVE the sheet.
- [ ] (B4 #10) Scan, tap Lightly Played in This copy, scan again: the new card starts as the options-sheet default (Near Mint unless changed there), not Lightly Played.
- [ ] (B4 #11) Inventory, select a LIVE eBay row + a not-listed row: "Back to Not Listed" counts only the ended one; "Mark sold (1)" on the live row ends the listing on eBay first then marks it sold (Seller Hub: listing ended); Delete button stays disabled for the live row; PATCH /api/cards/<live id> {status:"ready"} answers 409 "live on eBay - end the listing first".

## 10-22 ~12:12am ET: 27 eBay-set prices handed back to TCGplayer (Chris: "do whatever you think is best"; prod write via scripts/_retire-checks-1022.mjs, no code change)
- Report card §7 lists them (Mewtwo ex RS, Charizard GX rainbow, Crystal Celebi, Spider-Man 238, Zapdos ex, Blaziken RS, Dark Magician RP01, ...). retireCheck sets off_day; the price returns to TCGplayer's market on the next nightly write; card-list caches dropped.
- [ ] After the 10-22 nightly price write: these card pages show TCGplayer's number (e.g. Mewtwo ex Ruby & Sapphire ~$747, not $250; Venusaur Base Set ~$168, not $75); /admin/prices no longer lists them as hand-set.
- [ ] 10-23: the referee's next read does not flag them "too high" again (it compares to clean ungraded BIN asks now).
- [x] 12:27am: the 7 looked up by product id: 6 more retired (Sengenjin LP $140 / MP $120 vs ours $7.06; Elemental HERO Heat LP $199.98 vs $3.99; Hecatrice NM $190-200 x6 vs $2.66; King Dragun Ultimate NM $153 vs $70; Ancient Gear Beast 1st LP $75-78 vs $35; Mewtwo LV.X DP28 LP $195-296, NM $445 vs $100). Pikachu Wizards promo 1 keeps $42 (TCGplayer $499.99 = junk). Total retired tonight: 33 of 47.

## 10-22 ~12:20am ET: Entei SM219 promo fixed $205 -> $22.17 (TCGplayer market + 11 NM sales; prod write via scripts/_fix-price-tcg.mjs)
- [ ] Card page for Entei SM219 (SM Black Star Promos) shows $22.17 with the checked-price badge; the nightly write does not push it back to ~$205 (the check holds while the raw feed is >band away).
- [ ] Find why the raw TCGplayer feed carried ~$205 for smp-SM219 (product mapping in pokemonPriceRefresh / tcgcsv group for SM promos); if it is a mapping slip, other SM promos may share it: list SM promos whose TCGplayer price is >5x their Cardmarket EUR.

## 10-22 ~12:28am ET: stamped promo products never price the plain card (COMMITTED, not pushed; 15 prices fixed on prod already)
- tcgplayerProductStamp (lib/tcgcsv.ts) + skip in refreshPokemonPricesFromTcgcsv; test:pricehistory +2, tsc + eslint clean. The 15 wrong prices (report card §10) were fixed on prod via scripts/_fix-price-tcg.mjs (checked prices, the check holds against the raw feed until the code ships).
- [ ] After push: next nightly Pokémon write logs no price for the stamped product ids (201942 Entei Staff etc.); Entei SM219 / Rillaboom SWSH006 / Charizard SWSH066 pages show the plain price; the 15 checked prices can then be retired (they agree with the raw feed now) = run scripts/_checks-named.mjs and retire the ones whose TCG number matches within 10%.
- [ ] After push: the 7 stamp-only cards (hgssp-HGSS18, xyp-XY91, svp-133/134/135, mep-002/004) get no new point; confirm they show stale/unsure rather than the stamp price within a week.
- [x] 12:29am: the 528 non-stamp doubles measured (scripts/_dup-products-names.mjs): our price follows the right product in every case; 47 foreign-card mappings (Wizards promos + W-stamped cards, Shrouded Fable 001-008 + Basic Energies, Lycanroc kit halves) are harmless today, fragile; Cosmos vs Cracked Ice promo holos = own-print family, parked.

## 10-22 ~12:33am ET: card-page checked badge wording -> "Checked against recent sales" (COMMIT ONLY, VISIBLE copy, shot + Chris's yes before push)
- page.tsx one line: fixes from TCGplayer sales are no longer labelled eBay. Same badge, same place.
- [x] 12:38am 10-22: phone shot SENT (docs/shots/badge-recent-sales-after-phone.jpg, local Rare Candy bw10-105 "Checked against recent sales (9 sold)."); Chris's yes pending. Dev server stopped.
- [ ] After push: curl the Entei SM219 page: "Checked against recent sales (11 sold)."
