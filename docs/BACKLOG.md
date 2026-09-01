# Backlog (checklists)

Written 2026-08-16 from a full project audit; ticks = done that evening. Excludes payment/subscription
billing (Chris: not yet). Sizes S/M/L. "(deferred)" = Chris chose to park it.
Tick items here; move finished narrative to HISTORY.md, not STATE.md.

## 1. Known bugs / open issues

- [x] Deploy Magic seed fix + camera ✕ + strike — v96 live, prod MTG search verified 08-16
- [x] M — Comps filter lets loose number matches through — fixed 08-16 (suffix guard + set-total check, 13 tests) (`Charizard 4` ↔ "Charizard V 004/127"); tighten `isComparable` in `src/lib/ebayComps.ts`
- [x] M — Wrong default match when the number is unread (full-art Sprigatito → SVP promo, 08-16 phone) — vision `artStyle` + `ART_PENALTY` tiebreak in `enCards.ts`; awaiting Chris's rescan on prod. Follow-up if it recurs: add `rarity` to `en_cards` (`sync:en`) and rank on it
- [ ] M — **Real net-after-fees per sale, visible to sellers** (Chris, 08-31). Today the Earned tile and admin stats estimate fees at 13.25% + $0.30 — it matched the first real sale ($447.99 → $388.33) to the cent, but real fees vary (promoted listings, store tiers, category rates, international). Track the ACTUAL fee per sold card: best source is eBay Finances API (getTransactions, needs sell.finances scope added to USER_SCOPES and every seller re-consenting) pulled by the daily sync; fallback is a fee field on the mark-sold flow the seller can type from their payout email. Store per-card (new columns: sold_fees REAL, sold_net REAL), show net on the collection Earned tile (already leads with the estimate) and per-card in the sold panel; admin stats switch from estimate to sum of actuals where present.
- [x] S — eBay `program/opt_in` 403: scope added, Chris reconnected 09-01. Self-verifies on his next publish (opt-in retries per publish).
- [ ] M — Bulk drafts CSV (`toEbayDraftsCsv`, `src/lib/listing.ts`) never uploaded to real eBay — validate header/#INFO rows
- [ ] M — Inventory condition-descriptor IDs unverified (`src/lib/ebayInventory.ts`); graded may need cert descriptor 27503
- [x] S — Publish 20403 "not eligible": createDefaultPolicies (08-27, ebaySell.ts) now auto-creates policies + location at publish; with the 09-01 reconnect the whole chain should clear. Confirm on Chris's next real publish.
- [x] S — Keldeo listing 5230387616323 — Chris deleted it on eBay 09-01 (doubles as the ended-listing-sync live test: My Cards should show the amber "Ended on eBay" chip after the next sync pass)
- [x] S — `/terms` governing law — Maryland (Chris, 09-01)
- [ ] S — Untested on hardware: auto-scan thresholds, torch, iOS reveal/chime/haptics, ✕, real MTG photo via vision, HEIC
- [x] S — Favicon vs header logo — DONE 09-01 same day (Chris: "way better, perfect"): transparent bg + tight viewBox crop so the mark fills the frame; verified legible at 16px via canvas-downscale sim; apple-icon keeps the solid square.
- [x] `/admin` overhauled 08-16 (Chris: "go crazy"): own operator login (`/admin/login`, `ADMIN_PANEL_USER`/`ADMIN_PANEL_PASSWORD`, defaults admin/onyx per Chris — override on Fly), signed 12 h cookie, rate-limited; console = KPIs, 30-day activity bars (scans/sign-ups/price checks/sold), searchable+sortable users w/ rollups + delete, recent cards, prices & data (series counts, daily-job status + Run now, mirrors, storage), system (integrations configured, process). `test:admin` 16 checks

## 2. Deferred features (mostly by choice or blocked on eBay)

