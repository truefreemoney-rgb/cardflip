# Weekly emails (planned with Chris, 10-08)

Three mails a week, one per person per day, nothing sends until the switch on
/admin/emails is ON. Every mail has the one-tap "Stop these emails" link.
Prices and scan counts come only from `src/lib/pricing.ts`.

## Tuesday: Scans

Everyone gets a scans mail, with different numbers and buttons:

| Who | Headline | Buttons |
|---|---|---|
| Trial, scans left | You still have N free scans | Scan |
| Trial, 0 left | You're out of scans | Buy 100 Scans $4.99 · Subscribe $9.99/mo |
| Subscriber, under 1/4 used | You still have X of Y scans this month, they reset on the Nth | Scan |
| Subscriber, under 10% left | You have X scans left until the Nth | Booster $4.99 · (standard plan only) Move to Pro 750/mo |
| Subscriber, in between | This week: X scans, Y cards added, collection up/down $Z (past 7 days, Chris 10-08) | Inventory |

Every version ends with ONE tip the person hasn't used yet (never listed on
eBay, never used the watchlist, never opened Set Completion). One tip per mail.

## Thursday: Your cards

- Has cards or a watchlist: their top 3 movers this week (up or down), "See all" → Inventory.
- Nothing saved: "Worth checking your binder for" = 3 cards from THEIR game that
  look ordinary but are worth $15–$200 and moved up this week, picture + name +
  set + price, one Scan button. Rotate so the same card doesn't repeat two weeks running.
- Their game = the game of the FIRST card they ever scanned (from the scan log).
  Never scanned = one biggest mover from each of the five games, headline
  "Your 5 free scans are waiting". First scan sets the game; the next mail narrows.
- Has cards but no movers this week → the binder list, never a "nothing changed" mail.

## Sunday: This week in cards

About the week, not their cards. No card tiles. Score-sheet style:

- THE WEEK: one line per game, all five (trimmed-mean 7-day move of the top 200 cards + that game's biggest jump as the note). Lorcana / One Piece / Yu-Gi-Oh! movers come from campaignData.ts youngGameMovers (tcg_cards series, guard-checked); social.ts MOVER_GAMES stays Pokémon + Magic.
- BIGGEST JUMP: one card, old → new price, %.
- SET TO WATCH: the set with the most top-20 risers.
- SLEEPER UNDER $5.
- ON CARDFLIP THIS WEEK: cards scanned, most scanned card.
- One button: Check your cards.

The old Sunday digest (digest.ts) folds into this mail; nobody gets two mails on Sunday.

## Rules

- Send times (Chris 10-08): Tuesday + Thursday 10:00am ET, Sunday 6:30pm ET, by /api/cron/emails (vercel.json fires both DST offsets; the route keeps the hit inside the Eastern send hour). Not the daily job.
- Every card price in a mail passes the price guard (priceTrustSite). A card the guard cannot vouch for is dropped, never mailed with a number that may be wrong (Chris 10-08).
- Nothing sends to users until Chris approves the setup: switch OFF, test sends to the owner only.
- Code: src/lib/server/campaigns.ts (schedule, copy, send), campaignData.ts (the facts), test: npm run test:campaigns.
- One mail per person per day; accounts made before 10-07 get none (owner excepted).
- Admin: /admin/emails shows each mail, who it reaches, preview, Send Test To Me, send log.
- Chris reviews the test sends and decides ON/OFF. Copy changes go through him.
