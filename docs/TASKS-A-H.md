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
7. Prices by condition (Near Mint and played values) [me] S
8. Weekly accuracy scorecard: 20 random cards vs eBay sold, cause fixed same day [me] S weekly
9. "Price looks wrong?" button feeding the manual check [me] S
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
21. The Magic price limit cuts some old cards too low (e.g. Alpha Blaze of Glory $400 vs ~$579), and it has no lower limit for $1 junk listings [me] M
22. DONE 10-17 (local, not pushed; limit now starts at 1.45x, eBay sold sample 9 of 10 closer): Pokémon price-limit jump: a $99 card stays $99, but at $100 it drops to $72.50. Smooth it out [me] S
23. Nightly catalog upload resends everything; send only what changed [me] M
24. DONE 10-17 (local, not pushed; prod showed only /api/auth/me twice, the second from PendingWatch: now uses the app's session, /api/watch/pending once too): Inventory still loads a couple of things twice; confirm and trim [me] S
25. The support ticket photo picker allows gallery photos (camera-only rule?) [you decide] S
26. DONE 10-17 (local, not pushed; 25,000 unsold cards, 1,000 watched, newest 500 lookups kept; prod max today 45/6/14): No per-user limit on how many cards, price checks or watchlist items an account can add [me] S

## D. Security cleanup (from the 10-16 audit)
27. eBay actions skip the subscription check, one eBay account can link to several users, and the eBay connect step can crash [me] M
28. A refund or dispute doesn't cancel the subscription, and an account with a failed payment counts as subscribed forever [me] M
29. Rate limits don't hold across servers [me] M
30. Login and sign-up let someone check which emails have accounts [me] S
31. Turning off 2FA or changing email doesn't sign out other devices, and sessions never expire [me] M
32. Admin sign-out can't really end the session, and the admin key has a weak fallback [me] M
33. A few input checks are missing (image type, list sizes, bad notification addresses) [me] S
34. Sign-up takeover (audit #2): on hold, your call [you] M

## E. Checks on things already live
35. After today's push: titles, Common questions, chart "All", set strip, Most valuable sets, Top 100, not-found pages, unsubscribe, privacy page (docs/TO-TEST.md) [me] S
36. After today's push: a quick look on your phone at a card page, a set page and a game page, plus the tiles with long prices from the 10-16 push (was B13, never confirmed) [you] S
37. FLIPBACK: recheck who came back (0 of 16 so far; code good to 11-16) [me] S
38. Number keypad on Inventory price boxes, on your phone [you] S
39. A "No match found" scan gives the scan back [you] S
40. My checks: password-reset email, the come-back email button, inventory thumbnails, Google sign-in, Inventory speed, the UK cookie bar, Sunday's digest sends once, eBay sold prices load, the night jobs ran, renewals still add scans, ad sign-ups get 5 free scans [me] S each
41. Next real eBay listing goes up as quantity 1 [you] S
42. Real-money checks: welcome email, price-dip email, Finances after a sale, ended-listing sync, offers, a multi-quantity order [you] M

## F. Catalog
43. Hand-check odd high prices on eBay (Smaug foil $24,500, a One Piece card at $13,000, 1st Edition Base Charizard $10,000 flat) [me] S
44. Uria at $999.97 sits 3¢ under the $1,000 hand-check limit; consider moving the limit [me] S
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
57. Uptime ping every 15 minutes [me] S
58. Revisit hosting plans at 10,000+ users [me] S
59. Soft launch to 20 to 30 invited sellers [you] L
60. Parked by the freeze: auto-scan, reveal sounds, the "Not this card?" redesign, invite rewards, sales tax estimate, dealer tier, more grading/price sources, selling on TCGplayer.

Skipped / blocked (for the record): search-result Product/FAQ markup (Search Console error, no rich results); recent sold
sales list per card (no allowed eBay source); PokeData as a price source (non-commercial API, 2/5 accurate); sealed
product pages, "+X% since release" stats, investment articles.
