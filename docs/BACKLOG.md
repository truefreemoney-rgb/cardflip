# Backlog (checklists)

Written 2026-08-16 from a full project audit; ticks = done that evening. Excludes payment/subscription
billing (Chris: not yet). Sizes S/M/L. "(deferred)" = Chris chose to park it.
Tick items here; move finished narrative to HISTORY.md, not STATE.md.

## 1. Known bugs / open issues

- [x] Deploy Magic seed fix + camera ✕ + strike — v96 live, prod MTG search verified 08-16
- [x] M — Comps filter lets loose number matches through — fixed 08-16 (suffix guard + set-total check, 13 tests) (`Charizard 4` ↔ "Charizard V 004/127"); tighten `isComparable` in `src/lib/ebayComps.ts`
- [ ] S — eBay `program/opt_in` 403: scope added, Chris must reconnect eBay once
- [ ] M — Bulk drafts CSV (`toEbayDraftsCsv`, `src/lib/listing.ts`) never uploaded to real eBay — validate header/#INFO rows
- [ ] M — Inventory condition-descriptor IDs unverified (`src/lib/ebayInventory.ts`); graded may need cert descriptor 27503
- [ ] S — Publish 20403 "not eligible": eBay account needs Business Policies + location
- [ ] S — Keldeo listing 5230387616323 live with no photo — end it
- [ ] S — `/terms` governing-law state placeholder — need real state from Chris
- [ ] S — Untested on hardware: auto-scan thresholds, torch, iOS reveal/chime/haptics, ✕, real MTG photo via vision, HEIC
- [x] `/admin` overhauled 08-16 (Chris: "go crazy"): own operator login (`/admin/login`, `ADMIN_PANEL_USER`/`ADMIN_PANEL_PASSWORD`, defaults admin/Access1 per Chris — override on Fly), signed 12 h cookie, rate-limited; console = KPIs, 30-day activity bars (scans/sign-ups/price checks/sold), searchable+sortable users w/ rollups + delete, recent cards, prices & data (series counts, daily-job status + Run now, mirrors, storage), system (integrations configured, process). `test:admin` 16 checks

## 2. Deferred features (mostly by choice or blocked on eBay)

- [ ] L — eBay Listing API (`sell.item.draft`) access — apply at developer.ebay.com/my/support (blocked)
- [x] ~~Marketplace Insights~~ — DENIED by eBay 08-16 (partner-only, ticket closed). Sold-comps call now gated off (`EBAY_INSIGHTS_ENABLED`); sold data = price-history route instead (see §7)
- [ ] S — SMTP secrets (`SMTP_HOST/PORT/USER/PASS`) so password reset emails work (deferred)
- [ ] S — Rotate PRD Cert ID; rotate eBay deletion-endpoint verification token (was pasted in STATE.md)
- [ ] S — "Identifying…" QueueRow chip pulse (needs reduced-motion exemption)
- [ ] S — MTG wishlist re-pricing (rows carry no `game`) (deferred)
- [ ] S — Root SPF record superiormarketing.com (optional)
- [ ] — RevealStrike: leave as is. Full RevealScene: reverted, don't rebuild without asking.

## 3. Product-readiness

- [x] M — **Rate limiting** — done 08-16, `lib/server/rateLimit.ts`, 26 tests on `/api/vision/scan` (paid Anthropic), `/api/ebay/comps`, `/api/search-card` — demo login can drain credit. Highest-value unbuilt item.
- [ ] M — Error monitoring (error-only; `/privacy` promises no analytics profile — keep copy true)
- [ ] M — SQLite backup off the Fly volume (Litestream / nightly export) — users, ledger, photos, eBay tokens are single-copy
- [x] S — PWA: — done 08-16 (manifest.ts + generated icons) `manifest.json`, apple-touch-icon, maskable icon (phone-first scanner, cheap win)
- [ ] S — First-scan onboarding / empty-state guidance (OnboardingSteps is signup-only)
- [x] S — `.env.example` — done 08-16 documenting the 18 env vars
- [x] S — README stale — rewritten 08-16: no Magic, auth, sealed/graded, eBay OAuth/push; lists 1 of 6 test suites
- Done: auth + per-user isolation, `/terms` `/privacy`, robots/sitemap/OG, landing, branded 404

## 4. Testing / quality

- [ ] M — Auth tests: signup, login, sliding sessions, password reset, admin gating
- [ ] M — API-route tests (currently curl-only)
- [ ] M — Ledger/wishlist/price-check server tests incl. fee math (13.25% + $0.30)
- [ ] S — Tests for `enCards.ts` ranking, `db.ts` ALTER-probe migrations, `seedMtgMirror` completeness (the code that broke prod)
- [x] S — Zero-catch routes — sets/card-image/demo wrapped 08-16; logout/me/connect are trivial, left: `api/auth/demo`, `auth/logout`, `auth/me`, `card-image/[id]`, `ebay/connect`, `sets`
- [x] S — `npm test` aggregate — done 08-16 script running all 6 suites
- [ ] S — No component/E2E tests (Playwright) — manual only

## 5. Ops / deploy

