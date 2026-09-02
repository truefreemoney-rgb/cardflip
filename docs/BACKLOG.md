# Backlog (checklists)

Written 2026-08-16 from a full project audit; ticks = done that evening. Excludes payment/subscription
billing (Chris: not yet). Sizes S/M/L. "(deferred)" = Chris chose to park it.
Tick items here; move finished narrative to HISTORY.md, not STATE.md.

## 0. CURRENT TRACK (consolidated 09-02 — full sweep of BACKLOG + STATE's WAITING-ON-CHRIS/NEXT-WORK/parked items; THIS section is the one list, sections below are detail/archive)

### Pre-launch blockers (Chris decisions)
- [x] **Stripe payouts bank account** — ADDED 09-02 by Chris (found via red banner same day; USD row now has a payout destination). Note: a Treasury "Financial account" (fa_65VK7n2Sn…) exists on the account — harmless, unused; payouts go to the real bank.
- [ ] **Stripe business address** — home address shows on paying customers' receipts. PO boxes REJECTED by Stripe. Pick: UPS Store mailbox (easiest), iPostal1-style virtual (~$10-15/mo), or MD LLC registered agent (LLC itself worth a pre-launch think). Deadline: before first real subscriber.
- [ ] **Price point** — Chris unsure about $9.99/500. When decided: MONTHLY_SCANS + "500 scans" in 5 copy spots (grep) + Stripe price object.
- [ ] Stripe polish: branding logo/color; verify Settings→Emails "Successful payments" toggle; OPTIONAL sk_live rotation (chat-exposed 09-01; roll in dashboard + rerun scripts/flip-stripe-live.mjs). Turso tokens also chat-exposed — Chris accepted that risk 08-31.

### Live-test batch (Chris's next posting/sale — passive, no code)
- [x] Publish a listing — DONE 09-02: Simisage 090/86 live at $8.99 through CardFlip (truefreemoney eBay acct) — whole post-reconnect chain clean. View-on-eBay upgraded to a real button same session (Chris feedback)
- [ ] Push a non-NM card → expect NO "saved without condition detail" (183454 descriptor fix); a GRADED push also verifies cert descriptor 27503
- [ ] End that listing on eBay → amber "Ended on eBay" chip in My Cards
- [ ] Reprice a live listing → offer PUT verified
- [ ] Watcher offers: one real send once a listing has watchers
- [ ] Multi-qty sale: partial purchase → sold-row split + decrement
- [ ] After a real sale: net flips estimate→actual within ~a day, matches payout email, tooltip "(actual)"
- [ ] Wishlist alert email confirms itself on first real dip
- [x] Phone: auto-scan retested 09-01 — holos + close-up both fire (Chris: "it works"); idle pill now hints "fill the frame, not too close"
- [x] Cancel test sub — DONE 09-02: Stripe portal verified (branded, invoice history; NOTE business name reads "Card Flip" w/ space — fix in branding polish), cancel-at-period-end set (service to Oct 2; sub_status flips + webhook cancel path self-verifies then), $9.99 refunded ("Requested by customer"). NEW FIND: Stripe has NO BANK ACCOUNT for payouts — red banner in dashboard — promoted to pre-launch blockers

### Waiting on third parties
- [ ] PSA: prod retest after daily quota reset (Claude, next session FIRST ACTION) — 200 = done; 403 = Vercel IPs blocked. Also watch support@cardflip.io for collectors-apis reply (limit raise + IP question + quota mystery, sent 09-01)
- [ ] eBay draft-scope keyset application (blocked on eBay; EBAY_DRAFT_SCOPE=1 + redeploy when approved)

### Claude's code queue (rough order)
- [ ] Tests: prod-breaker trio (enCards ranking, db ALTER probes, seedMtgMirror completeness); API-route tests for account/admin/eBay routes (needs a cookies() harness — lower value); Playwright E2E someday
- [ ] Bulk drafts CSV validated against a real eBay Seller Hub upload (desktop, deliberate act)
- [ ] Watcher offers v2: auto-fire on slow movers, eligible-list pagination past 200, custom message
- [ ] Automate catalog syncs now manual on Chris's PC (MTG mirror refresh; Pokémon set sync — Scryfall 429s cloud IPs, needs care)
- [ ] Anthropic credits auto-reload (ran dry once 09-01; optional)
- [ ] Known drift to watch: queue rows/CSV quote the pricing snapshot, not the chart's current-day rebase — flag if Chris notices

