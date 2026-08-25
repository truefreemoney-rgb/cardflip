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
remembered (`cardflip.scanFx`), default on. A running tally pill (cards ·
value) sits under the status pill. All one-shot after the sweep — nothing
loops once a match is showing. Voice stays dry: the labels are the only
celebration copy.

## Data honesty (non-negotiable, eBay-review-relevant)

Every card, image, and price shown on marketing surfaces is real, fetched
live (`getFeaturedCard`, `getShowcaseCards` — cached a day, sections skip
cleanly on failure). No placeholder cards, no invented prices, no fake
testimonials, no fabricated eBay connection. Copy claims only what the
product does today.

## Component patterns

- Public card peek: `CardPeekModal` (HoloCard 3D + live price + CTA) — the
  logged-out sibling of the app's `CardDetailModal` (which assumes auth).
  Any clickable card on marketing surfaces opens it.
- 3D card: always `HoloCard` — never reimplement tilt/glare.
- Panels: rounded-2xl/3xl. Pills (nav, tabs, badges, CTAs): rounded-full.
- App chrome: sticky header with holo hairline (same class string on all
  four app pages — keep them identical), `AppTabs` foil pill.
- Legal pages stay sober: no holo, no foil. Reviewer-facing.

## Voice

Plain, confident, a little dry ("CardFlip does the other nine."). No hype
adjectives, no exclamation marks, no crypto/NFT vocabulary.
