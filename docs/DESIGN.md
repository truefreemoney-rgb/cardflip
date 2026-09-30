# CardFlip design system

Read this before any visual/design work. It exists so the design language
stays coherent across sessions (Impeccable-style "context first"). Update it
when a design decision is made or reversed — it is the source of truth, not
the git history.

## Identity in one line

Dark, premium, holographic — the visual language of a rare trading card,
applied with restraint. Theatrical on the marketing surface, calm inside the
product.

## Tokens (globals.css)

- Background `#0a0b11` with a fixed two-radial ambient on `body` (indigo
  glow from the top, faint pink from the corner) — depth that needs no
  motion. Panels use `--surface-1/2/3` (blue-tinted `#aab4ff`-ish at
  5.5/8.5/12%), hairlines `--edge` / `--edge-strong` (white at 11/19%).
  Raised 08-25 ("refined dark" pass, Chris: theme looked dated): the old
  white 3/5/8% surfaces had no contrast, and with animations off the site
  read as one flat sheet. **The static frame must carry the design** —
  Chris never sees the animated layer.
- Brand indigo `--color-brand-300..600` — buttons, links, focus rings.
  Primary CTAs: a global un-layered rule on `.bg-brand-500` layers an
  indigo→violet gradient + top bevel + glow shadow onto every primary
  button at once (Tailwind's utility only sets background-color, so the
  rule composes; `bg-brand-500/15` chips are different class names and
  unaffected). Don't add per-button gradients — it's already global.
- Holo spectrum: `--color-holo-sky #7dd3fc`, `-violet #a78bfa`,
  `-pink #f0abfc`, `-gold #fcd34d`. Iridescence always cycles in that order.
- Marketplace blue `--color-ebay #0284c7` is deliberately NOT eBay's trade
  dress. Keep it that way.

## Type

- Body/UI: Geist (`--font-sans`). Display: Bricolage Grotesque
  (`font-display` utility) — headlines, stat values, section numerals,
  prices. Never for body copy or form labels.
- Headline scale: hero text-5xl→7xl, section h3 text-2xl→3xl, tight
  tracking (globals sets -0.02em on h1-h3).

## The holo-foil system, and its rationing rule

Utilities: `.holo-text` (animated gradient text), `.foil-edge` (static
iridescent hairline border), `.foil-edge-live` (animated conic border),
`.hero-mesh`, `.aurora`, `.dot-grid`, `.grain`, `.sheen` (hover sweep),
`.marquee`.

**Rationing is the design.** Animated foil (`.holo-text`, `.foil-edge-live`)
appears on at most: the hero headline, one price/showpiece element per page,
and giant section numerals. Everything else gets the static `.foil-edge` or
plain `--edge` borders. If a surface starts looking like an NFT site, remove
the newest effect.

