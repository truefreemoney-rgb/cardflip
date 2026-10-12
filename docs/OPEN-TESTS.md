# Open tests (cleaned 10-11 ~10pm ET)

Was 97. Claude closed 18 tonight (15 passed on prod, 2 out of date, 1 turned into a fix task; reasons are written next to each one in docs/TO-TEST.md). **80 left** (a few were merged or split), sorted by who does them and where.

---

## A. You, on the tunnel (phone camera, nothing goes live) — 34

**Scanner: give-back (10-11)**
1. Scan a real card, tap Done: the "Which category?" sheet opens.
2. Magic card with Pokémon selected: says "That looks like a Magic card", scan given back.
3. Not-a-card (book, receipt): "No match found"; scan counter does not go up; Account shows the same trial count.
4. Real card right after: it counts (counter goes up and stays).
5. Magic token or art card: "not accepted" and it DOES count.

**Scanner: faster scans (10-11)**

6. Card with a near-twin (Eevee TG11, or a 1st Edition card): shows within ~3 s; if the check later disagrees, the card swaps and says "the photo looks more like this printing".
7. Verify a card right after it shows: nothing changes it afterwards.
8. 5 cards in a row: feels faster; prices still fill in.

**Scanner header after a scan (10-11)**

9. ✅ 10-12 No Seller/Collector switch; Add Cards + Inventory → are two equal pills; Inventory → opens Inventory.
10. ✅ 10-12 "1 card · $0.85" and "1 ready · 0 live · 0 pending" each on one line, eBay button and X beside them, nothing cut off.
11. ✅ 10-12 Before scanning, and on Account and Inventory: Seller/Collector switch still there; the tour's "Your switch" step lands on it.

**Scanner older fixes (10-06 / 10-08)**

12. Trial account on its LAST scan: close the camera → out-of-scans wall shows right away, no reload.
13. Scanner result: no "Check the art … Switch" banner on a card with a pricier twin.
14. A "Took too long" scan can be scanned again, and pick-by-name works on that row.
15. No ghost card in Inventory after a "Took too long".
16. A slow scan says "Took too long — tap Capture again" right away (no 14 s wait).
17. Double tap on Capture = one photo, one scan charged.
18. Trial account using its last free scan mid-session keeps its queue (wall only on the next visit).
19. Out of scans: red note shows inside the camera.
20. Opens on a game that has cards when the last-used game has none.
21. "Not this card?" on the camera chip: other picks + search by name; picking one updates name and price, no extra scan charged.
22. Verify-all sheet after a stack of scans: doubtful ones first; Confirm marks the rest verified.
23. At phone width, "Not this card?" and Verify fit side by side.
24. ✅ SUPERSEDED 10-12 (now $0.78 / $1.31 / $6.07, passed) Scan editor: Envelope $0.82 / Tracked mailer $7.00 tiles; Envelope greys out above $20 ($20.00 allowed, $20.01 not); note says "$20 or less".

**Inventory**

25. ✅ 10-12 (Chris, tunnel: one sheet with the count 2, Yes marked both sold; Cancel not reported) Bulk select live cards → Mark sold (N): Are-you-sure sheet with the count; Cancel leaves them live; Yes marks them sold.
26. ✅ 10-12 (Chris, tunnel, after 37c6e6e7: Share pill under Add to watchlist, bigger filled X) With a card open: the round X next to Subscribe Now closes it; Share sits inside the card panel.
27. ✅ 10-12 Collector mode: no "Collection value" box above Market Value.
28. ✅ 10-12 (Packs overflowed the box border by 4px, fixed: re-check Packs) Game chips row (Inventory, Set Completion, Packs, /scan): one line of small chips, no box, scrolls sideways, no "0" printed.
29. ✅ 10-12 (Chris, tunnel, two drafts: both changed) Bulk Set condition / Set price on a few cards (price skips live/sold ones).
30. 60+ cards: "Show more" appears; Select all says the full count.
31. Duplicates and Missing-price chips; Name A–Z and Set sorts work.
32. ✅ 10-12 (Chris, tunnel, stand-in live Pikachu with the tracked pick) A live or sold card shows "How to ship it · <pick>" with the 4 steps; "Both ways" opens the sheet.
33. Load failure shows Retry (Sales Report and Set Completion too).
34. Packs: Open a Pack → pick game, name, price → scan 3 → banner shows pulls and value → Done opens the pack page (cost, value, profit, ROI, best pull). Share makes a "My Pack" picture. Inventory > Packs lists them. Deleting a pack keeps its cards.

