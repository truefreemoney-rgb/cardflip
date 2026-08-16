# Backlog (checklists)

Written 2026-08-16 from a full project audit. Excludes payment/subscription
billing (Chris: not yet). Sizes S/M/L. "(deferred)" = Chris chose to park it.
Tick items here; move finished narrative to HISTORY.md, not STATE.md.

## 1. Known bugs / open issues

- [x] Deploy Magic seed fix + camera ✕ + strike — v96 live, prod MTG search verified 08-16
- [ ] M — Comps filter lets loose number matches through (`Charizard 4` ↔ "Charizard V 004/127"); tighten `isComparable` in `src/lib/ebayComps.ts`
- [ ] S — eBay `program/opt_in` 403: scope added, Chris must reconnect eBay once
- [ ] M — Bulk drafts CSV (`toEbayDraftsCsv`, `src/lib/listing.ts`) never uploaded to real eBay — validate header/#INFO rows
- [ ] M — Inventory condition-descriptor IDs unverified (`src/lib/ebayInventory.ts`); graded may need cert descriptor 27503
- [ ] S — Publish 20403 "not eligible": eBay account needs Business Policies + location
- [ ] S — Keldeo listing 5230387616323 live with no photo — end it
- [ ] S — `/terms` governing-law state placeholder — need real state from Chris
- [ ] S — Untested on hardware: auto-scan thresholds, torch, iOS reveal/chime/haptics, ✕, real MTG photo via vision, HEIC
- [ ] S — Chris to confirm he can log into `/admin`

## 2. Deferred features (mostly by choice or blocked on eBay)

- [ ] L — eBay Listing API (`sell.item.draft`) access — apply at developer.ebay.com/my/support (blocked)
- [ ] M — Marketplace Insights approval → sold comps; then check `pickPrice` prefers sold + `MarketMetricsPanel` copy (blocked)
- [ ] S — SMTP secrets (`SMTP_HOST/PORT/USER/PASS`) so password reset emails work (deferred)
- [ ] S — Rotate PRD Cert ID; rotate eBay deletion-endpoint verification token (was pasted in STATE.md)
- [ ] S — "Identifying…" QueueRow chip pulse (needs reduced-motion exemption)
- [ ] S — MTG wishlist re-pricing (rows carry no `game`) (deferred)
- [ ] S — Root SPF record superiormarketing.com (optional)
- [ ] — RevealStrike: leave as is. Full RevealScene: reverted, don't rebuild without asking.

## 3. Product-readiness

- [ ] M — **Rate limiting** on `/api/vision/scan` (paid Anthropic), `/api/ebay/comps`, `/api/search-card` — demo login can drain credit. Highest-value unbuilt item.
- [ ] M — Error monitoring (error-only; `/privacy` promises no analytics profile — keep copy true)
- [ ] M — SQLite backup off the Fly volume (Litestream / nightly export) — users, ledger, photos, eBay tokens are single-copy
- [ ] S — PWA: `manifest.json`, apple-touch-icon, maskable icon (phone-first scanner, cheap win)
- [ ] S — First-scan onboarding / empty-state guidance (OnboardingSteps is signup-only)
- [ ] S — `.env.example` documenting the 18 env vars
- [ ] S — README stale: no Magic, auth, sealed/graded, eBay OAuth/push; lists 1 of 6 test suites
- Done: auth + per-user isolation, `/terms` `/privacy`, robots/sitemap/OG, landing, branded 404

## 4. Testing / quality

- [ ] M — Auth tests: signup, login, sliding sessions, password reset, admin gating
- [ ] M — API-route tests (currently curl-only)
- [ ] M — Ledger/wishlist/price-check server tests incl. fee math (13.25% + $0.30)
- [ ] S — Tests for `enCards.ts` ranking, `db.ts` ALTER-probe migrations, `seedMtgMirror` completeness (the code that broke prod)
- [ ] S — Zero-catch routes: `api/auth/demo`, `auth/logout`, `auth/me`, `card-image/[id]`, `ebay/connect`, `sets`
- [ ] S — `npm test` aggregate script running all 6 suites
- [ ] S — No component/E2E tests (Playwright) — manual only

## 5. Ops / deploy

- [ ] L — **124 uncommitted files, last commit e10482c (Aug 11)** — commit now; no rollback point for 5 days of work
- [ ] M — Deploy is manual (Chris only), no CI lint/test/build gate
- [ ] S — MTG mirror refresh is manual from Chris's PC (`sync:mtg && export:mtg && deploy`, Scryfall 429s Fly); Pokémon set sync also manual
- [ ] S — Single 512 MB machine, scale-to-zero, DB on one volume (see backup)
