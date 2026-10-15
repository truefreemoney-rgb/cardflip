# Open tests, 10-14 9:40pm ET. Total 83 = A 49 (you) / B 1 (decision) / C 22 (dates, people) / D 11 (mine)

Rebuilt from docs/OPEN-TESTS-10-13.md + docs/TO-TEST.md (Chris 10-14: "add all the new to-do items" / "remove anything we completed"). Everything passed, closed or superseded is gone; the 10-13 file keeps the record. Numbers restart at 1. [date] = when the item was first written.

## A. You, on the real site cardflip.io (phone) - 49, easiest first

Tonight's three pushes (c787d5b0 8:23pm, 6714a500 8:33pm, 1eb76012 8:58pm), one at a time:
1. /scan logged out: the camera button does not flash for a phone that already used its free scan. [10-06]
2. /scan logged out: the no-match and busy panels show the sign-up link. [10-06]
3. Scanner: scan a card; the row's right side reads "Clear" (no ×); tap it: row gone, toast "Cleared <name> — still in your Inventory", Inventory still has the card. [10-14]
4. Scanner: top right reads "Done" beside Connect eBay / Send to eBay; tapping lands on Inventory; nothing wraps at phone width. [10-14]
5. Scanner: open a card, "Remove from Inventory" at the bottom: the sheet names the card; Cancel keeps it; Remove card removes the row AND the Inventory card, Undo toast 5 s. [10-14]
6. Scanner: the reveal chip right after a scan and the Verify All rows say "Clear" and only clear. [10-14]
7. Scanner: a "No match found" row's Clear just clears, toast "Cleared". [10-14]
8. Scanner: a scan the AI was unsure of shows "Verify match" but NO "low-confidence read (40%)" text anywhere (Scanner list or Inventory). [10-14 4am]
9. Inventory: open the Sylveon ex (Envelope pick): eBay Suggested Price $50.26 (same as the scanner's eBay asking), note "$1.31 envelope postage". [10-14]
10. Inventory total / Market value chart (asking basis) still adds up after the refresh. [10-14]
11. A card with NO shipping pick yet: over $20 reads the tracked number, under $20 the $0.78 envelope number. [10-14]
12. Search: Sort & filter sheet, drag the grab bar down a finger's length: it closes. [10-14]
13. Search before typing: switch the game pill: My Watchlist row shows ONLY that game's watched cards; "See all N" matches. [10-14]
14. Search/Watchlist card sheet, the Source/Variant/Low/Market table: a Low above the Market shows "—" (Legendary Collection Pikachu reverse holo). [10-14]
15. Search before typing: "Want to wander by set? Browse the Card Prices pages." under the set tiles, nothing clipped; the link opens /cards/pokemon. [10-14]
16. Opened card (Search): "Full price page →" sits right of MARKET on one line and opens that card's public page (a redirect to the exact set is fine). [10-14]
17. Inventory and Watchlist opened card: the same "Full price page →" link. [10-14]
18. Help: Helpful / Not helpful under every robot reply; tap one, reload, it is still marked. [10-14]
19. Home, logged out: nav row 1 = search, How It Works, Features, Card Prices; row 2 = Pricing, Log In, Get Started; nothing clipped; same on /features and a /cards page. [10-14]
20. Home, logged in: row 2 reads Pricing, Log out, Open the App. [10-14]
21. Homepage after the games strip: eyebrow "Card prices", "Know the card? Look it up.", five pills (Pokémon ... Yu-Gi-Oh!), "All Card Prices · Price Movers"; a pill opens its hub. [10-14]
22. /cards/pokemon: the five game tabs under the intro, Pokémon lit; tap Magic: /cards/magic with Magic lit. [10-14]

Older, still open:
23. Sign up with email and password, log out, tap Continue with Google with the same email: same account. [10-07]
24. A Google-only account typing a password sees "signs in with Google"; Forgot Password lets it set one. [10-07]
25. Second Google signup from the same phone starts with the free scans already used. [10-07]
26. Sign in with X, all 8 steps (buttons, shared email, no email, link, admin refused, used email, keys off). [10-10]
27. One Tap with the admin's Google account is refused and not linked. [10-11]
28. One Tap on Android Chrome shows the browser-styled account picker and behaves the same. [10-11]
29. Out-of-scans wall: the Booster button opens live checkout for $4.99. [10-07]
30. Out-of-scans wall: the Subscribe button opens live checkout for $9.99 a month. [10-07]
31. Each "Send Test To Me" on /admin/emails: [TEST] mail arrives; pictures, prices, buttons, Stop link all right on the phone. [10-08]
32. Loading skeletons show on slow 4G for Inventory, card pages and set pages. [10-06]
33. Airplane mode inside the app shows the No Signal page; push still works afterwards. [10-06]
34. Home-screen icon long-press shows Scan and Inventory shortcuts (Android only). [10-06]
35. Scan too many times fast: "wait N seconds"; hit the daily limit: "try again tomorrow". [10-06]
36. Ad signup from /scan skips "How will you use it?" and lands in the scanner as Seller. [10-06]
37. A normal signup (not from an ad) still gets the "How will you use it?" question. [10-06]
38. eBay card with no shipping pick: button says "Pick a shipping option to publish"; after a pick, the confirm line says free shipping. [10-08]
39. Accept Offers on: push a card, Seller Hub shows auto-accept 90% and auto-decline 70%; reprice moves them. [10-06]
40. Tracked Shipping (only after EBAY_VALUE_SHIPPING=1 is set): a card over the threshold shows tracked postage. [10-06]
41. Scan a Pokémon, a Magic and a Lorcana card on prod: pictures load and the card is still identified. [10-13]
42. TikTok Events Manager (your TikTok Ads sign-in): ViewContent and ClickButton still arriving from /scan. [10-06]
43. Fastmail mailbox (your login): fewer "Undelivered Mail Returned" bounces at support@ from welcome emails. [10-07]
44. LATER (you 10-14): grey text is readable in sunlight. [10-06]

Found 10-14 9:50pm in older TO-TEST blocks, never listed before:
77. Scanner: a card with two near-identical printings (a Trainer Gallery card like Eevee TG11, or a 1st Edition twin): the card shows within ~3 s; if the picture check later disagrees, it swaps and a Check-match line says "the photo looks more like this printing than <set>". [10-11]
78. Scanner: verify a card quickly after it shows: a late picture check must NOT change it afterwards (verified wins). [10-11]
79. One Tap: close it with the X, open /pricing and reload home: it never comes back on that device. [10-11]
80. One Tap: signed IN, no prompt on any public page; never on /app, /admin, /login, /signup. [10-11]
81. Inventory with a card open: the round X next to Subscribe Now closes the card and shows the plain list; Share sits inside the card panel. [10-08]

Also yours, not a test: sign into /admin in the browser pane when you have a minute, so I can do D66-D69 and D71 without you.

## B. A decision only you make - 1

45. Trial size: 5 free scans today, about 2 cents each to us. Jenny hit the wall after 5 and left. 10 or 15 would still be under 30 cents a signup. Leave at 5, or raise? (No change until you say.) [10-14]

## C. Waiting on a date, an event or a reply - 22

46. 10-15: Vercel Function Storage recheck (157.6 GB on 10-13, slow slide, $0 billed). [10-13]
47. 10-15 2am log: "One Piece SAMPLE pictures re-checked" line present (45ee7180). [10-14]
48. 10-15 2am log: the nightly run's Yu-Gi-Oh line shows the 44 picture borrowers retried (count down or 0 failed). [10-13]
49. 10-15: nightly backup (cardflip-backups repo) green with foreign keys off, and one run completed while the catalog run was writing (no "database is locked"). [10-14]
50. 10-15: /cards/pokemon/crystal-guardians/charizard--ex14-4 shows the hand-kept $939.50 (showed $1,026.33 at 8:30pm 10-14; page copies are cached). [10-14]
51. 10-15: Jenny's reply on ticket #1001 (you answered 8:29pm ET; mail went out, she is Google-verified). [10-14]
52. 10-15 on: the first "N save failed" line under Cards on /admin/users, and the first "Not helpful" chat on /admin/robot: read them like tickets, log in docs/LESSONS.md. [10-14]
53. 10-15 5am Magic run: cron result cardmarketFilled ~400, cappedToListing in the hundreds, mtg step under 800 s; Art Series unpriced count 87 -> ~31. [10-13]
54. 10-16 evening: reach-trial review (Instagram, Threads, X views vs baseline); revert if no lift. [10-09]
55. 10-17: Search Console checks (10-05..10-17 open). [10-05]
56. 10-17: Lorcana $1,000+ cards appear in its top list (14 priced days; by design until then). [10-13]
57. Sunday 10-18 catalog sync: Lorcana pictures kept, the picture re-save only adds a few new ones. [10-12]
58. After a week of referee runs (~10-20): every $100+ card has an eBay reading (about 4,500). [10-13]
59. After a week of card_removals rows (~10-21): revisit refund-unkept (you know it would make scan-and-delete a free price check). [10-14]
60. First real sale: the "Your card sold" push AND the mailing-steps email both arrive; the sale is recorded once even with two tabs open; over $20 the earned ledger and sales report show that row's real postage. [10-06/10-08/10-12]
61. First real US publish: eBay accepts the "CardFlip letter" policy (free shipping, $20.01-$100 envelope), "CardFlip shipping" reads USPS Ground Advantage, an under-$20 envelope publish says free envelope. [10-11/10-13]
62. Seller with 26+ live listings: an eBay-side end on listing #26+ shows in Inventory. [10-06]
63. First Booster or plan purchase from an ad signup shows in /admin; first ad sign-up shows in Google Ads Goals > Sign-up (~48 h); first Stripe purchase in Goals > Purchase. [10-07]
64. eBay reconnect warning appears 30 days before the link expires (first ones about 2028). [10-06]
65. /admin funnel shows ad-page signups as landing /scan (no ad has landed there yet). [10-06]
75. eBay developer support reply (sign in to the inbox in the pane and I read it; slow). [10-13]
76. PriceCharting's answer to your two questions (sent 10-14 ~2:10pm ET; their terms in BACKLOG). [10-14]

## D. Mine (scripts, curl, browser pane) - 11

66. NEEDS YOUR /admin SIGN-IN IN THE PANE: /admin/users, Jenny's row reads 0 with "5 removed" under it; an account that never deleted anything shows only the count. [10-14]
67. NEEDS /admin: /admin/robot lists the week's chats thumbs-down first, threads expand, times say ET once; the overview Help chat tile links there. [10-14]
68. NEEDS /admin: /admin/prices, hide any cheap card, open its set page + a sister printing's page: the number is gone right away. [10-14]
69. NEEDS /admin: /admin analytics Scanner "Matched a card" = paid scans not given back / paid scans (tiebreak calls no longer count). [10-13]
70. PASS 10-14 9:35pm ET (pane: "where did my Sylveon ex go" -> "still in Inventory, two copies of 30th Celebration 153 and one Prismatic Evolutions 156" + the button; the button carried the set name too, fixed locally so it is the name only, NOT PUSHED): Robot: "where did my <recent card> go" names it and shows "Find <card> in Inventory". [10-14]
71. NEEDS a trial account at 0 scans (or Jenny's view): the wall opens with "Just want a price? That's free." + Search Cards button and Search works; a lapsed subscriber's wall has no free-price box; the robot as a 0-scan account leads with the free path. [10-14]
72. PASS 10-14 ~10:10pm ET (curl: "Other printings of" strip lists 12 Charizards, not base1-4-1st itself, no Base Set link, no $968.91 in the page; alt text fixed locally, name + stripEdition(setName), NOT PUSHED): curl: /cards/pokemon/base-set-1st-edition/charizard--base1-4-1st "Other Charizard cards" strip no longer lists the page's own card; homepage Yu-Gi-Oh tile picture alt text still says "(Worldwide English)" (invisible; small fix). [10-14]
73. PASS 10-14 ~10:25pm ET (5 random YGO sets = ARC-V Promo 7, 2017 Mega-Tins 10, SD Crystal Beasts 49, Speed Duel Scars of Battle 50, Elemental Energy 168: every tile's picture is /pics/yugioh/ygo-<its own id>, 0 duplicates, 0 outside pics; 20 random tiles eyeballed in the pane, no SAMPLE stamp, no sibling art; ask-only over $20 = Hamon Unlimited (TCGplayer ask $350, no market) and B.E.S. Covered Core ($99.99) show NO price, Uria 1st keeps $999.97 because TCGplayer has a market price; serialized Bitterbloom Bearer #352 keeps $2,964.84; Apocalypse foils Cromat $57.30, Spiritmonger $57.65, Vindicate $163.20, Pernicious Deed $317.49): Pane: 5 random Yu-Gi-Oh set pages show that printing's own picture on every tile (no SAMPLE stamp, no sibling art); a Yu-Gi-Oh card with only a TCGplayer ask over $20 shows no price; a serial-numbered Magic card keeps its high price; spot-check 3 capped Magic foils (e.g. Cromat Apocalypse foil ~$57). [10-13]
74. Some day with an ANTHROPIC_API_KEY in the dev env: `npm run test:helpreplay` (Jenny's conversation against the live prompt, ~3 model calls). [10-14]
82. PASS 10-14 ~10:10pm ET (curl id=base1-4: 200 image/png 1080x1920, 1.6 MB, Base Set Charizard art + name + "Scanned with CardFlip" footer, viewed): curl: a Share card picture (/api/share/card?game=pokemon&id=<key>) renders the card art from our store, not a blank. [10-12]
83. PASS 10-14 ~10:10pm ET (curl /api/search-card?name=Elsa&game=lorcana: 48 cardflip.io/pics URLs, 0 lorcast): curl: header search "Elsa" on a Lorcana page: result thumbnails come from cardflip.io/pics, not lorcast. [10-12]
