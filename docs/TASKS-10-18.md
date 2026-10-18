# Full task list, 10-18 (from STATE, TASKS-A-H, TO-TEST, BACKLOG, LESSONS, 10-11..10-18)

[me] = Claude, [you] = Chris. Line refs = where the detail lives.

## A. Today (10-18)
1. [you] Sign in to admin in the pane; then [me] mark today's 1pm + 7pm post cards "Looks right" on live /admin/prices (TO-TEST top block).
2. [you] Open cardflip.io/?heat=off once on phone and once on PC.
3. [you] Admin sign-in lands on Overview first try, no bounce (LESSONS 10-17 fix, pushed 10-18).
4. [me+you] 1pm TikTok + Pinterest by hand (Downloads\CardFlip TikTok 10-18; you press Post).
5. [me] 1:05pm posts on all sites: no Brock's Ninetales, every card eBay-checked.
6. [me+you] 7pm TikTok + Pinterest (Vivid Voltage); [me] the 7:05pm posts say Vivid Voltage, no Rare Candy, no Magic "this week" card.
7. [me] Sunday digest + 6:30pm week mail go out once per person (email_claims > 0).
8. [me] Sunday 10:30 Lorcana catalog sync kept own pictures.
9. [me] Last night's run: catalog push log + push-state file, art versions got today's price (Vivillon, Red Cheeks, Peelables), Ascended Heroes pattern rows, Art Series gaps 8, Cresselia-EX ~$103 / Victini-EX ~$167, fx rates fresh.

