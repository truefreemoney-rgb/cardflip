# Open tests, 10-13 (ET). Total 89 = A 3 / B 30 / C 2 / D 29 / E 19 / X 6

Built from docs/TO-TEST.md + docs/OPEN-TESTS.md. Passed and replaced checks are left out.

## A. You, on the phone tunnel (nothing goes live) - 3

1. PASS 10-14 (Chris phone): Card under $20 plus a card over $100 in one stack: Inventory shows plain "Postage" with the summed total. [10-12]
2. REWORDED 10-14, pushed in 30615a64 -> Chris re-looks at the new stamp line on the real site: Open "How to ship" on a $20-$100 card: it shows the stamp steps (Forever stamp plus 49 cents). [10-11]
3. PASS 10-14 (Chris phone): Card priced over $20 with no shipping pick yet: it is suggested as Tracked mailer, never the plain envelope. [10-11]

## B. You, on the real site cardflip.io - 30

4. Let a sign-in code expire, tap blue "Send a New Code": new email arrives, newest code works. [10-11]
5. Sign up with email and password, log out, tap Continue with Google with same email: same account. [10-07]
6. A Google-only account typing a password sees "signs in with Google"; Forgot Password lets it set one. [10-07]
7. Second Google signup from the same phone starts with the free scans already used. [10-07]
8. Sign in with X, all 8 steps (buttons, shared email, no email, link, admin refused, used email, keys off). [10-10]
9. Google One Tap: close it with the X; it never comes back on that phone. [10-11]
10. PASS 10-14 (me: code allow-list = /, /pricing, /features, /help, /pokemon, /cards, /scan, /u/ only; signed in on / = no gsi script in the pane): One Tap never shows when signed in, or on /app, /admin, /login, /signup. [10-11]
11. One Tap with the admin's Google account is refused and not linked. [10-11]
12. One Tap on Android Chrome shows the browser-styled account picker and behaves the same. [10-11]
13. Out-of-scans wall: the Booster button opens live checkout for $4.99. [10-07]
14. Out-of-scans wall: the Subscribe button opens live checkout for $9.99 a month. [10-07]
15. Each "Send Test To Me" on /admin/emails: [TEST] mail arrives; pictures, prices, buttons, Stop link all right on phone. [10-08]
16. PASS 10-14 (me: live ex10-105 holofoil $2,500 carries untrusted hard 'flat 57d, 2.1x the cheapest listing' = the looks-off note path): Scan Lugia ex Unseen Forces 105 on a phone: "looks off, check sold listings" note, not $2,500. [10-07]
17. PASS 10-14 (me, pane 375px: X closes and page stays at 4575px; dragging the handle down closes, page stays): Home page card peek: close with X and by dragging the handle; the page stays where it was. [10-06]
18. Loading skeletons show on slow 4G for Inventory, card pages and set pages. [10-06]
19. LATER (Chris 10-14: can't test now): Grey text is readable in sunlight. [10-06]
20. /scan does not flash the camera button for someone who already used the free scan. [10-06]
21. Airplane mode inside the app shows the No Signal page; push still works afterwards. [10-06]
22. Home-screen icon long-press shows Scan and Inventory shortcuts (Android only). [10-06]
23. Scan too many times fast: "wait N seconds"; hit the daily limit: "try again tomorrow". [10-06]
24. Miss and busy panels on /scan show the sign-up link. [10-06]
25. Ad signup from /scan skips "How will you use it?" and lands in the scanner as Seller. [10-06]
26. A normal signup (not from an ad) still gets the "How will you use it?" question. [10-06]
27. eBay card with no shipping pick: button says "Pick a shipping option to publish"; after a pick, confirm line says free shipping. [10-08]
28. Accept Offers on: push a card, Seller Hub shows auto-accept 90% and auto-decline 70%; reprice moves them. [10-06]
29. Tracked Shipping (only after EBAY_VALUE_SHIPPING=1 is set): a card over the threshold shows tracked postage. [10-06]
30. PASS 10-14 (me, pane signed in: header Log out + Open the App, no hydration errors): Signed in on the phone: nav shows Log out and Open the App with no flash of Log In; no new hydration errors. [10-12]
31. PASS 10-14 (me, pane signed in: Inventory 14 own photos via /api/card-image, Set Completion card tiles /pics 200, Watchlist /pics): Signed in on prod: Inventory, Set Completion (set logos) and Watchlist pictures all load from cardflip.io/pics. [10-13]
32. Scan a Pokémon, a Magic and a Lorcana card on prod: pictures load and the card is still identified. [10-13]
33. Phone, /admin/prices Hand check: tap "eBay sold", then "Right, keep" or "Wrong, hide"; it moves to Your calls; Undo returns it. [10-13]

## C. A decision only you make - 2

34. DONE 10-13 (60 s countdown button, shipped): Sign-in code box: make "Send a New Code" a full-size button? (visible change, screenshot first) [10-11]
35. DONE 10-13 (Verify label fixed, Chris phone PASS 10-14): Green Verify button text is cut off ("Ver...") at phone width: OK to fix it? [10-12]

## D. Waiting on a date or event - 29

36. First real sale: the "Your card sold" push AND the mailing-steps email both arrive. [10-08]
37. A real eBay sale is recorded once, even with two tabs open at sync time. [10-06]
38. After a real sale over $20, the earned ledger and sales report show that row's real postage ($1.31 or $6.07). [10-12]
39. Seller with 26+ live listings: an eBay-side end on listing #26+ shows in Inventory. [10-06]
40. First real $20.01-$100 envelope publish: eBay accepts the new "CardFlip letter" policy (free shipping). [10-11]
41. First real US publish: the "CardFlip shipping" policy reads USPS Ground Advantage, still free. [10-13]
42. First real envelope (under $20) publish: policy uses eBay Standard Envelope and the listing says free envelope. [10-13]
43. First Booster or plan purchase from an ad signup shows in /admin. [10-07]
44. First sign-up from an ad shows in Google Ads Goals > Sign-up (within about 48 hours). [10-07]
45. First Stripe purchase shows in Google Ads Goals > Purchase. [10-07]
46. From about 10-14: Yu-Gi-Oh, Lorcana and One Piece $1,000+ cards show in the top lists. [10-06]
47. 10-16 evening: reach-trial review (Instagram, Threads, X views vs baseline); revert if no lift. [10-09]
48. eBay reconnect warning appears 30 days before the link expires (first ones about 2028). [10-06]
49. /admin funnel shows ad-page signups as landing /scan (no ad has landed there yet). [10-06]
50. PASS 10-14 (ebay_referee_last: 10-13 8:45am ET, 902 calls, 0 failed, verdicts high 29 / check 124 / ok 297 / none 193; next run 10-14 8:15+8:45am): After the push, next morning: Vercel shows the eBay referee cron twice; /admin/prices shows about 900 calls, 0 failed. [10-13]
51. After the referee runs: /admin "eBay API limits today" tile stays under the Browse cap. [10-13]
52. After a week of referee runs: every $100+ card has an eBay reading (about 4,500). [10-13]
53. Sunday 10-18 catalog sync: Lorcana pictures kept, and the picture re-save only adds a few new ones. [10-12]
54. One Piece top tiles are SAMPLE-stamped scans; the nightly job should swap in clean ones. [10-13]
55. PASS 10-14 (Art Series 2,607 cards, 32 unpriced): Morning after the push: the 56 Magic Art Series cards have prices (unpriced count 87 down to about 31). [10-13]
56. MECHANICS PASS 10-14 (5am run done 5:49am ET, whole daily 200 s, 0 sources failed) BUT capped = 2,583, not hundreds. eBay spot-check of 11 capped $40+: 5 in range, 3 Alpha cards 40-55% LOW (1 sale each), Jace WWK foil $134 vs $180-255 LOW, 2 no compare; Alpha Ancestral $9,960 vs raw $6-8k OK. Cap = cheapest listing of ANY condition -> undercuts vintage. BACKLOG entry, recheck with more data: Morning after the push: Magic "capped to listing" count is in the hundreds, mtg step under 800 seconds. [10-13]
57. Magic "This price looks off" count drops from about 837 toward about 83. [10-13]
58. PASS 10-14 (Cromat Apocalypse foil $57.30): Spot-check 3 capped Magic foils (e.g. Cromat Apocalypse foil about $57, not $155). [10-13]
59. PASS 10-14 (catalog-sync.log: done 2:33am ET, failed: none; /admin/prices view needs Chris's sign-in): 10-14 morning: nightly new-cards log ends "done" with nothing failed; /admin/prices shows the 2am run. [10-13]
60. PASS 10-14 (cardmarket_map 30,811 rows on Turso; 5:25am run green): After the push: cardmarket_map rows exist on Turso and the 5:25am price run is still green. [10-13]
61. New cards with no scan borrow another printing's picture, then switch when their own scan appears. [10-13]
62. After tonight, /admin/prices Yu-Gi-Oh "borrowing" is about 233 and falling over time. [10-13]
63. PASS 10-14 (Black Lotus Alpha $37,780.37 from EUR 33,768): Next 5am Magic run: Cardmarket euro fill about 400; Black Lotus Alpha shows a dollar price. [10-13]
64. PASS 10-14 (ST30-ST36 all priced, 0 unpriced): One Piece ST31-36 reprints show their original's price after the 5:25am run. [10-13]

## E. Mine (scripts, curl, browser pane) - 19

65. PASS 10-14 (Vercel logs past day: 0 'static to dynamic', 0 'fx'; only error = one seller's expired eBay refresh token): FIX two recurring prod errors: "static to dynamic at runtime /cards/magic" and "fx: rate refresh failed". [10-11]
66. DONE 10-14 (results in SOCIAL-AUTOPILOT.md: 7am Guess 218, 1pm Movers 240, 7pm Head to Head 298; no hand weighting, the optimizer scores site+slot with TikTok 3x): Read the 10-09 TikTok views (question-format test) into SOCIAL-AUTOPILOT.md; decide 7pm weighting. [10-10]
67. PASS 10-14 (Facebook 8 of last 9 posts = 7 tags; the 9th is a Lorcana post with 6 on every site = its tag list): Facebook posts: count hashtags (X and Bluesky already passed). [10-07]
68. HALF 10-14 (pixel DB15TMRC77UEN9IUIBPG loads on the scan page and pixelTrack is wired; events need a real camera scan and Events Manager needs Chris's TikTok Ads sign-in -> moved to B): TikTok Events Manager: ViewContent and ClickButton still arriving from /scan. [10-06]
69. PASS 10-14 (Google shows 'CardFlip: Pokémon & Yu-Gi-Oh! Card Scanner and Prices' = live title): Google Search Console: Google shows the new home page title. [10-06]
70. DONE 10-14 (past-day warnings had no ?key= line, no task/workflow/script sends it; ?key= support REMOVED, header only, commit pending push): Vercel logs: no "?key=" warnings for a week, then drop ?key= support. [10-06]
71. PASS 10-14 (from Turso, signup-page visitors -> accounts: 09-27..10-06 0/13, 10-07..10-13 19/52 = 37%; small numbers, ad traffic started 10-07): /admin/adtest: signup-page "made an account" rate is improving after the Username rename. [10-07]
72. MOVED TO B 10-14 (bounces land in the Fastmail mailbox, not either Gmail in the pane: 0 bounces there; needs Chris's Fastmail login): Fewer "Undelivered Mail Returned" bounces at support@ from welcome emails. [10-07]
73. PASS 10-14 (curl, 0 storage/foreign refs): Hub pages /cards/one-piece, /pokemon, /lorcana: 12 of 12 tiles show, all from cardflip.io/pics. [10-13]
74. PASS 10-14 (curl, 0 storage/foreign refs): Homepage hero card, wall and games strip all load from /pics. [10-13]
75. PASS 10-14 (curl, 0 storage/foreign refs): Card pages' pictures come from cardflip.io/pics; view-source shows no storage address. [10-12]
76. PASS 10-14 (foreign Referer 200 + logged 1 hit; no Referer 200 no hit; past day = only my test hit): Hotlink test with curl: foreign Referer logs a firewall hit; no Referer gets 200 and no hit. [10-12]
77. DONE 10-14 (Chris yes: rule now DENY, allow-list + webmail live.com/outlook/office/aol/icloud + vercel.app/trycloudflare/localhost; curl: outside 403, Outlook/tunnel/own/Google/no-Referer 200): After a clean day of LOG-only hits, switch the hotlink rule to DENY. [10-12]
78. PASS 10-14 (/api/share/card YGO Big Core + Umbreon VMAX: 200 PNG with card art): Share-card picture renders card art (art fetch reads our copy). [10-12]
79. PASS 10-14 (live search Elsa lorcana: 32/32 thumbnails cardflip.io/pics): Lorcana header search "Elsa": result thumbnails come from our storage. [10-12]
80. PASS 10-14 (no $213,589 anywhere: live search shows 3 printings at $5.31/$2.05, $3.70, $0.11; Turso has no other Axel row, the bad price is gone from the catalog): After push: searching "Genex Ally Axel" shows "This price looks off", not $213,589. [10-13]
81. PASS 10-14 (live base1-4 picture /pics/pokemon/base1-4-a332bdb6.webp is the unstamped unlimited print; no rerun needed): After push: run sync-first-edition --prod; Base Set Charizard 4/102 then shows no 1st Edition stamp. [10-12]
82. PASS 10-14 (Turso cards.scan_market exists; 10+ new cards since the push carry it): After push: Turso has the scan_market column and a new pack pull stores it. [10-12]
83. PASS 10-14 (Turso YGO 60,193/60,193 own pictures; 12 prod-only rows had none -> copied local, saved 11 exact TCGplayer pictures screened by eye, Red-Eyes Black Dragon Exceed 719879 403 = borrowed printing until nightly retry finds it): After push: Yu-Gi-Oh saved pictures intact on Turso (at least 59,969) and the 22 new rows have pictures. [10-13]

## X. CLOSED 10-13 (Chris: "yes close the 6") - 6

84. One Piece tiles come from the blob storage address [10-12]: tiles now served from /pics.
85. Pokémon card page picture from the blob address [10-12]: superseded, everything now /pics.
86. Lorcana tile right-click shows the blob address [10-12]: superseded, pictures now /pics.
87. Game hub / Other-printings strips still show lorcast links [10-12]: hub pictures now all /pics.
88. Real eBay label at $1.11 or less, Ground about $7 [10-08]: prices now $0.78, $1.31, $6.07.
89. Search page "Card Missing? Tell Us" question [10-08]: already shipped (49575e22).
