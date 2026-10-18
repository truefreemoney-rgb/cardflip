# Task list, updated 10-18 ~11:30am ET (after the "do everything you can on your own" sweep)

[me] = Claude, [you] = Chris. DONE items keep their number so nothing gets renumbered.
Unpushed commits: see `git log origin/main..HEAD` (no pushes until Chris says).

## A. Today (10-18)
1. [you] Sign in to admin in the pane -> [me] mark today's 1pm + 7pm post cards "Looks right", and "Right, keep"-free now (Charizard got a price fix instead).
2. [you] Open cardflip.io/?heat=off once on phone + PC. (Mine is done.)
3. [you] Admin sign-in lands on Overview first try (PHONE-CHECKS.md part 6).
4. [you+me] 1pm TikTok + Pinterest by hand.
5. [me] 1:05pm posts check: SCHEDULED 1:12pm.
6. [you+me] 7pm TikTok + Pinterest; [me] 7:05pm posts check SCHEDULED 7:13pm.
7. [me] Sunday digest/week mail sends once: SCHEDULED 6:47pm.
8. DONE Lorcana Sunday sync ran (3,505 cards, own pictures kept).
9. DONE last night's run: no failures, catalog push (last full one, 549 s), art versions + Ascended Heroes rows got today's price, Cresselia $102.99, exchange rates fresh.

## B. Prices
10. [me] 10-19 morning: price_checked rows get tonight's TCGplayer number (now 7 rows).
11. DONE early: the 4 fixed card pages already show "Checked against recent eBay sales", no stale "Down" lines.
12. DONE in code already (checked cards sit out of posts automatically; the hand hold list is empty).
13. DONE "Most valuable sets" on all 5 game pages.
14. [me] 10-19: set lists smoke green a 2nd day (10-18 2am + 7am green; /api/sets 0.1 s).
15. DONE Few sales: Pikachu 1st $187.13, Shinx $165, Volcanic Eruption $119.99, Ancient Mew $115.93 all show "Few sales".
16. DONE Blaze of Glory: was $440.74 (stale since 10-13) -> fixed to $637 from eBay sold.
    NEW same day: Base Set Charizard was BLANK ("looks off" on TCGplayer's $954.65) -> fixed to $600 (NM sold $507-658);
    Dark Charizard 1st Ed holo $62.35 (the 10-17 "-49%" post) -> fixed to $700 (Oct sold $400-1,250). Pages update by ~10-20.
17. DONE Magic run: 2,564 capped to listing, 670 Cardmarket-filled (10-18).
18. [me] ~10-20: eBay listing check at 4,133 readings / 3,925 cards (target ~4,500).
19. [you] First real "Price looks wrong?" tap (0 so far).
20. [me] ~10-24 weekly price scorecard.
21. [you] PriceCharting: Brady's answers, then subscribe.
22. BUILT (commit only): PriceCharting import pipeline + day-1 runbook docs/PRICECHARTING-DAY1.md. Left for day 1: the
    switch that shows their price (needs real rows), Lorcana/One Piece matching.
23. [you] Decide: ~900 unpriced old cards, hide or leave.
24. [you] Decide: stronger Pokémon price limit.

## C. App store
25-30, 33-34. [you] decisions/accounts as before (Apple sign-in, iPhone payments, dev accounts, Google test, business address, soft launch).
27, 29. [me] app shell + TestFlight: on hold until you're ready.
31. DRAFTED docs/APP-STORE-LISTING.md (needs your OK; plans text waits on #26).
32. WRITTEN docs/LAUNCH-PHONE-CHECKLIST.md (for when the app build exists).

## D. Bugs, security, live checks
35. [you] Support ticket photo picker: gallery allowed or camera only?
36. [you] Sign-up takeover fix: your call.
37. [me] Security fixes live: login message, bad image 400, cron routes 403 PASS; refund/dispute/2FA/session checks are
    covered by automated tests and get a live check on the first real event.
38. DONE uptime cron registered (*/15) and no failure mail.
39. DONE share picture cached (2nd open HIT).
40. [me, needs your admin sign-in in the pane] Inventory speed + cookie bar.
41. DONE 10-16 junk post gone (Bluesky checked); 10-17 1pm post check found Dark Charizard -> fixed (#16).
42. [me] Heat map: 18 real visits, 0 admin rows. 10-19: compare with Analytics; the frame check needs your sign-in.
43. DONE Charizard 4/102 has no 1st Ed stamp; scan_market column exists.
NEW 43b. DONE (commit only) weekly log cleanup had not run since 10-08 (split crons) -> now runs in the tcg-prices cron.
NEW 43c. [you OK?] 2 leftover email rows of an account deleted before the 10-17 fix: delete them?

## E. Phone checks for you
44-49. WRITTEN as numbered steps: docs/PHONE-CHECKS.md (6 parts, ~20 min).

## F. Catalog
50. [you] 3 One Piece cards with no picture.
51. [me] 10-19: catalog upload sends only changed rows; new cards appear.
52. [you] Magic + Pokémon updates still run from your PC.
53. DONE Magic pictures: 98,798 of 98,960 are ours (162 have no picture anywhere).
54. DONE Yu-Gi-Oh borrowed pictures down to 45 (from ~233).
55. DONE as far as possible: 9 Art Series unpriced; 1 fills tonight, 8 aren't sold on TCGplayer.
56. [me] Lorcana "Coconut" pictures after release.

## G. Social, marketing, SEO
57. [me] Every day: 3 posts, each card eBay-checked before :05.
58. [me] After 10-21: remove the Magic weekly pause.
59. DONE FLIPBACK recheck: 0 of 16 back (next ~10-25).
60. DONE reach trial: Instagram ~2x views (16.7 vs 8.4), X up (17.8 vs 14.6), Threads flat -> kept. TikTok format test: no winner.
    Watch: TikTok views/post fell 440 -> ~160 since 10-10.
61. [me] ~10-23 Search Console check, then card-page links + Pokémon character pages (~10-30).
62. [you] Google Ads: link tags per campaign, Leads choices. Business name "CardFlip" still "under review" (since 10-17).
63. [you+me] Pinterest API: new demo + reapply.
64. [you] support@cardflip.io Google account.
65. [you] eBay Partner Network approval.
66. [you] Parked choices: invite a friend, sales tax, auto-scan, reveal sounds, "Mark sold", shipping tier line, Jenny's trial size.