### BACKBURNER (Chris's explicit parks)
- [ ] /help FAQ section (S per batch; error states deep-link to articles; do FIRST) then first-login overlay tour (M, coach marks + tour_seen_at) — "totally want to add those one day"
- [ ] Own eBay price series: record asking avg in comps route + ~150/day sweep; chart prefers ebay source once points exist
- [ ] Photo-first sealed re-add in the scanner — "sometime later"
- [ ] Merge Search cards into Watchlist — post-launch maybe, only if real users get confused
- [ ] CGC cert lookup — their API is tough to get (Chris checked 09-01)
- [ ] Listed-for price shown on sold rows — parked "for now"
- [ ] Off-site backup copy (S3/Drive) on top of the nightly local Turso dump
- [ ] Root SPF record superiormarketing.com (optional); PriceCharting API if deeper history wanted
- [ ] RevealScene: do NOT rebuild without asking (RevealStrike stays as is)

## 1. Known bugs / open issues

- [x] Deploy Magic seed fix + camera ✕ + strike — v96 live, prod MTG search verified 08-16
- [x] M — Comps filter lets loose number matches through — fixed 08-16 (suffix guard + set-total check, 13 tests) (`Charizard 4` ↔ "Charizard V 004/127"); tighten `isComparable` in `src/lib/ebayComps.ts`
- [x] M — Wrong default match when the number is unread (full-art Sprigatito → SVP promo, 08-16 phone) — vision `artStyle` + `ART_PENALTY` tiebreak in `enCards.ts`; awaiting Chris's rescan on prod. Follow-up if it recurs: add `rarity` to `en_cards` (`sync:en`) and rank on it
- [x] M — **Real net-after-fees per sale** SHIPPED 09-01 (see STATE: lib/fees.ts one source, ebayFinances.ts syncEbayFees, sell.finances scope; Chris reconnected — verifies on next real sale vs payout email). Original notes: Today the Earned tile and admin stats estimate fees at 13.25% + $0.30 — it matched the first real sale ($447.99 → $388.33) to the cent, but real fees vary (promoted listings, store tiers, category rates, international). Track the ACTUAL fee per sold card: best source is eBay Finances API (getTransactions, needs sell.finances scope added to USER_SCOPES and every seller re-consenting) pulled by the daily sync; fallback is a fee field on the mark-sold flow the seller can type from their payout email. Store per-card (new columns: sold_fees REAL, sold_net REAL), show net on the collection Earned tile (already leads with the estimate) and per-card in the sold panel; admin stats switch from estimate to sum of actuals where present.
- [x] S — eBay `program/opt_in` 403: scope added, Chris reconnected 09-01. Self-verifies on his next publish (opt-in retries per publish).
- → §0 (Claude's queue): Bulk drafts CSV (`toEbayDraftsCsv`, `src/lib/listing.ts`) never uploaded to real eBay
- → §0 (live-test batch): condition-descriptor 183454 ids FIXED 09-01 (`ebayInventory.ts`, tests updated); non-NM + graded 27503 verify on next push
- [x] S — Publish 20403 "not eligible": createDefaultPolicies (08-27, ebaySell.ts) now auto-creates policies + location at publish; with the 09-01 reconnect the whole chain should clear. Confirm on Chris's next real publish.
- [x] S — Keldeo listing 5230387616323 — Chris deleted it on eBay 09-01 (doubles as the ended-listing-sync live test: My Cards should show the amber "Ended on eBay" chip after the next sync pass)
- [x] S — `/terms` governing law — Maryland (Chris, 09-01)
- [x] S — Hardware pass done 09-01 (Chris, on his iPhone vs prod: "phone stuff seems fine" — auto-scan, torch, chime/haptics, ✕, MTG via vision, HEIC library photo)
- [x] S — Favicon vs header logo — DONE 09-01 same day (Chris: "way better, perfect"): transparent bg + tight viewBox crop so the mark fills the frame; verified legible at 16px via canvas-downscale sim; apple-icon keeps the solid square.
- [x] `/admin` overhauled 08-16 (Chris: "go crazy"): own operator login (`/admin/login`, `ADMIN_PANEL_USER`/`ADMIN_PANEL_PASSWORD`, defaults admin/onyx per Chris — override on Fly), signed 12 h cookie, rate-limited; console = KPIs, 30-day activity bars (scans/sign-ups/price checks/sold), searchable+sortable users w/ rollups + delete, recent cards, prices & data (series counts, daily-job status + Run now, mirrors, storage), system (integrations configured, process). `test:admin` 16 checks

## 2. Deferred features (mostly by choice or blocked on eBay)

- → §0 (third parties) L — eBay Listing API (`sell.item.draft`) access — apply at developer.ebay.com/my/support (blocked). **Confirmed 08-27 by probing each scope separately against `auth.ebay.com`: this keyset holds the other four and rejects only this one.** It was failing the *entire* authorize call with `invalid_scope`, so no seller could link an account at all — not merely lose drafts. Now opt-in behind `EBAY_DRAFT_SCOPE=1` (`ebayAuth.ts`), and `createDraft` reports unavailable up front. When eBay approves the keyset: set that env var, redeploy, nothing else to write. The inventory/offer publish road never needed it.
- [x] ~~Marketplace Insights~~ — DENIED by eBay 08-16 (partner-only, ticket closed). Sold-comps call now gated off (`EBAY_INSIGHTS_ENABLED`); sold data = price-history route instead (see §7)
- [x] S — SMTP secrets (`SMTP_HOST/PORT/USER/PASS`) — set on Vercel (Fastmail app password). **EXERCISED 09-01**: first real send ever — password reset to christophis@msn.com (Chris's test account) delivered and the reset link worked. Fastmail/DNS chain proven against MSN's strict filtering. Welcome email still untested (fires only on a real Stripe subscribe).
- [x] M — **Branded sending address `support@cardflip.io`** — DONE 08-31: Fastmail domain added (catch-all -> Chris's inbox, verified green), Dynadot got 2 MX + SPF TXT + 3 DKIM CNAMEs (all confirmed on public DNS; website records untouched), inbound tested from Gmail, `MAIL_FROM=CardFlip <support@cardflip.io>` on Vercel. Original notes: Reset emails currently come from his personal `chris@superiormarketing.com`. No code work needed — `mail.ts` already honours `MAIL_FROM` and falls back to `SMTP_USER`; it is entirely a domain-email setup job. Blocker: **`cardflip.io` has no mail DNS at all** — verified 08-27, no MX, no SPF, no DKIM. Flipping `MAIL_FROM` alone would get the send refused by Fastmail or land resets in spam (nothing authorises the domain, and DKIM would still sign as superiormarketing.com). Order when picked up: (1) Fastmail → Settings → Domains → add `cardflip.io`, which prints the record list; (2) Dynadot → add its MX + SPF TXT + three `fm1/2/3._domainkey` CNAMEs — these are independent of the A/CNAME records so the website is not at risk; (3) Fastmail → alias `support@cardflip.io` (gives a real inbox, so replies don't bounce); (4) Vercel → `MAIL_FROM = CardFlip <support@cardflip.io>`, leaving `SMTP_USER`/`SMTP_PASS` as the Fastmail login; (5) redeploy and send a real reset to confirm SPF/DKIM pass. Steps 1–3 need Chris's Fastmail/Dynadot logins — Claude has neither and proving domain ownership inherently requires DNS access.
- [x] S — Rotate PRD Cert ID — done 08-27 (it had been set as `EBAY_CLIENT_ID` and was therefore leaking in public redirect URLs; old key in 30-day grace). Deletion-endpoint verification token also replaced the same day.
- [x] S — "Scanning" chip pulses + spinner spins under reduced motion (.chip-working exemption, 08-17)
- [x] S — MTG wishlist re-pricing — rows now carry `game` + `card_id` (08-16 late); rows saved before then default to Pokémon
- → §0 (backburner): Root SPF record superiormarketing.com (optional)
- → §0 (pre-launch blockers) S — **Stripe shows Chris's HOME address** on customer receipts/emails (re-surfaced 09-01 — was never written down, got lost). Fix: Stripe dashboard → Settings → Business details → replace with a non-home address. PRE-LAUNCH BLOCKER per the 09-01 Stripe session (STATE "WAITING ON CHRIS" — recovered 09-01 after falling out of the compiled lists). PO boxes REJECTED by Stripe (verified). Chris picks: UPS Store mailbox (easiest), iPostal1-style virtual address (~$10-15/mo), or MD LLC registered agent (LLC worth a pre-launch think). Deadline: before the first real subscriber.
- → §0 (pre-launch blockers) S — Stripe polish (from same session, also recovered): branding logo/color; verify Settings→Emails "Successful payments" toggle; OPTIONAL live-key rotation (sk_live passed through chat 09-01 — dashboard roll + rerun scripts/flip-stripe-live.mjs after updating .env.local).
- → §0 (backburner): RevealStrike leave as is; RevealScene don't rebuild without asking.
- → §0 (backburner) — help/tour (Chris 09-01, "totally want to add those one day"): (a) /help FAQ section (S per batch — publish failures/quota/graded pricing/ended listings; error states deep-link to articles; do FIRST, deflects support email), then (b) first-login overlay tour (M — coach-marks anchored to real elements, driver.js or hand-rolled, tour_seen_at flag + account-page replay).

## 3. Product-readiness

- [x] M — **Rate limiting** — done 08-16, `lib/server/rateLimit.ts`, 26 tests on `/api/vision/scan` (paid Anthropic), `/api/ebay/comps`, `/api/search-card` — demo login can drain credit. Highest-value unbuilt item.
- [x] M — Error monitoring SHIPPED 09-01: self-hosted error_events table + instrumentation onRequestError + admin console Errors section (error-only, /privacy stays true); first real prod error is the live test
- [x] M — **eBay order sync** — done 08-25 (`8992c54`, deploy pending): `ebayOrders.ts` + `/api/ebay/sync-sales` + daily-job sweep; auto-marks sold from real orders; needs seller reconnect for the new fulfillment scope
- [x] S — **Editable listing title/description** — done 08-25: overrides on the queue item, all 3 posting roads, reset link
- [x] S — **Demo seeding + pricing trust** — done 08-25: demo login seeds 6 real cards; lookup dedupe; Cardmarket outlier guards (fetch + display)
- [x] M — ~~Multi-photo~~ VETOED by Chris 09-01 ("we dont need the back of the card"); quantity >1 SHIPPED 09-01 (Copies input, qty-aware sales sync)
- [x] M — Auto-offers to watchers (manual v1) + reprice nudge — both SHIPPED 09-01 (ebayNegotiation.ts / price_series nudge)
- [x] S — Graded cert lookup — PSA SHIPPED 09-01 (lib/server/psa.ts + /api/psa/cert, Verify field in CardEditor when Graded-by-PSA; PSA_API_TOKEN on Vercel prod+preview; 10/min/user + 80/day global vs the 100/day free tier; BLOCKED: PSA answers 403 to prod calls (tested w/ valid cert 28400235, UA headers, token present — not a 500-invalid-creds). RESOLVED-ish 09-01 eve: swagger test = 429 "quota exceeded, 100/day" → TOKEN IS VALID, day quota burned (resets ~6am ET 09-02). Retest prod then: 200 = done; 403 while browser 200s = Cloudflare blocks Vercel IPs → email collectors-apis@collectors.com. Do NOT burn quota retrying). Emailed collectors-apis@collectors.com 09-01 (Chris, from support@cardflip.io): limit raise to 1-2k/day + asked if Vercel/AWS IPs are 403d at their edge + why quota burned on ~6 calls — watch for reply. CGC: Chris checked 09-01 — their API is tough to get, BACKBURNERED by his call (PSA-only is fine for v1)
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

- [x] M — Auth tests — DONE 09-01: `test:auth` (password/sessions/reset libs) + `test:authroutes` (login/signup/forgot/reset handlers as plain functions)
- → §0 (Claude's queue): API-route tests for account/admin/eBay routes (needs cookies() harness, lower value)
- [x] M — Ledger/wishlist/price-check server tests — DONE 09-01, `npm run test:cards` (37 checks: fee math incl. actual-beats-estimate, ownership, partial-sale split, stats blend, wishlist dedupe/alerts, price-check dedupe/backfill)
- → §0 (Claude's queue): tests for `enCards.ts` ranking, `db.ts` ALTER-probe migrations, `seedMtgMirror` completeness (the code that broke prod)
- [x] S — Zero-catch routes — sets/card-image/demo wrapped 08-16; logout/me/connect are trivial, left: `api/auth/demo`, `auth/logout`, `auth/me`, `card-image/[id]`, `ebay/connect`, `sets`
- [x] S — `npm test` aggregate — done 08-16 script running all 6 suites
- → §0 (Claude's queue, someday): component/E2E tests (Playwright)

## 5. Ops / deploy

- [x] L — **124 uncommitted files — committed 08-16 as 3d728a9 + follow-ups, last commit e10482c (Aug 11)** — commit now; no rollback point for 5 days of work
- [x] M — CI gate SHIPPED 09-01 (.github/workflows/ci.yml: next typegen + tsc + lint + all 13 suites on every push/PR, verified GREEN on both branches; repo is public so run status readable w/o gh auth). Deploy itself still manual-by-design (push to main)
- → §0 (Claude's queue): MTG mirror refresh manual from Chris's PC (`sync:mtg && export:mtg && deploy`, Scryfall 429s cloud IPs); Pokémon set sync also manual
- [x] ~~Single 512 MB machine, scale-to-zero, DB on one volume~~ OBSOLETE — Fly retired 08-27; Vercel serverless + Turso now, nightly local backup covers the DB

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
- → §0 (backburner): PriceCharting API if deeper history wanted later
