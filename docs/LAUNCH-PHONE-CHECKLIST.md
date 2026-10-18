# Before launch: full check on Chris's real phone (task #19; for the app-store build, written 10-18)

Use the installed app (TestFlight on iPhone / Google closed test on Android), not the website.
Do it with a NEW test account (not your own). Tell me the step number of anything wrong. About 45 minutes.

## A. First open
1. Install and open the app. You should see the CardFlip start screen, no white flash, no website bars.
2. Tap Get Started. Sign up with a test email. You should get a 6-digit code by email within a minute; type it, you're in.
3. Sign out. Sign in with Google. You land signed in. (If Sign in with Apple is in: do the same with Apple.)
4. Turn the phone sideways and back. Nothing breaks.

## B. Camera and scanning
5. Tap Scan. The phone asks for the camera ONCE. Tap Allow. The camera shows.
6. Scan one card from each game you have: Pokémon, Magic, Yu-Gi-Oh!, Lorcana, One Piece. Each shows name, set, number and a price within ~3 seconds.
7. Scan a card in a binder sleeve. It still reads.
8. Point at a blank table. You get "No match found" and the scan is given back (count did not go down).
9. Deny the camera (phone Settings > CardFlip > Camera off), open Scan. You see a clear message how to turn it back on, no blank screen.

## C. Prices and search
10. Search "Charizard". Pictures show, prices show, tapping one opens its price page with a chart.
11. On a price page, tap "Price looks wrong?". The thank-you line shows.

## D. Inventory and Watchlist
12. Save 3 scanned cards. Inventory shows them with pictures and a total value.
13. Edit one card's cost (number keypad with "."), condition and price. Close and reopen the app: changes kept.
14. Add a card to the Watchlist. It shows with price and ▲/▼.
15. Turn on notifications when asked (Account). The phone asks once. Allow.

## E. Paying (after #13 is decided)
16. Buy the cheapest option with the store's TEST/sandbox account. Scans go up right away.
17. Delete and reinstall the app, sign in. The purchase/subscription is still there ("Restore" if Apple IAP).
18. Cancel in the phone's subscriptions settings. The app shows the end date, then the paywall after it.

## F. eBay (optional, needs your eBay)
19. Account > Connect eBay. eBay's sign-in opens and comes back to the app signed in to eBay.
20. List one card as a draft. Title, photos and price are filled in. Don't publish unless you mean to.

## G. Leaving and coming back
21. Turn on airplane mode, open the app. You see an offline message, not a crash. Turn it off: the app recovers.
22. Leave the app in the background for 10 minutes, come back. Still signed in, same screen.
23. Links to eBay or help pages open in the phone's browser and come back to the app.

## H. Account
24. Account > Privacy policy opens cardflip.io/privacy.
25. Account > Delete account on the TEST account. It asks to confirm, then signs out. Signing in again fails.

## I. Looks
26. Every screen at the phone's normal text size: nothing cut off, no text running off the side.
27. Phone text size set to the largest: the main screens still usable.
