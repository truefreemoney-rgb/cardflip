# Chris's A-H task list (given in chat 10-16 ~7pm ET; saved 10-16 ~9:45pm ET)

One task at a time, easiest first. [me] = Claude does it, [you] = Chris. S/M/L = size.
Section D recovered from session a04629b6 transcript.

## A. App store prep (the main goal)
1. DONE 10-16 locally (5299b9fe): Test in-app account deletion end to end for Google, X and TikTok sign-ups [me] M
2. Sign in with Apple: required if Google/X logins stay on iPhone [you decide, I build] M
3. DONE 10-16 locally: Check the privacy policy against what Apple and Google require [me] S
4. Decide how iPhone payments work: Apple's in-app purchase vs our web checkout [you] M
5. Build the app shell (Capacitor) around the site [me] L
6. Developer accounts: Apple $99 a year, Google $25 once [you] S
7. iPhone cloud build plus TestFlight beta [me] M
8. Google's closed test: 12 testers for 14 days [you] L
9. Store listing: text, screenshots, privacy answers, a reviewer login [me writes, you approve] M
10. Full check on your real phone before launch, from a checklist I write [you] L
11. Stripe receipts show your home address. That's a blocker before launch; it needs a business address [you] M

## B. Waiting on a push
12. DONE 10-16 ~8:08pm ET: Push the 5 local commits (watchlist pill plus the no-extra-rows fixes) [you OK] S
13. After the push, a quick look on your phone at the tiles with long prices [you] S

## C. Bugs and polish
14. The Magic price limit cuts some old cards too low (e.g. Alpha Blaze of Glory $400 vs ~$579), and it has no lower limit for $1 junk listings [me] M
15. Pokémon price-limit jump: a $99 card stays $99, but at $100 it drops to $72.50. Smooth it out [me] S
16. Euro exchange rate is never checked for age, and one missing currency freezes them all [me] S
17. Nightly catalog upload resends everything; send only what changed [me] M
18. Inventory still loads a couple of things twice; confirm and trim [me] S
19. The support ticket photo picker allows gallery photos (camera-only rule?) [you decide] S
20. One flaky automated test (email campaigns) [me] S
21. Unknown card and set links should show a proper "not found" page [me] S
22. DONE (already live 10-16, d7e8ccb9; checked 10-16 ~10:15pm ET: /apple-icon.png 200, not blocked): robots.txt hides the Apple app icon from search engines [me] S
23. DONE 10-16 locally: Leftover dev-login defaults ("admin"/"password") sit in the live site's code. They do nothing there, but they should be removed [me] S
24. Email unsubscribe links can be triggered by email scanners; add a confirm step [me] S
25. No per-user limit on how many cards, price checks or watchlist items an account can add [me] S

## D. Security cleanup (from the 10-16 audit)
26. eBay actions skip the subscription check, one eBay account can link to several users, and the eBay connect step can crash [me] M
27. A refund or dispute doesn't cancel the subscription, and an account with a failed payment counts as subscribed forever [me] M
28. Rate limits don't hold across servers [me] M
29. Login and sign-up let someone check which emails have accounts [me] S
30. Turning off 2FA or changing email doesn't sign out other devices, and sessions never expire [me] M
31. Admin sign-out can't really end the session, and the admin key has a weak fallback [me] M
32. A few input checks are missing (image type, list sizes, bad notification addresses) [me] S
33. Sign-up takeover (audit #2): on hold, your call [you] M

## E. Checks on things already live
34. FLIPBACK results tomorrow morning: who came back and redeemed [me] S
35. Number keypad on Inventory price boxes, on your phone [you] S
36. A "No match found" scan gives the scan back [you] S
37. My checks: password-reset email, the come-back email button, inventory thumbnails, Google sign-in, Inventory speed, the UK cookie bar, Sunday's digest sends once, eBay sold prices load, the night jobs ran, renewals still add scans, ad sign-ups get 5 free scans [me] S each
38. Next real eBay listing goes up as quantity 1 [you] S
39. Real-money checks: welcome email, price-dip email, Finances after a sale, ended-listing sync, offers, a multi-quantity order [you] M

## F. Prices and catalog
40. Hand-check odd high prices on eBay (Smaug foil $24,500, a One Piece card at $13,000, 1st Edition Base Charizard $10,000 flat) [me] S
41. Uria at $999.97 sits 3¢ under the $1,000 hand-check limit; consider moving the limit [me] S
42. 3 One Piece cards with no picture [you're hunting] S
43. Magic Art Series cards have no prices [me] M
44. Unpriced old cards (about 900 total): hide or leave? [you decide] S
45. Magic and Pokémon catalog updates still run from your PC [you] M
46. Should Pokémon get a stronger price-limit check? [you decide] S

## G. Social and marketing
47. Daily 7pm post check [me] S
48. Remove the Magic "weekly moves" pause after 10-21 [me] S
49. Google Ads: separate link tags per campaign [you] S
50. Pinterest API: record a new demo and reapply [you] M
51. Set up a support@cardflip.io Google account for Google sign-in [you] S
52. Search-engine links to card pages: wait for the ~10-23 Search Console check first [me] M

## H. Ops and later
53. Uptime ping every 15 minutes [me] S
54. Revisit hosting plans at 10,000+ users [me] S
55. Soft launch to 20 to 30 invited sellers [you] L
56. Parked by the freeze: auto-scan, reveal sounds, the "Not this card?" redesign, invite rewards, sales tax estimate, dealer tier, more grading/price sources, selling on TCGplayer.
