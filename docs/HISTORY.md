# History — archive

Detailed write-ups of past work, moved out of `STATE.md` to keep resumes
cheap. **Don't read this file to resume a session** — read it only when
debugging one of these specific features and the summary in `STATE.md` isn't
enough.

## 2026-08-14 — eBay-review hardening: 20 rejection risks found and fixed (awaiting deploy)

Simulated eBay's reviewer against prod 40× (320 requests, all 200, worst warm
response 0.55s) plus a deep crawl and a full repo audit. Twenty risks, all
fixed in code the same day:

1. **No marketplace account-deletion endpoint** (hard requirement for a
   production keyset) → new `src/app/api/ebay/account-deletion/route.ts`:
   GET answers eBay's challenge with sha256(challengeCode + token + endpoint
   URL), POST acks deletion notices with 200 and logs them. Needs
   `EBAY_VERIFICATION_TOKEN` (we invent it, 32–80 chars) set as a Fly secret
   and pasted into the eBay portal with the endpoint URL when subscribing;
   `EBAY_DELETION_ENDPOINT_URL` overrides the default prod URL if ever needed.
2. **Demo login faked "eBay connected"** — `setEbayConnected(user.id, true)`
   with no OAuth behind it, shown to the very reviewer using the demo button
   → now writes `false` (also scrubs the old faked row on next demo login).
3. **Dead-end "Connect eBay" buttons** (app header + signup step 2) → renamed
   "eBay setup"; they lead to the honest status page, not a fake connect.