- [x] L — **124 uncommitted files — committed 08-16 as 3d728a9 + follow-ups, last commit e10482c (Aug 11)** — commit now; no rollback point for 5 days of work
- [ ] M — Deploy is manual (Chris only), no CI lint/test/build gate
- [ ] S — MTG mirror refresh is manual from Chris's PC (`sync:mtg && export:mtg && deploy`, Scryfall 429s Fly); Pokémon set sync also manual
- [ ] S — Single 512 MB machine, scale-to-zero, DB on one volume (see backup)

## 6. QoL pass (08-16 evening) — done

- [x] Auth forms: 16px inputs on mobile (no iOS zoom), autoFocus first field, required/inputMode/enterKeyHint, client-side empty check, `name` on reset fields, titles for forgot/reset
- [x] Login/demo/reset use `router.replace` (Back never lands on a login form); expired sessions bounce to `/login?next=<path>` and return there
- [x] Collection: confirm before delete; optimistic status/delete rolled back with a visible error when the server write fails; filter input labelled + `type=search`
- [x] Wishlist: remove rolled back on failure, add failure surfaced
- [x] eBay disconnect confirms first and shows failure; "Copied ✓" only after the clipboard write succeeds (prompt fallback)
- [x] Camera modal: Escape closes, body scroll locked, focus returns to opener, `aria-modal`
- [x] `createServerCard` retried once; editor explains when a card has no server row (was misleading "Connect eBay")
- [x] Landing "20,000+" → computed `catalogSizeLabel()` (130,000+); foil/etched in feature copy; WotC in public footer; Scryfall in privacy
- [x] `formatMoney` groups thousands ($1,499.00); ticker "$1,499"
- [x] `min-h-screen`→`min-h-dvh`, `70vh/60vh`→dvh, safe-area top padding on app headers, `viewportFit: cover`
- [x] Remove buttons visible on touch (hover-only fade gated on `@media(hover:hover)`), bigger tap targets; camera emoji hidden from screen readers; "Price check" title casing

### QoL still open (from the audit, not done)
- [ ] M — Shared `<AppHeader>` + server-side session in `app/layout.tsx` (kills 4× `/api/auth/me` and the blank flash; adds sign-out/eBay/admin links to collection/wishlist/price-check)
- [ ] M — Persist scan queue ids in sessionStorage so a refresh doesn't lose an in-progress stack
- [ ] S — Signup account→eBay phase in the URL (`?step=ebay`) so Back/refresh behave
- [ ] S — Password show/hide toggle + live min-length hint on signup/reset
- [ ] S — Focus trap in CameraCapture/CardDetailModal; `role=dialog` on the panel not the backdrop
- [ ] S — AbortController on wishlist repricing fan-out; debounce search inputs
- [ ] S — Tab "Search cards" vs page "Price check" — pick one name

## 7. Market insights / price history — BUILT 08-16 evening (undeployed)

- [x] `price_series` (one compact row per card/variant/source, JSON day array — `lib/priceSeries.ts`; the row-per-day version hit 6.4 GB). MTG recorded by `sync:mtg` and shipped in the seed; Pokémon on every fresh lookup (`putCachedCards`) + lazy daily sweep of ledger/wishlist (`after()` in `/api/auth/me`)
- [x] `npm run backfill:mtg` — MTGJSON 90 days (May 17 → Aug 15), USD/TCGplayer, series ≥ 50¢: 73k series / 6.3M points, seed 8.3 → 15.6 MB. Re-run monthly-ish if wanted; `sync:mtg` appends daily
- [x] `/api/price-history?cardId=` (+ 30/90/all stats) → `PriceHistoryChart` (SVG line, crosshair, min/max labels, 30d/90d/All) in `CardDetailModal` and the editor's `MarketMetricsPanel`; 27-test suite `test:pricehistory`
- [x] **Self-updating daily (Chris 08-16: "the charts should update itself once daily")** — `lib/server/dailyJobs.ts` `runDailyIfDue()`: Magic prices from Scryfall's bulk JSONL (`mtgPriceRefresh.ts`, ~12 s, works from Fly — one CDN download) + Pokémon sweep (held + wishlist + last-30-day price checks, retry once). Triggers: hourly timer (`instrumentation.ts`), `/api/auth/me` heartbeat, `GET /api/cron/daily?key=CRON_SECRET` for an external pinger. Seed import now merges history by day. `npm run refresh:prices -- --force` runs it by hand.
- [ ] S — Set `CRON_SECRET` on Fly + point a pinger at `/api/cron/daily?key=…` once a day (cron-job.org / Claude scheduled task) so zero-traffic days still refresh
- [x] **Pokémon 90-day history — DONE 08-16 via TCGCSV** (tcgcsv.com daily TCGplayer archives, free, 4 MB/day, 7-Zip on PC): `npm run backfill:pokemon` builds `tcgplayer_products` (153/217 sets, 21k cards) + 20.9k series; prod refreshes daily from TCGCSV live JSON (`pokemonPriceRefresh.ts`, 151 sets, ~15 s). Unmatched: trainer kits / POP / a few promos (~1.1k cards). Threshold lowered 50¢ → 5¢ (Chris: a 32¢ holo with $1.68 eBay asking showed one point) → 34k Pokémon + 142k Magic series, seed 22.6 MB + the product map. TCGplayer tile falls back to the last recorded point when the live lookup fails
- [ ] S — Show the chart in `CardPeekModal` (landing) and wishlist rows (sparkline)
- [ ] — Paid fallback if deeper history is wanted later: PriceCharting API
