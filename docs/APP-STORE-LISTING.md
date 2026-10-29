# App Store listing: DRAFT 2 (10-29 11:45 AM ET; refreshed from the 10-18 draft for the hybrid app + the free first scan; Chris approves before anything is submitted)

Decided since the first draft: Sign in with Apple = yes (built once the developer enrollment lands); payments = Stripe
web link-out from the app, no in-app purchase for now (docs/APP-PLAN.md "Money"); email verification never happens
inside the app (switch off for launch). Still open: nothing that blocks the text below.

## Names and short text
- App name (30 max): **CardFlip** (confirm it is free in App Store Connect; fallback **CardFlip: Card Scanner** (21))
- Subtitle (30 max): **Scan cards, see their value** (28)
- Google short description (80 max): **Scan Pokémon, Magic, Yu-Gi-Oh!, Lorcana and One Piece cards and see the price.** (79)
- Promotional text (Apple, 170 max, can change without review):
  "Your first scan is free, no account needed. Point the camera at a card and see what it sells for today, then keep it in your collection or list it on eBay." (152)

## Description (Apple 4,000 / Google 4,000)
CardFlip tells you what your trading cards are worth.

Point your phone at a card and CardFlip reads it: the name, the set, the number and the printing. You see the market
price right away, with how it has moved over the last 90 days.

Your first scan is free before you even make an account. Sign up and the card is already in your Inventory.

Five games: Pokémon, Magic: The Gathering, Yu-Gi-Oh!, Disney Lorcana and One Piece.

WHAT YOU CAN DO
• Scan a card with your camera and see its price in seconds
• Search any card by name or number, free
• Keep your cards in Inventory and watch your collection's total value
• Add cards to your Watchlist and get told when a price moves
• See a price history chart for every card
• List a card on eBay with the title, photos and price filled in
• Track what sold, what you paid and what you earned

PRICES
Prices come from recent market data and are checked against real sales. When a price looks off, CardFlip says so
instead of guessing.

FREE TO START
Every new account gets 5 free scans. No credit card. Searching, price history, Inventory and the Watchlist are free.
More scans are available on cardflip.io.

Questions? support@cardflip.io

(Apple: the last paragraph names the website for buying scans. That is allowed in the US since 2025 for apps that
use a web link-out instead of in-app purchase; keep the wording to "available on cardflip.io", no price, no "buy
here" button in the text. If review objects, drop the paragraph; the app itself links out from Account.)

## Keywords (Apple, 100 chars, comma-separated)
pokemon,mtg,magic,yugioh,lorcana,one piece,tcg,card scanner,card value,card prices,collection,ebay (96)

## Category
- Apple: Primary **Shopping** (sells on eBay, prices), Secondary **Utilities**. TCGplayer sits in Shopping, Collectr in Utilities.
- Google: **Shopping**.

## Age rating (Apple questionnaire)
- Violence, sexual content, profanity, gambling, horror: none. Contests: none. Alcohol/drugs: none.
- Unrestricted web access: **No**. The app shows only cardflip.io pages inside itself (Inventory, Search, Watchlist,
  Account) and opens eBay/Stripe in Safari. Expected: **4+**. Google: Everyone.
- Kids category: no (do not opt in; it brings extra rules).

## Privacy answers (Apple "App Privacy" / Google "Data safety")
From cardflip.io/privacy (effective Oct 17 2026). Nothing is used for tracking across apps; no ATT prompt.
| Data | Collected | Linked to the user | Used for tracking | Why |
|---|---|---|---|---|
| Name, email | Yes | Yes | No | Account |
| Photos (card photos you take; one free read before an account) | Yes | Yes (after sign-up) | No | App functionality: the picture is read by Anthropic's model to name the card; kept as your listing photo once saved. The free first read is not stored. |
| Purchases (scan balance, subscription status) | Yes | Yes | No | App functionality (Stripe holds the card; the app only links out) |
| User content (support tickets, help chat) | Yes | Yes | No | Customer support |
| Product interaction (pages, taps) | Yes | No | No | Analytics on cardflip.io pages shown in the app (heat map: random per-tab id, no cookie). GA4 and the TikTok pixel do NOT load inside the app (DeferredAnalytics, 10-29). |
| Device ID (a random id the app makes, not Apple's IDFA/IDFV) | Yes | Yes | No | Abuse prevention: one free scan per device, sign-up limits |
| Push token | Only if notifications are turned on (not in 1.0) | Yes | No | Notifications |
| Diagnostics (server logs with IP) | Yes | No | No | App functionality, abuse prevention |
| Coarse location (country from the connection) | Yes | Yes | No | Which currency and prices to show |
- Data deletion: in the app (Account → Delete account, the site's page) and support@cardflip.io. Google also wants a
  web link: cardflip.io/privacy.
- Third parties that receive data: Anthropic (card photos for reading), Stripe (payments, on the web), eBay (only
  when the user connects eBay), Resend (email). Say so in the Apple "data collected" notes.

## Reviewer notes (Apple "App Review Information")
- Demo account: make a fresh test account right before submitting (never Chris's own), with scans on it; put the
  email + password in the review notes. Also say: "The first scan works with no account: tap Scan Your Card on the
  first screen."
- Notes text: "CardFlip scans trading cards with the camera. A card picture on another screen works for testing.
  Search works without scanning. Inventory, Search, Watchlist and Account show our own website pages signed in as
  the user (same features as cardflip.io). The eBay listing feature needs an eBay account and is optional. Buying
  more scans happens on cardflip.io; the app links out."
- Guideline 4.2 (minimum functionality) risk: web pages inside the app. Mitigation in the notes: the first screen,
  the scanner, the reveal and the free-scan flow are native; the web pages are the user's own account data.
- Sign in with Apple: present (guideline 4.8), alongside Google and email.
- Contact: Chris, support@cardflip.io, phone number in App Store Connect.

## Screenshots to make (6.9" iPhone 1320x2868 and 6.5" 1284x2778; Google phone 1080x1920 or taller)
Real screens from the app on a phone, dark background, one line of text above each (Chris's yes on every shot
before upload, screenshot rule):
1. "Scan Your First Card!" page (the fan) — "Your first scan is free"
2. The scanner with a card in the guide — "Point. Scan. Done."
3. The result page: card, green price, 90-day chart — "See what it sells for"
4. Inventory with the Unsold total — "Your whole collection, priced"
5. Watchlist with arrows — "Get told when prices move"
6. The eBay listing editor — "List on eBay in a few taps"
Nothing from the three intro cards (placeholder art, Chris 10-29 10:07am).

## Checklist before submitting
- [ ] Apple developer enrollment approved (Chris, in progress 10-29)
- [ ] Sign in with Apple built and tested on the phone
- [ ] Production build (EAS) pointed at cardflip.io, the site half of the app commits pushed
- [ ] The TikTok pixel / GA4 stay off inside the app (afbecf77) — verify on the production build
- [ ] Demo account made; notes pasted
- [ ] Screenshots approved by Chris
- [ ] Privacy answers entered exactly as the table above
- [ ] cardflip.io/privacy and /terms mention the app (one line each)