4. **eBay trade-dress color** — `--color-ebay` was eBay's exact #0064d2 →
   now generic sky blue (#0284c7), one token edit covers every usage.
5. **"eBay sold (90d)" tile said "eBay not connected"** (implies the user can
   connect; they can't) → "Awaiting eBay API access", both sold and asking.
6. **"Live market pricing" on landing read as eBay data** → now says
   TCGplayer explicitly (steps, pricing list, hero caption).
7. **Hero caption "Live example"** overclaimed → "Real example — priced from
   live TCGplayer market data".
8. **Cross-user data leak**: `/api/price-checks` GET returned the last 100
   price checks of *all* users to any signed-in user (incl. the shared demo
   account), contradicting the privacy policy → `listPriceChecks(userId, …)`
   with `WHERE user_id = ?`.
9. **Zero security headers** → `next.config.ts` `headers()`: HSTS,
   nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy with
   `camera=(self)` so the scanner keeps working. No CSP on purpose (Next
   inline scripts need nonce plumbing; a broken page reviews worse).
10. **`x-powered-by: Next.js` leak** → `poweredByHeader: false`.
11. **~12s cold start** on the reviewer's first request (measured live;
    `auto_stop_machines = "stop"`) → `"suspend"` in fly.toml (~1s resume).
    Alternative if suspend misbehaves: `min_machines_running = 1` (~$2-3/mo).
12. **No governing-law clause** in terms → added (US law, operator's state).
13. **Privacy said nothing about eBay data handling/retention** → new "eBay
    data" section: what will be stored when OAuth lands, kept only while
    connected, deleted on disconnect/account deletion/eBay closure notice —
    matches the new deletion endpoint.
14. **Catalogue sources unnamed** (TCGdex, pokemontcg.io used but never
    disclosed) → named in terms "Third-party services" + privacy.
15. **No eBay-policy clause for sellers** → terms "Acceptable use" now binds
    users to eBay's User Agreement when listing.
16. **Signed-in app had no legal surface** — reviewer demos straight into
    /app with no terms/privacy/contact/disclaimer → slim footer in
    `src/app/app/layout.tsx` (covers all four app pages).
17. **/login had no demo path** — a reviewer landing there from the
    application form hit a wall → DemoButton added under an "or" divider.
18. **GET /api/ebay/connect returned a bare empty 405** to anyone probing →
    GET now returns the same honest 503 JSON as POST.
19. **Bare link previews** (no OG image) → `src/app/opengraph-image.tsx`
    via next/og ImageResponse.
20. **Contact-domain mismatch** (site on fly.dev, contact/application email on
    superiormarketing.com) — NOT code-fixable; mitigation is serving the site
    at cardflip.superiormarketing.com (cert already added at Fly, DNS rows
    never created — Chris's call, don't push).

Verified: `tsc --noEmit`, `eslint src`, test:ebay, test:pricing, and
`npm run build` all clean. Left alone deliberately: /connect-ebay page copy
(already honest, written for reviewers), robots.txt, sitemap, session cookie
flags (already correct), Anthropic vision disclosure (already in privacy).

## 2026-08-11 — Vision live on production

`ANTHROPIC_API_KEY` set and the account funded ($5). Verified against the live
server: the Charizard reference photo reads back as Charizard · Base Set ·
4/102 · code BS · Near Mint at 0.95 confidence, `status: "done"`. Two traps
for posterity: pasting the console's *masked* key (`•••` chars) throws a
ByteString error server-side, and a valid key still 400s until the account has
credit — `flyctl logs` names the real cause either way, while the UI stays
silent and just falls back to OCR. Watch the console credit balance: vision
silently degrades to Tesseract when it runs out.

## 2026-08-11 — Scan-loop fix (deployed)

The candidate walk in `src/app/app/page.tsx` no longer stops at the first name
that returns *any* hits — junk OCR substring candidates could claim the match
(a foil Mewtwo ex came back as "Illumise" with 23 alternates) while an
exact-name candidate sat later in the list. Non-exact results are only a
fallback now; the walk ends early on an exact name match. Verified against the
Charizard reference case. Production was also re-synced so set totals rank
matches on the Fly volume (Fly's depot builder hung on deploy once —
`--depot=false` got past it).

## 2026-08-11 — Live camera scanning (awaiting deploy)

`src/components/CameraCapture.tsx`, wired through `Uploader` + the scanner
page: a "Use camera" button opens a getUserMedia viewfinder; each capture
becomes a File into the same scan pipeline as uploads. The modal state lives
in `page.tsx`, not `Uploader` — the first capture flips the page from hero to
queue layout, which unmounts the hero uploader, and a locally-owned modal
vanished mid-stack (found by driving a fake canvas-stream camera in the
browser; real capture can't run in the test pane, so the capture→queue
plumbing is verified but a real-device shot isn't).

The viewfinder carries scan visualization: a 63×88 card-ratio framing guide
(corner brackets, dimmed surround) and a live toast showing the most recent
capture's outcome — "Identifying…", then match + set + vision confidence, or a
no-match nudge. The toast works by threading the captured item's queue state
back into the modal (`lastScan` prop; `cameraItemId` in `page.tsx`), since the
scan itself runs in the page's pump loop.

A torch (camera light) toggle sits top-right of the viewfinder. It renders
only when the track's `getCapabilities()` reports `torch` (Android Chrome back
cameras; not desktops, and iOS Safari mostly doesn't) and un-renders itself if
`applyConstraints` rejects — some WebViews advertise torch and then refuse it.
Verified with a mocked track both ways; a real phone LED hasn't been tested.

## 2026-08-11 — My cards dashboard (awaiting deploy)

**My cards** (`/app/collection`, in AppTabs) — the cross-session ledger of
every scanned card with draft → listed → sold tracking, filters, name search,
and stats (counts, in-play value, earned, avg days listed→sold). Status moves
(Mark listed / Mark sold / Unlist / Delete) PATCH the existing
`/api/cards/[id]` route; "Mark sold" defaults soldPrice to the listing price.
Verified end to end against the dev server with a seeded card.

Same day: **wishlist re-pricing** ("then vs now" — current TCGplayer market vs
the price frozen at save time, ▲/▼ delta, en items only, first 15,
`fetchCurrentPrices` in the wishlist page); **profit estimate on My cards**
(net after estimated eBay fees, 13.25% + $0.30, mirroring
`lib/server/cards.ts`); **"Post all to eBay · soon" placeholder** on the
scanner toolbar, deliberately disabled — the hookup point for one-click bulk
posting when eBay credentials land.

## 2026-08-11 — Wishlist add-card flow (awaiting deploy)

`src/app/app/wishlist/page.tsx`: the wishlist got its own add panel — database
search (same parse/search as Price check) and an image dropzone (drag-drop or
click-to-browse). Deliberately **no camera**: a wishlisted card is one the
user doesn't have in hand. The dropzone runs the scanner's identify pipeline
via the shared helper `src/lib/client/identifyCard.ts` (vision first, OCR
fallback, exact-name early exit) but does **not** `createServerCard` — wanted
cards must not land in the seller ledger. Both paths end in one results grid;
clicking a result saves it with the picked market price (server no-ops on
duplicates). Verified against dev: "Charizard 4/102" and a dropped
`base1/4_hires.png` both rank Base Set first; add → grid + total update;
remove works.

## Business model (decided 2026-08-11)

$4.99/month subscription for everything. The landing page carries a pricing
section and the FAQ says so, both framed honestly as **free during early
access** because no payment processor is connected. Actually charging requires
Stripe (account + `STRIPE_SECRET_KEY` + checkout/webhook routes + a `plan`
column on users) — none of that exists yet; don't gate features until it does,
and keep the demo login working regardless (Chris uses it for testing).

## Base Set vs. reprint — mostly closed 2026-08-11

Base Set Charizard and its Base Set 2 reprint are both "Charizard" and both
numbered 4, and the mirror holds **1,306 such name+number collisions covering
2,890 cards**. Ranking by release date guessed at them.

The printed denominator settles it, because it names the expansion rather than
the card: Base Set prints **4/102**, Base Set 2 prints **4/130**. Measured
against the mirror, the set total alone fully disambiguates **94.3%** of those
collisions. That's now parsed, stored and ranked on — see `lib/cardNumber.ts`
and the trap table in `CLAUDE.md`. Verified end to end: `4/102` ranks Base Set
first, `4/130` ranks Base Set 2 first.

What's left:

- **4.8% of collisions share a denominator too** and still fall back to
  release date — Dugtrio 19/102 is both Base Set and Triumphant; Gym Heroes
  and Gym Challenge are both /132. A set code splits some of these (77% of
  cards have one), but only vision reliably reads the code or symbol off a
  photo.
- **OCR still has to read the denominator correctly.** It rides on the same
  misread slash as the numerator, which is why a mismatched total only demotes
  a candidate instead of filtering it out.
- Every candidate still carries a thumbnail beside the uploaded photo, so a
  wrong pick stays visible and one click from corrected.

Vision reads the whole card, including the set symbol, and is asked for the
set total and set code explicitly. Don't attempt to close the remaining gap
with more OCR heuristics.
