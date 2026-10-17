# Chris's task list (updated 10-17 after the push of 90033b03; was the A-H list of 10-16)

One task at a time, easiest first. [me] = Claude does it, [you] = Chris. S/M/L = size.
Removed 10-17 (pushed = live but NOT yet verified on prod, see E35/E36): account deletion test, privacy policy, 10-16 push, euro rate guard, flaky campaign test (no change needed),
not-found pages, robots apple icon, dev-login defaults, unsubscribe confirm, FLIPBACK morning report, and the competitor
tasks #58 #59 #61 #62 #63 #65 (+ #66 #67 already existed, #57 skipped). All pushed 10-17 in 90033b03.

## A. Prices (TOP PRIORITY, Chris 10-17)
1. Price fallback step 1: wire the guard's fallback price into the scanner, Inventory and card pages so no card shows $0 or "looks off" (code in place, 83f8c77c) [me] M
2. Finish the price test: Lorcana eBay prices (17 cards) + One Piece (20), then the final per-game breakdown [me] S
3. PriceCharting sub (Legendary, $49/mo; free display until $1,000/mo revenue, then a cut; attribution = text link) [you] S
4. After the sub: PriceCharting as the main price, matched by TCGplayer ID, TCGplayer only where it has none [me] M
5. After the sub: "Based on N sales" + "few sales" label on card pages and scan results [me] S
6. Daily 4-source price cross-check (PriceCharting, TCGplayer, eBay asks, Cardmarket); big jumps go to a check queue [me] M
7. CHECKED 10-17, nothing built: prices by condition already show as an ESTIMATE (card pages "Estimated price by condition" + the app asking price use NM 100% / LP 85% / MP 70% / HP 55% / DMG 40%). No free source has real played prices (TCGplayer feed = one market price per printing, no condition; eBay sold API denied); revisit with PriceCharting [me] S
8. Weekly accuracy scorecard: 20 random cards vs eBay sold, cause fixed same day [me] S weekly. Week 1 (10-17): 11 of 17 = 65% within 25% (docs/price-scorecard/2026-10-17; sampler scripts/_scorecard-sample.mjs). Misses = TCGplayer market frozen/lagging (Zubat RH 153 days flat, Exodia Necross 25th $52 vs ~$15, Electrode 1st $36 vs $21); fix = PriceCharting first (finale). Next run ~10-24
9. DONE 10-17 (local, not pushed; Chris OK on shots docs/shots/price-report-1..3): "Price looks wrong?" button feeding the manual check (card pages; /admin/prices "Readers flagged") [me] S
10. Reapply for eBay Marketplace Insights (sold data) [me writes, you send] S
11. Catalog: Vivillon wing patterns (and similar) are lumped into one card [me] M

## B. App store prep (the main goal)
12. Sign in with Apple: required if Google/X logins stay on iPhone [you decide, I build] M
13. Decide how iPhone payments work: Apple's in-app purchase vs our web checkout [you] M
14. Build the app shell (Capacitor) around the site [me] L
15. Developer accounts: Apple $99 a year, Google $25 once [you] S
16. iPhone cloud build plus TestFlight beta [me] M
17. Google's closed test: 12 testers for 14 days [you] L
18. Store listing: text, screenshots, privacy answers, a reviewer login [me writes, you approve] M
19. Full check on your real phone before launch, from a checklist I write [you] L
20. Stripe receipts show your home address. That's a blocker before launch; it needs a business address [you] M

