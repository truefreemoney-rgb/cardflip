# CardFlip iPhone app plan (draft 10-28-2026, 10 PM ET)

Status: FINAL 10-28 10:12 PM ET. Chris: "going to rely on you for most of this." Decisions are Claude's; Chris does phone steps, Apple account/payments, and the yes on looks.

## What we are building
- A real native iPhone app (Expo / React Native), not a wrapped website.
- Apple only. Android is later and is not planned here.
- Same cardflip.io server, same database, same API, same prices. The app is a second front door, not a second product.
- Apple Developer account: Individual (Chris), $99/yr.

## What goes native (every customer screen, about 20-25)
1. Scanner (camera, 8 s budget, slabs blocked, no auto-scan, condition starts Near Mint)
2. Scan result / reveal (money green, $X.XX, the exciting part)
3. My Cards: list, sets, insights, report
4. Card detail (price, printing/foil, 1st Edition twin, eBay sold link)
5. Price check
6. Packs
7. Wishlist
8. Rewards
9. Account / settings
10. Sign up, sign in, forgot, reset, confirm (plus Sign in with Apple, required by Apple when other sign-ins exist)
11. Connect eBay
12. Browse / search (search-to-add stays free)
13. Profile
14. Help / support
15. Subscribe (opens the Stripe web page, see Money)

## What stays web only
- Admin, social autopilot, board, marketing pages, SEO card pages, legal (terms, privacy).
- The app links out to legal pages when Apple needs them shown.

## Money
- Subscribe = Stripe web link-out from the app. Today Apple takes 0% on that.
- In-app purchase is built as a switchable option later only if Apple review forces it or the link-out converts badly.
- Same price before and after paying. Never a trial price trick.

## Acorn lessons baked in (docs/COMPETITOR-ACORN.md)
- Say the free deal before sign-up: landing, App Store text, first app screen.
- Real free taste: several real scans with the real price; search-to-add free.
- Short intro (Acorn makes people tap through ~23 screens, we do 3 at most).
- Easy cancel, plain trial wording, never ask for a rating next to a paywall.
- Kid and parent friendly: plain words, Sign in with Apple/Google, parent pays.
- Answer every App Store review. Ship updates often.
- Lock Screen / Action Button scanner shortcut.
- Check Japanese/foreign card reading before launch.

## Test flow
1. Expo Go on Chris's iPhone (fastest, for screens that need no camera tricks).
2. Dev build on his iPhone (real camera, real scanner).
3. TestFlight (what the review build is).
4. App Store review and launch.

## Order of work (one task at a time, easiest first)
1. Expo project in the repo, shared types and API client, sign in/up against cardflip.io.
2. Browse/search + card detail (read-only, proves the API path end to end).
3. My Cards, sets, insights, wishlist, packs, rewards, profile, help (repeated screens).
4. Scanner + scan result (hardest, most testing on the real phone).
5. Price check, connect eBay, account, subscribe link-out.
6. Sign in with Apple, push basics, Lock Screen shortcut.
7. App Store listing text, screenshots, privacy answers, review.

## Time
- 4-6 weeks at Chris's 12-14 h days. Scanner and App Store review are the two things that can slip.

## Who does what (model usage)
- Fable, slider High: architecture, scanner, payments, auth, anything Apple-review facing.
- Opus: repeated screens, docs, bookkeeping.
- Sonnet helpers: lookups and research (WebSearch/WebFetch only, no browser pane).

## Rules carried over from the website
- Feature freeze still holds: the app ships the site's features, no new ones.
- Prices come from src/lib/pricing.ts through the API, nowhere else.
- Camera scan is the only way in; no uploads, no CSV.
- Phone-width screenshots and Chris's yes on the look before anything visible ships.
- Every untested change goes in docs/TO-TEST.md.

## Decided
- App Store name: CardFlip (confirm free in App Store Connect once the account is live; fallback "CardFlip: Card Scanner").
- Bundle id: io.cardflip.app.
- Lock Screen scanner shortcut before push notifications.