- [ ] L — eBay Listing API (`sell.item.draft`) access — apply at developer.ebay.com/my/support (blocked). **Confirmed 08-27 by probing each scope separately against `auth.ebay.com`: this keyset holds the other four and rejects only this one.** It was failing the *entire* authorize call with `invalid_scope`, so no seller could link an account at all — not merely lose drafts. Now opt-in behind `EBAY_DRAFT_SCOPE=1` (`ebayAuth.ts`), and `createDraft` reports unavailable up front. When eBay approves the keyset: set that env var, redeploy, nothing else to write. The inventory/offer publish road never needed it.
- [x] ~~Marketplace Insights~~ — DENIED by eBay 08-16 (partner-only, ticket closed). Sold-comps call now gated off (`EBAY_INSIGHTS_ENABLED`); sold data = price-history route instead (see §7)
- [x] S — SMTP secrets (`SMTP_HOST/PORT/USER/PASS`) — set on Vercel (Fastmail app password). **Still never exercised**: no reset email has actually been sent, before or after the cutover. First real send is the test.
- [x] M — **Branded sending address `support@cardflip.io`** — DONE 08-31: Fastmail domain added (catch-all -> Chris's inbox, verified green), Dynadot got 2 MX + SPF TXT + 3 DKIM CNAMEs (all confirmed on public DNS; website records untouched), inbound tested from Gmail, `MAIL_FROM=CardFlip <support@cardflip.io>` on Vercel. Original notes: Reset emails currently come from his personal `chris@superiormarketing.com`. No code work needed — `mail.ts` already honours `MAIL_FROM` and falls back to `SMTP_USER`; it is entirely a domain-email setup job. Blocker: **`cardflip.io` has no mail DNS at all** — verified 08-27, no MX, no SPF, no DKIM. Flipping `MAIL_FROM` alone would get the send refused by Fastmail or land resets in spam (nothing authorises the domain, and DKIM would still sign as superiormarketing.com). Order when picked up: (1) Fastmail → Settings → Domains → add `cardflip.io`, which prints the record list; (2) Dynadot → add its MX + SPF TXT + three `fm1/2/3._domainkey` CNAMEs — these are independent of the A/CNAME records so the website is not at risk; (3) Fastmail → alias `support@cardflip.io` (gives a real inbox, so replies don't bounce); (4) Vercel → `MAIL_FROM = CardFlip <support@cardflip.io>`, leaving `SMTP_USER`/`SMTP_PASS` as the Fastmail login; (5) redeploy and send a real reset to confirm SPF/DKIM pass. Steps 1–3 need Chris's Fastmail/Dynadot logins — Claude has neither and proving domain ownership inherently requires DNS access.
- [x] S — Rotate PRD Cert ID — done 08-27 (it had been set as `EBAY_CLIENT_ID` and was therefore leaking in public redirect URLs; old key in 30-day grace). Deletion-endpoint verification token also replaced the same day.
- [x] S — "Scanning" chip pulses + spinner spins under reduced motion (.chip-working exemption, 08-17)
- [x] S — MTG wishlist re-pricing — rows now carry `game` + `card_id` (08-16 late); rows saved before then default to Pokémon
- [ ] S — Root SPF record superiormarketing.com (optional)
- [ ] — RevealStrike: leave as is. Full RevealScene: reverted, don't rebuild without asking.

## 3. Product-readiness

- [x] M — **Rate limiting** — done 08-16, `lib/server/rateLimit.ts`, 26 tests on `/api/vision/scan` (paid Anthropic), `/api/ebay/comps`, `/api/search-card` — demo login can drain credit. Highest-value unbuilt item.
- [ ] M — Error monitoring (error-only; `/privacy` promises no analytics profile — keep copy true)
- [x] M — **eBay order sync** — done 08-25 (`8992c54`, deploy pending): `ebayOrders.ts` + `/api/ebay/sync-sales` + daily-job sweep; auto-marks sold from real orders; needs seller reconnect for the new fulfillment scope
- [x] S — **Editable listing title/description** — done 08-25: overrides on the queue item, all 3 posting roads, reset link
- [x] S — **Demo seeding + pricing trust** — done 08-25: demo login seeds 6 real cards; lookup dedupe; Cardmarket outlier guards (fetch + display)
- [x] M — ~~Multi-photo~~ VETOED by Chris 09-01 ("we dont need the back of the card"); quantity >1 SHIPPED 09-01 (Copies input, qty-aware sales sync)
- [x] M — Auto-offers to watchers (manual v1) + reprice nudge — both SHIPPED 09-01 (ebayNegotiation.ts / price_series nudge)
- [ ] S — Graded slab cert-number lookup (PSA/CGC APIs) — cheap, weakly covered even by paid rivals
- [x] S — Wishlist price alerts — SHIPPED 09-01 (daily email via wishlistAlerts.ts)
- [x] S — Collection CSV export — SHIPPED 09-01 (own format, BOM+CRLF)
- [x] M — **SQLite backup off the Fly volume** — done 08-25 (`77cc87f`): Tigris path retired with Fly. **Replaced 08-31 by `scripts/backup-turso.mjs`** (Turso → local `backups/turso/*.db.gz`, verified full dump) after the old Turso account loss proved PITR isn't enough. Scheduler DONE: Windows Task Scheduler "CardFlip Turso backup" daily 10:00 AM on Chris's PC (verified 09-01: last run exit 0, 63 MB cardflip-2026-09-01.db.gz present). Off-site copy (S3/Drive) still optional
- [x] S — PWA: — done 08-16 (manifest.ts + generated icons) `manifest.json`, apple-touch-icon, maskable icon (phone-first scanner, cheap win)
- [x] M — **Account settings** `/app/account` (08-17): your-data counts, rename, change email (password-gated), change password (signs out other devices), eBay link status → /connect-ebay, sign out other devices, plan (early access), delete account (password + DELETE). Demo read-only. Routes `/api/account` GET/PATCH/DELETE, `/api/account/password`, `/api/account/sessions`. Entry = person icon at the end of AppTabs
- [x] S — Scanner empty state has a 3-step strip (snap → match/price → draft on eBay) (08-17)
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
- [x] M — Shared `<AppHeader>` + `SessionProvider` in `app/app/layout.tsx` (08-17): one `/api/auth/me`, header renders instantly, pages show `PageSkeleton` not blank; sign-out/eBay/admin/account links on every app page. Toast bus `components/Toaster.tsx` (`toast()`), wired to wishlist add, detail-modal save, copy listing
- [x] M — Scan queue survives refresh (08-17): `queuePersistence.ts` sessionStorage + restore from ledger rows (photo/vision unrecoverable; unsaved scans counted in a toast). Verified on dev: search-add → refresh → card restored
- [x] S — Signup `?step=ebay` (08-17): refresh/back resumes on step 2 when signed in
- [x] S — `PasswordField` (eye toggle + live length hint) on signup/reset/login (08-17)
- [x] S — `useFocusTrap` on CameraCapture/CardDetailModal/CardPeekModal; `role=dialog` on the panel (08-17)
- [x] S — Stale-search guard: seq counter on Search-cards page (Enter could overlap); ScannerSearch/wishlist already busy-guarded. Card grid images lazy-load (08-17)
- [x] S — Page/title now "Search cards" like the tab (08-17)