`.foil-edge` fill comes from `--foil-fill` **as a var() fallback only** —
never declare `--foil-fill` inside globals.css (un-layered CSS would beat
Tailwind's `[--foil-fill:...]` utilities). Translucent fills let the border
gradient bleed through the middle; use opaque fills unless the bleed is the
point (marketing nav pill).

## Motion policy

- 08-25 "soulless" pass: static amplitude raised across the board (surfaces
  7/10/14.5%, edges 14/24%, foil-edge alphas ~doubled, hero mesh/aurora/halo
  brighter, holo-text gets a drop-shadow glow, body ambient stronger with a
  top-lightening band). Tune DOWN from here only with Chris's eyes on it.
- `prefers-reduced-motion: reduce` kills all animation site-wide, with
  deliberate exceptions: `.holo-text` and `.foil-edge-live` are exempt
  (owner's call 08-25 — color-only animations, zero spatial movement, and
  they ARE the identity); control hover/focus transitions stay at 150ms; `.reveal` is removed via `animation: none`
  (timeline animations ignore duration zeroing); `.marquee-track` is
  exempted — Chris's call, the price ticker always runs like a stock ticker;
  and `.scanner-hud` (the camera viewfinder overlay) keeps its pulse, bracket
  colour transitions and match-chip fade-up — that motion is feedback, not
  decoration. Chris's Windows has animations off, so anything not exempted
  reads as frozen to him; exempt only what is functional.
- Scroll reveals use `animation-timeline: view()` behind `@supports` —
  content must be fully visible without support.
- Hover motion is small: -translate-y-0.5, scale 1.04-1.05, sheen sweeps.
  No looping attention-seekers outside the ticker.

## The scan reveal (camera HUD showpiece)

The scanner's one rationed showpiece is the moment of the match. Sequence:
laser sweep (`.scan-sweep`) while looking/reading → shutter tick + flash on
capture → the matched card's art pops out of the result chip
(`.reveal-art`, spring + one foil sheen), name in display type, market price
counts up (`.reveal-price`) → chime + haptic. Sized by value
(`revealTier` in `lib/client/scanFx.ts`): <$20 plain, $20–100 "nice"
(emerald), $100–500 "big" (gold border, `.holo-text` price, "NICE PULL"),
≥$500 "grail" (pink border, holo label, holo burst behind the guide,
"BIG ONE", four-note chime). The instant the match lands, a **lightning strike** hits first
(`.reveal-strike` bolt drawn top → centre in ~120ms, two flickers,
glow by tier — violet / emerald / gold / pink, grail adds a second bolt —
over a `.reveal-flash` full-guide flash, Chris's ask 08-16 "a lightning
strike when the card is found"), then 140ms later a **stamp**
slams into the middle of the guide (`.reveal-stamp` + `.reveal-ring`,
display type, -4° tilt, gone in 1.4s): "Found!" / "Nice pull!" / "Big one!"
by tier, "No match" flat + amber on a miss. This is the one deliberate
exception to the no-exclamation-marks voice rule — Chris's call, 08-16:
the scanner is allowed to celebrate. (A full-frame "scene" + per-scan
personal line was built and reverted the same hour at Chris's request —
don't rebuild without asking.) Sound + haptics are one toggle in the HUD,
remembered (`cardflip.scanFx`), default on. HUD zoning (09-03, Chris's
phone: "everything overlaps"): the auto-scan state + running tally (cards ·
value) are one status row ABOVE the viewfinder, the result chip sits BELOW
it, only the ✕ / torch / sound column stays on the video and the guide is
narrowed to clear it (`guideGeometry` in CameraCapture — one rect drives
the viewfinder, sampler and crop). Full-bleed below `sm`. All one-shot after the sweep — nothing
loops once a match is showing. Voice stays dry: the labels are the only
celebration copy.

## Data honesty (non-negotiable, eBay-review-relevant)

Every card, image, and price shown on marketing surfaces is real, fetched
live (`getFeaturedCard`, `getShowcaseCards` — cached a day, sections skip
cleanly on failure). No placeholder cards, no invented prices, no fake
testimonials, no fabricated eBay connection. Copy claims only what the
product does today.

A market price the price guard does not believe (`lib/server/priceTrust.ts`,
asked on the site through `lib/server/priceTrustSite.ts`, 09-30) is never
presented as a card's value. Every screen shows the same sentence in place of
the number: "This price looks off, check sold listings" (`PRICE_FLAG_NOTE`,
drawn by `components/PriceFlagNote`, amber like the "no market price" note),
with a "View Sold on eBay" link where the page already has that search. No
listing price is suggested from it (the seller types their own; the $1.22
break-even guard still applies), no reprice nudge or price alert fires from
it, it is not saved as a wishlist baseline, and it is left out of value totals
(collection In play, insights, digest, public page, cost to finish) unless the
seller typed the price or it is a live listing's ask. A draft whose stored price
was written from a market that is now flagged (unlocked: the seller never typed
it) is blanked to $0 on the next Collection load, so the flagged number cannot
sit in the price field or pre-fill the editor; a typed (locked) price is never
touched and never gets the note under it. Hard (proved wrong) and soft (unverified) flags read
the same: a collector cannot verify either. Sealed products are outside the rule.

## Component patterns

- Public card peek: `CardPeekModal` (HoloCard 3D + live price + CTA) — the
  logged-out sibling of the app's `CardDetailModal` (which assumes auth).
  Any clickable card on marketing surfaces opens it.
- 3D card: always `HoloCard` — never reimplement tilt/glare.
- Panels: rounded-2xl/3xl. Pills (nav, tabs, badges, CTAs): rounded-full.
- App chrome: sticky header with holo hairline (same class string on all
  four app pages — keep them identical), `AppTabs` foil pill.
- Legal pages stay sober: no holo, no foil. Reviewer-facing.
- Empty scanner (09-30 makeover, Chris: "seems old and outdated"): an app
  screen, not a landing page. No marketing headline or step chips. Full-width
  game switch, then a camera-screen viewfinder (near-black, vignette, holo
  brackets, laser sweep) holding the "Example scan" card with the result chip
  docked inside its bottom edge, one big camera-icon Scan button, and the
  other ways in (Photos / Binder Page / Sealed / Import) as a 2x2 grid of icon
  tiles. Must fit one 375x812 screen. Desktop puts the viewfinder left and a
  "Ready to scan" column right; the drag-and-drop hint shows only on a fine
  pointer.
- Email confirmation (09-30): one `ConfirmEmailPanel` serves signup step 2,
  the `/app` wall (`SubscriptionGate`) and the account page. It never reads
  `SessionProvider` (signup sits outside it) and reports back through props.
  The code box has no `maxLength` (a paste of "482 913" must survive) and
  submits on the sixth digit; `autoFocus` is a convenience, iOS raises the
  keyboard only from a tap. The wall polls `GET /api/auth/verify-email` (5 s,
  then 30 s) and on focus/visibility, because the mail's button opens in
  Safari, a different cookie jar from the installed app. After the confirm
  step the "You're in" screen promises the confirmed user's `trialScansLeft`,
  never a constant: a second signup on a shared device starts at 0 and gets
  plan-first copy. A signup without the confirm step (switch Off) gets exactly
  the old screen, from `PRICING.trial.scans`. On the account page the code box
  under Name & email always has "Use a Different Email" (a mistyped new
  address must not hold the row for the code's hour), "Email changed" shows
  only when the address really moved (`changeLanded`), and a walled Plan row
  offers no Subscribe or Scan Pack. The Change Email form counts down only what
  the server said (a signup mails its first code without using the resend
  allowance). Help copy promises no email reply to an unconfirmed account. The
  switch ships Off (`/admin/switches`), so none of this shows until Chris flips
  it.

- Scan balance (09-30, scans roll over): every string comes from `lib/scanCopy.ts`
  and the two sentences in `lib/pricing.ts` (`ROLLOVER_SENTENCE`,
  `FROZEN_SENTENCE`); nothing retypes the promise, and `npm run test:rollovercopy`
  fails if a "resets on the 1st" line comes back. A subscriber's header reads
  "488 scans" (no "/ 250": nothing resets; trial and legacy keep "3 / 5 free"
  and "80 / 100 today"); the tooltip names the carried-over scans and the next
  credit date. Every date is Eastern (`lib/time.ts`). The account Plan row lists
  what is real (plan scans, carried over, bonus, Scan Pack, next credit) and no
  bar, since nothing divides by a monthly cap. A plan set to end says "Plan ends
  Oct 25; 238 banked scans pause until you resubscribe" in an amber line; an
  ended plan's banked scans show as "paused" in the header, the wall and the
  account row, never as zero. The welcome page and the account page's confirmed
  state wait for scans > 0 (the webhook flips the status a beat before the
  credit lands).

## Voice

Plain, confident, a little dry ("CardFlip does the other nine."). No hype
adjectives, no exclamation marks, no crypto/NFT vocabulary.

Exception (Chris, 09-04): the first-login tutorial (TourOverlay) speaks as
a slightly self-aware robot that knows it lives in an overlay — deadpan
weird comedy to loosen a new seller up ("I do not get tired and I am not
paid", "I have nothing else to do at 3am"). Still no exclamation marks,
still no hype. Nowhere else in the product talks like this. Its pointer is
two breathing halo rings on the target plus a tooltip tail on the card —
a drawn arrow line was tried and read as robotic.

## Casing (Chris, 09-06)

Buttons, links that act as buttons, nav tabs, header pills and chips, and
step chips are **Title Case**: "Unlock 100 Free Scans", "Scan a Card",
"Search Cards", "Copy Link". Articles, short prepositions and conjunctions
stay lower ("a", "the", "to", "on", "in", "of", "and") except in "Log In" /
"Sign Up" / "Sign Out". Brand spellings win ("eBay", "CardFlip", "PSA").
Body copy, status lines, hints and headings stay sentence case. The sweep
that applied this lives in the session scratch (a regex over <button>/<Link>
labels); new labels just follow the rule by hand.