## C. Bugs and polish
C0. DONE 10-17 (local, not pushed; covers, set index and /api/sets serve the old copy and rebuild after): Pokémon set list rebuild takes ~21 s once a day (seo:sets:v4, json walk of price_series): the first visitor waits and the 2am + 7am ET Production smoke failed 10-17 on it. Serve the stale list while rebuilding (cachedListSwr; block only when no row exists) [me] S
21. CHECKED 10-17, no code change: The Magic price limit cuts some old cards too low (e.g. Alpha Blaze of Glory $400 vs ~$579), and it has no lower limit for $1 junk listings [me] M. The soft cap (1.45x the cheapest listing for pre-1996 / $100+, live since 10-16) now lands in eBay sold ranges: Blaze $579.99 (sold $579-695), Bog Wraith $80.11 ($79-91), Jace WWK foil $194.56 ($180-205), Pirate Ship shows $369.50 ($359). A floor from listings would be wrong: 486 Magic prices sit 1.5x+ under the cheapest listing, but those listings include absurd asks ($66,656 for a $300 serialized foil). Fury/Grief SLD (~$650 vs ~$1,000 sold) need sold data = PriceCharting. $1 junk floor: no case found (Metamorphic Wurm $1.30 matched eBay $2-8). FOUND: Blaze's page shows NO price (LESSONS 10-17) = #1
22. DONE 10-17 (local, not pushed; limit now starts at 1.45x, eBay sold sample 9 of 10 closer): Pokémon price-limit jump: a $99 card stays $99, but at $100 it drops to $72.50. Smooth it out [me] S
23. Nightly catalog upload resends everything; send only what changed [me] M
24. DONE 10-17 (local, not pushed; prod showed only /api/auth/me twice, the second from PendingWatch: now uses the app's session, /api/watch/pending once too): Inventory still loads a couple of things twice; confirm and trim [me] S
25. The support ticket photo picker allows gallery photos (camera-only rule?) [you decide] S
26. DONE 10-17 (local, not pushed; 25,000 unsold cards, 1,000 watched, newest 500 lookups kept; prod max today 45/6/14): No per-user limit on how many cards, price checks or watchlist items an account can add [me] S

## D. Security cleanup (from the 10-16 audit)
27. DONE 10-17 (local, not pushed; 40639ee5): eBay actions skip the subscription check, one eBay account can link to several users, and the eBay connect step can crash [me] M
28. DONE 10-17 (local, not pushed; 1cfe8438): A refund or dispute doesn't cancel the subscription, and an account with a failed payment counts as subscribed forever [me] M
29. Rate limits don't hold across servers [me] M
30. DONE 10-17 (local, not pushed; login: one message + one hash for every miss incl. Google/X-only; signup: "already exists" kept, 5 a day per network then sign-up closes to it for any email; shot docs/shots/login-failed-message.png): Login and sign-up let someone check which emails have accounts [me] S
31. DONE 10-17 (local, not pushed; b8fae0da): Turning off 2FA or changing email doesn't sign out other devices, and sessions never expire [me] M
32. DONE 10-17 (local, not pushed; be2ec67b): Admin sign-out can't really end the session, and the admin key has a weak fallback [me] M
33. DONE 10-17 (local, not pushed; imageInput.ts: real picture or 400 before a scan is reserved, type read from the bytes; tiebreak >6 ids refused; bad push subscription 400 not 500): A few input checks are missing (image type, list sizes, bad notification addresses) [me] S
34. Sign-up takeover (audit #2): on hold, your call [you] M

## E. Checks on things already live
35. After today's push: titles, Common questions, chart "All", set strip, Most valuable sets, Top 100, not-found pages, unsubscribe, privacy page (docs/TO-TEST.md) [me] S
36. After today's push: a quick look on your phone at a card page, a set page and a game page, plus the tiles with long prices from the 10-16 push (was B13, never confirmed) [you] S
37. FLIPBACK: recheck who came back (10-17 3pm ET recheck: still 0 of 16 back, 0 redeemed, 0 scans; code good to 11-16; recheck weekly) [me] S
38. Number keypad on Inventory price boxes, on your phone [you] S
39. A "No match found" scan gives the scan back [you] S
40. My checks: password-reset email, the come-back email button, inventory thumbnails, Google sign-in, Inventory speed, the UK cookie bar, Sunday's digest sends once, eBay sold prices load, the night jobs ran, renewals still add scans, ad sign-ups get 5 free scans [me] S each
41. Next real eBay listing goes up as quantity 1 [you] S
42. Real-money checks: welcome email, price-dip email, Finances after a sale, ended-listing sync, offers, a multi-quantity order [you] M

## F. Catalog
43. DONE 10-17 (eBay sold, no slabs; all three real, nothing hidden): Smaug Gleaming Gold foil $24,500: auctions $19,365 (9-29) + $22,600 (9-10), Aug best-offers listed $30-35k = a bit high, falling, keep. Luffy OP05-119 Gold SP $13,000: English sold $7,600-16,375 (the $3.6-3.8k sales are the Japanese gold) = keep (matches 10-14 keep). 1st Ed Base Charizard $10,000: 14 English raw sold $2,000-15,000 by condition, best auctions $12,700 (78 bids) + $7,066 (50 bids), median ~$7,650 = right for a clean copy, keep [me] S
44. DONE 10-17, no change: Uria SOI-EN001 Ultimate Rare 1st $999.97 is real (eBay raw auctions $1,025 10-11, $910 10-04, $1,005, $990); the Ultra Rare 1st is its own card ($26.83, eBay $6-35). The $1,000 limit only holds back prices with under 14 days of history, Uria has 16+, so moving it changes nothing [me] S
45. 3 One Piece cards with no picture [you're hunting] S
46. Magic Art Series cards have no prices [me] M
47. Unpriced old cards (about 900 total): hide or leave? [you decide] S
48. Magic and Pokémon catalog updates still run from your PC [you] M
49. Should Pokémon get a stronger price-limit check? [you decide] S

## G. Social and marketing
50. Daily 7pm post check [me] S
51. Remove the Magic "weekly moves" pause after 10-21 [me] S
52. Google Ads: separate link tags per campaign [you] S
53. Pinterest API: record a new demo and reapply [you] M
54. Set up a support@cardflip.io Google account for Google sign-in [you] S
55. Search-engine links to card pages: wait for the ~10-23 Search Console check first [me] M
56. Pokémon character pages (all of one Pokémon's cards, total value, top 10): held for the same ~10-23 check [me] L

## H. Ops and later
57. DONE 10-17 (local, not pushed): Uptime ping every 15 minutes. GitHub's "every 15 min" smoke really ran every 2-4 h, so Vercel Cron /api/cron/uptime now checks database + home page + a card search every 15 min, retries once, mails on failure (also when the database is down); $0 [me] S
58. Revisit hosting plans at 10,000+ users [me] S
59. Soft launch to 20 to 30 invited sellers [you] L
60. Parked by the freeze: auto-scan, reveal sounds, the "Not this card?" redesign, invite rewards, sales tax estimate, dealer tier, more grading/price sources, selling on TCGplayer.

Skipped / blocked (for the record): search-result Product/FAQ markup (Search Console error, no rich results); recent sold
sales list per card (no allowed eBay source); PokeData as a price source (non-commercial API, 2/5 accurate); sealed
product pages, "+X% since release" stats, investment articles.