## 7. Market insights / price history — BUILT 08-16 evening (undeployed)

- [x] `price_series` (one compact row per card/variant/source, JSON day array — `lib/priceSeries.ts`; the row-per-day version hit 6.4 GB). MTG recorded by `sync:mtg` and shipped in the seed; Pokémon on every fresh lookup (`putCachedCards`) + lazy daily sweep of ledger/wishlist (`after()` in `/api/auth/me`)
- [x] `npm run backfill:mtg` — MTGJSON 90 days (May 17 → Aug 15), USD/TCGplayer, series ≥ 50¢: 73k series / 6.3M points, seed 8.3 → 15.6 MB. Re-run monthly-ish if wanted; `sync:mtg` appends daily
- [x] `/api/price-history?cardId=` (+ 30/90/all stats) → `PriceHistoryChart` (SVG line, crosshair, min/max labels, 30d/90d/All) in `CardDetailModal` and the editor's `MarketMetricsPanel`; 27-test suite `test:pricehistory`
- [x] **Self-updating daily (Chris 08-16: "the charts should update itself once daily")** — `lib/server/dailyJobs.ts` `runDailyIfDue()`: Magic prices from Scryfall's bulk JSONL (`mtgPriceRefresh.ts`, ~12 s, works from Fly — one CDN download) + Pokémon sweep (held + wishlist + last-30-day price checks, retry once). Triggers: hourly timer (`instrumentation.ts`), `/api/auth/me` heartbeat, `GET /api/cron/daily?key=CRON_SECRET` for an external pinger. Seed import now merges history by day. `npm run refresh:prices -- --force` runs it by hand.
- [x] S — ~~Set `CRON_SECRET` on Fly + pinger~~ superseded by Vercel Cron (vercel.json: /api/cron/mtg-prices 9:00, /api/cron/pokemon-prices 9:45 daily, eBay sweeps folded into the latter; CRON_SECRET set on Vercel). Verified stale 09-01.
- [x] **Pokémon 90-day history — DONE 08-16 via TCGCSV** (tcgcsv.com daily TCGplayer archives, free, 4 MB/day, 7-Zip on PC): `npm run backfill:pokemon` builds `tcgplayer_products` (153/217 sets, 21k cards) + 20.9k series; prod refreshes daily from TCGCSV live JSON (`pokemonPriceRefresh.ts`, 151 sets, ~15 s). Unmatched: trainer kits / POP / a few promos (~1.1k cards). Threshold lowered 50¢ → 5¢ (Chris: a 32¢ holo with $1.68 eBay asking showed one point) → 34k Pokémon + 142k Magic series, seed 22.6 MB + the product map. TCGplayer tile falls back to the last recorded point when the live lookup fails
- [x] S — Chart in `CardPeekModal` (landing, compact) + 30-day `PriceSparkline` on wishlist rows — done 08-16 late (wishlist rows now store `card_id`/`game`; older rows resolve the id from the repricing pass; MTG rows reprice with `?game=mtg`)
- [ ] — Paid fallback if deeper history is wanted later: PriceCharting API
