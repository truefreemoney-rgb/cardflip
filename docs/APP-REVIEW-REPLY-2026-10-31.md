# App Review reply, 10-31 (Guideline 2.1 Information Needed; resubmit with build 4 + Apple in-app purchase)

UPDATE 2:35pm: the first recording showed Stripe checkout inside the app, so the app now sells through Apple in-app
purchase (20e2bdd1). Re-record on build 4 with step 5 below; the notes are rewritten for it.

Apple 1:17 PM ET 10-31: not a bug. They want (1) a screen recording from a real iPhone and (2)-(6) written
answers, all in the App Review Information > Notes field, then Resubmit. Video goes up as an attachment on
"Reply to App Review" (and the notes say so). Demo account applereview is never deleted.

UPDATE 4:10pm (pulled from review, Chris picked A): build 6 adds Restore Purchases; applereview is off the comp with
500 Booster scans (so the buy buttons show); Apple's network passes the sign-up cap, shut-out and one-trial rule; the
description now lists the plans, the renewal terms and the Terms/Privacy links.

## Recording (Chris's iPhone, one take, about 3 minutes)
Before: iPhone on the newest iOS (Settings > General > Software Update). CardFlip build 4 from TestFlight, signed OUT, home Wi-Fi.
A card on the table or on the PC screen. Turn on Screen Recording in Control Center.
1. Start recording on the HOME SCREEN, tap the CardFlip icon (Apple wants the launch).
2. Tap Scan Your Card, scan a card, show the price page (the free scan, no account).
3. Sign up with email: truefreemoney+review31@gmail.com and a throwaway password (account registration).
4. Account tab > Sign Out, then sign back in with the same email + password (login).
5. Account tab > Plan > Booster: Apple's purchase sheet opens (sandbox, no real charge); buy it, show the scan count go up by 100.
6. Account tab > Danger zone > Delete... > type DELETE > Permanently Delete (account deletion). You land on the first screen.
7. Stop recording. Send the video to the PC (Google Drive or email to yourself); I attach it in the reply.

## Notes field text (paste as is, replaces the old notes)
CardFlip: Card Scanner. Answers to the 10-31 Information Needed request.

1. SCREEN RECORDING: attached to this submission (App Review Information > Attachment; iPhone, latest iOS). It starts at app launch and shows account sign-up, sign-out and sign-in, an in-app purchase through Apple (sandbox), a card scan, and account deletion (Account > Danger zone > Delete). (Our test iPhone had already used its free first scan; on a new device the first scan needs no account.)

2. PURPOSE AND AUDIENCE: CardFlip is for people who collect or sell trading cards (Pokemon, Magic: The Gathering, Disney Lorcana, Yu-Gi-Oh!, One Piece). You point the camera at a card, the app names the exact card and shows what it sells for, so you know which cards are worth keeping, watching or selling. Cards are saved to your collection with their value; you can watch prices and, if you choose, list a card on your own eBay account.

3. HOW TO USE IT:
- No account needed for the first scan: tap Scan Your Card on the first screen and point the camera at any card (a card picture on another screen works).
- Demo account: the email and password in the Sign-In Information above (first screen > "I already have an account" > email and password > Log In). It has saved cards and 500 Booster scans, so it scans right away and Account > Plan shows the Booster and Subscribe buttons; any plan can be bought on it in the sandbox. A new account made in the app also works (5 free scans).
- Restore Purchases: Account tab > Plan (under the plan prices), and on the Subscribe page.
- Built natively for iPhone: the camera scanner and the price reveal (Dual Wide lens, haptics, sounds), the no-account first scan, sign-in (Sign in with Apple, Google, email) and Apple In-App Purchase with Restore. Search (no scanning) finds any card and its price. Inventory, Watchlist and Account are the user's own data from cardflip.io shown inside the app.
- eBay listing is optional and needs the user's own eBay account; it is not needed to review the app.
- Account deletion: Account > Danger zone > Delete > type DELETE.
- Sign in with Apple, Google or email.

4. EXTERNAL SERVICES:
- Anthropic (Claude): reads the card photo to identify the card.
- Card data and prices: TCGplayer prices (via tcgcsv.com), eBay (sold prices; listing for users who connect eBay), Scryfall, Pokemon TCG API, TCGdex, YGOPRODeck, Card Kingdom, Cardmarket, CardTrader.
- Sign-in: Sign in with Apple, Google Sign-In.
- Payments in the app: Apple In-App Purchase only (Booster, CardFlip and Pro). The cardflip.io website sells the same plans through Stripe to website visitors; the app never opens Stripe.
- Email: Resend. Hosting and data: Vercel, Turso.

5. REGIONS: the app is offered in the United States only and works the same for every user there. In the app, the Booster ($4.99, 100 scans, consumable) and the CardFlip ($9.99/month, 250 scans) and Pro ($24.99/month, 750 scans) auto-renewable subscriptions are sold through Apple In-App Purchase: Account tab > Plan, or the Subscribe button at the top right. Scans bought in the app also work on cardflip.io with the same account.

6. REGULATED / THIRD-PARTY MATERIAL: not a regulated industry. Card names and pictures are shown only to identify the user's own cards and their market value, like other card price guides; our terms state the names and images belong to their owners (Nintendo/The Pokemon Company, Wizards of the Coast, Disney/Ravensburger, Konami, Bandai) and that CardFlip is not affiliated with them. No user-generated content is shared with other users (support messages go only to us).