## B. Prices (top priority)
10. [me] 10-19 morning: price_checked rows got TCGplayer's new number; any back within 25% retired on its own.
11. [me] ~10-20 9:45am: the 4 fixed card pages (Snorlax, Ninetales, Minun, Rare Candy) show "Checked against eBay" and lose the stale "Down 33.6%" lines.
12. [me] Then take those cards off the social price hold once movers read the fixed prices.
13. [me] By 10-19: "Most valuable sets" shows on all 5 game hubs (#63).
14. [me] Set lists stay fast: 2am + 7am smoke green two days running.
15. [me] Few-sales checks: 1st Ed Pikachu ~$187 "Few sales", Shinx, Volcanic Eruption; hard-flagged cards still "looks off".
16. [me] Recheck Alpha Blaze of Glory (lea-6) shows a price (LESSONS 10-17).
17. [me] Magic "looks off" count dropped (cappedToListing, cardmarketFilled), Beta Shivan / Ancient Mew / Pokémon listing cap prices.
18. [me] eBay referee: a full week of readings (~10-20), every $100+ card read.
19. [you] First real "Price looks wrong?" vote, then [me] check /admin/prices "Readers flagged".
20. [me] Weekly price scorecard, next ~10-24 (week 1 = 65%).
21. [you] PriceCharting: answers from Brady (8% of what revenue; is one link per page enough), then subscribe ($49/mo).
22. [me] PriceCharting FINALE (build before you subscribe): main price by TCGplayer ID, "Based on N sales", daily 4-source cross-check, One Piece PC test, 1st Ed twins priced, re-score the 94 cards (beat 78%).
23. [you] Decide: the ~900 unpriced old cards, hide or leave (#47).
24. [you] Decide: stronger Pokémon price limit (#49).

## C. App store (main goal)
25. [you] Sign in with Apple, yes/no (#12).
26. [you] iPhone payments: Apple in-app vs web checkout (#13).
27. [me] App shell (Capacitor) (#14), on hold until you're ready.
28. [you] Developer accounts: Apple $99/yr, Google $25 (#15).
29. [me] iPhone cloud build + TestFlight (#16).
30. [you] Google closed test, 12 testers x 14 days (#17).
31. [me writes, you OK] Store listing, screenshots, privacy answers, reviewer login (#18).
32. [you] Full real-phone check from my checklist (#19).
33. [you] Business address for Stripe receipts (#20), together with the MD LLC + iPostal1 upgrade (BACKLOG).
34. [you] Soft launch to 20-30 invited sellers (#59).

## D. Bugs, security, checks on live code
35. [you] Support ticket photo picker allows gallery photos: allowed or camera-only? (#25)
36. [you] Sign-up takeover fix (#34), on hold, your call.
37. [me] Security pushes on prod: Stripe TEST refund/dispute/past-due, eBay paid-only + one eBay account per user, 2FA/email change signs other devices out, admin Sign Out really ends it, login message, bad image = 400.
38. [me] Uptime cron runs every 15 min with ok:true, failure mail path.
39. [me] Rate limits: no "Too many requests" in normal browsing; share picture cached + 429 at 21.
40. [me] Inventory speed under ~1 s, auth/me once, cookie bar above the tab bar (UK).
41. [me] Overdue: the 5 deleted junk 10-16 posts are gone (Instagram may need you); 10-17 1pm had no 30-day-flat "this week" price.
42. [me] Heat map: rows arrive from real visitors, none from admin; frame never records; "Left after one page" sane vs Analytics (10-19).
43. [me] Odd pushed-but-unconfirmed: sync-first-edition --prod ran (Charizard 4/102 no 1st Ed stamp), cards.scan_market column on Turso.

## E. Phone checks for you (I'll write them as numbered steps, one batch)
44. Scanner: Master/Poké Ball + Ascended Heroes pattern preselect, Vivillon orange/pink, near-twin swap, options "..." sheet, card picker, Clear pill, Done button, "Verify match" wording.
45. Watchlist + Search: game pill counts, empty game button, prices + arrows on one line, Alerts clear of the arrow.
46. Inventory: number keypad with "." in price boxes, chart "All" pill, Full price page link, Sylveon envelope price.
47. Card pages / site: "Price looks wrong?" tap, phone nav rows, homepage "Know the card?" pills, Magic sets list no sideways scroll, set/game/card page quick look.
48. Sign-in: wrong-password message, Google sign-in, One Tap closes for good.
49. Real money (when they happen): next eBay listing is quantity 1, first envelope publish, a sale over $20 in Earned, welcome + price-dip mail, ended-listing sync, offers (#41, #42).

## F. Catalog
50. [you] 3 One Piece cards with no picture (Boa Hancock DON!! EB-03, Boa Hancock Gold, Luffy P-700 promo) (#45).
51. [me] 10-19: catalog push sends only changed rows (well under 446 s); a new card from the 10-19 sync is on cardflip.io.
52. [you] Magic + Pokémon catalog updates still run from your PC (#48).
53. [me] Magic pictures self-host (running since 10-13): confirm finished, then tidy BACKLOG.
54. [me] Yu-Gi-Oh borrowed pictures count falling; One Piece SAMPLE stamps retried nightly.
55. [me] Art Series: the last 8 Magic cards with no price (5 are Clues TCGplayer doesn't list).
56. [me] Lorcana "Coconut" set pictures after it releases.

## G. Social, marketing, SEO
57. [me] Every day: 3 posts (7am/1pm/7pm), each card eBay-sold checked on "Post cards" before :05.
58. [me] After 10-21: remove the Magic "weekly moves" pause (#51).
59. [me] FLIPBACK recheck weekly (0 of 16 back on 10-17; code good to 11-16).
60. [me] Overdue: reach trial review (IG/Threads/X views 10-10..10-16; revert sign-off-last if no lift); TikTok question-format numbers.
61. [me] ~10-23: Search Console crawl check, then internal links to card pages (#55) and Pokémon character pages (#56), decision ~10-30.
62. [you] Google Ads: link tags per campaign (#52); Leads optimization choices (held); logo/name approved?
63. [you+me] Pinterest API: record a new demo and reapply (#53).
64. [you] support@cardflip.io Google account for Google sign-in (#54).
65. [you] eBay Partner Network approval, then [me] set the campaign ID.
66. [you] Parked choices, no rush: invite-a-friend, sales tax estimate, auto-scan, reveal sounds, "Mark sold" on Live rows, shipping tier line, Jenny ticket trial size.