---

## B. You, on cardflip.io (needs the real site) — 27

**Sign-in**

35. Let a sign-in code expire, tap the blue "Send a New Code": new email, newest code works. (And: want it as a full-size button?)
36. Sign up with email + password, log out, Continue with Google with the same email: same account, password still works.
37. A Google-only account typing a password sees "signs in with Google"; Forgot Password lets it set one.
38. Second Google signup from the same phone starts with free scans already used.
39. Sign in with X, 8 steps: button on /login and /signup; shared-email X account goes straight in; no-email X account gets "One more thing", code works; matches an existing account and links; admin/authenticator account refused; email that already has an account says "Log in with it instead".
40. Google One Tap: close it with X, it never comes back on that phone.
41. One Tap never shows when signed in, or on /app, /admin, /login, /signup.
42. One Tap with the admin's Google account: refused, not linked.
43. One Tap on Android Chrome: browser-styled account picker, same behaviour.

**Money (live Stripe)**

44. Out-of-scans wall: Booster button opens live checkout for $4.99.
45. Subscribe button opens live checkout for $9.99/mo.

**Emails**

46. Each "Send Test To Me" on /admin/emails: [TEST] mail arrives; pictures, prices, buttons, Stop link all right on the phone.

**Pages and phone app**

47. /pokemon/<name>-card-value: "Start Your Free Trial" button under "Scan Your X Card Free", lands on /signup.
48. Scan Lugia ex Unseen Forces 105: "looks off, check sold listings" note, not $2,500.
49. Home page card peek: close with X AND by dragging the handle — page stays where it was (third fix shipped, not retested).
50. Loading skeletons show on slow 4G for Inventory, card pages, set pages.
51. Grey text readable in sunlight.
52. /scan doesn't flash the camera button for someone who already used the free scan.
53. Airplane mode inside the app shows the No Signal page; push still works.
54. Home-screen icon long-press shows Scan and Inventory shortcuts (Android only).
55. Too many scans fast → "wait N seconds"; daily limit → "try again tomorrow".
56. Miss / busy panels show the sign-up link.
57. Ad signup from /scan skips "How will you use it?", lands in the scanner as Seller.
58. Normal signup still gets that question.

**eBay**

59. No shipping pick → eBay button says "Pick a shipping option to publish"; after a pick, confirm line says free shipping for the buyer.
60. Accept Offers on: push a card, Seller Hub shows Best Offer auto-accept 90% / auto-decline 70%; reprice moves them.
61. Tracked Shipping (only once EBAY_VALUE_SHIPPING=1 is set): card over the threshold shows tracked postage.

---

## C. Your decision (no test) — 1

62. Search page with a made-up name: add "Card Missing? Tell Us" there too, or leave it only in the scanner and card editor?

---

## D. Waiting on something real to happen — 10

63. First real sale: "Your card sold" push AND mailing-steps email arrive.
64. Real eBay Envelope label ≤ $1.11 for a ≤ $20 card; Ground Advantage ~ $7.
65. A real sale is recorded once (two tabs open at sync time).
66. Seller with 26+ live listings: an eBay-side end on #26+ shows in Inventory.
67. First Booster or plan purchase from an ad signup shows in /admin.
68. First sign-up from an ad shows in Google Ads Goals > Sign-up (within ~48 h).
69. First Stripe purchase shows in Google Ads Goals > Purchase.
70. From ~10-14: Yu-Gi-Oh / Lorcana / One Piece $1,000+ cards show in top lists.
71. 10-16 evening: reach-trial review (Instagram / Threads / X views vs baseline; revert if no lift).
72. eBay reconnect warning 30 days before the link expires (first ones ~2028).

---

## E. Claude, later (no phone needed) — 8

73. FIX: two recurring prod errors — "Page changed from static to dynamic at runtime /cards/magic/…" and "fx: rate refresh failed … Dynamic server usage".
74. Read the 10-09 7am / 1pm TikTok views (question-format test) into SOCIAL-AUTOPILOT.md; 7pm Head to Head got 296, the best of the week.
75. Facebook posts: count hashtags (X and Bluesky passed).
76. TikTok Events Manager: ViewContent / ClickButton still arriving from /scan.
77. Google Search Console: Google shows the new home title (the site already serves it).
78. Vercel logs: no "?key=" warnings for a week, then drop ?key= support.
79. Signup-page rate (/admin/adtest) and email bounces at support@ — read the trend.
80. /admin funnel shows ad-page signups as landing /scan (no ad has landed on /scan yet; the ads go to the home page).
