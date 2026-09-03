# Backlog (checklists)

Written 2026-08-16 from a full project audit; ticks = done that evening. Excludes payment/subscription
billing (Chris: not yet). Sizes S/M/L. "(deferred)" = Chris chose to park it.
Tick items here; move finished narrative to HISTORY.md, not STATE.md.

## 0. CURRENT TRACK (consolidated 09-02 — full sweep of BACKLOG + STATE's WAITING-ON-CHRIS/NEXT-WORK/parked items; THIS section is the one list, sections below are detail/archive)

### Pre-launch blockers (Chris decisions)
- [x] **Stripe payouts bank account** — ADDED 09-02 by Chris (found via red banner same day; USD row now has a payout destination). Note: a Treasury "Financial account" (fa_65VK7n2Sn…) exists on the account — harmless, unused; payouts go to the real bank.
- [ ] **Stripe business address + phone** — home address AND personal cell are customer-facing (seen 09-02 eve on Business details → Public details: support address + support phone). PO boxes REJECTED by Stripe. Pick: UPS Store mailbox (easiest), iPostal1-style virtual (~$10-15/mo), or MD LLC registered agent (LLC itself worth a pre-launch think). Also swap the phone (Google Voice-style number). Goes in Public details → Customer-facing information. Deadline: before first real subscriber.
- [x] **Price point** — DECIDED 09-02 (Chris): KEEP $9.99/500, "may change later". No code/Stripe edits needed. If changed post-launch: MONTHLY_SCANS + "500 scans" in 5 copy spots (grep) + Stripe price object; existing subs grandfather unless migrated.
- [x] Stripe polish — DONE 09-02 eve: branding logo/color + "CardFlip" name (earlier same day); "Successful payments" + "Refunds" customer emails toggled ON (were both OFF); support email → support@cardflip.io in Public details DONE 09-02 eve; same visit fixed "Card Flip"→"CardFlip" in BOTH Business information and Public details (the earlier fix was Branding-only — the customer-facing name field was still wrong) + statement descriptor. sk_live ROTATED 09-02 eve (old ...91a5 expired; new key in both STRIPE_SECRET_KEY and STRIPE_LIVE_SECRET_KEY — NOTE flip script reads the LIVE_ name — pushed to Vercel prod via flip-stripe-live.mjs; live after next deploy). Turso tokens also chat-exposed — Chris accepted that risk 08-31.

### Live-test batch (Chris's next posting/sale — passive, no code)
- [x] Publish a listing — DONE 09-02: Simisage 090/86 live at $8.99 through CardFlip (truefreemoney eBay acct) — whole post-reconnect chain clean. View-on-eBay upgraded to a real button same session (Chris feedback)
- [ ] Push a non-NM card → expect NO "saved without condition detail" (183454 descriptor fix); a GRADED push also verifies cert descriptor 27503
- [x] Ended-listing sync — VERIFIED LIVE 09-02: Chris ended the Simisage listing, amber "Ended on eBay" chip appeared in My Cards after the sync pass (10-min throttle respected)
- [~] Reprice — HALF verified 09-02: nudge appeared correctly on live data (↓ $11.03 vs $14.99 ask, 26% drift; chip restyled same session). The eBay PUT itself still unverified — Chris ended the listing pre-tap; parks until a real listing drifts (7-day age gate restored)
- [ ] Watcher offers: one real send once a listing has watchers
- [ ] Multi-qty sale: partial purchase → sold-row split + decrement
- [ ] After a real sale: net flips estimate→actual within ~a day, matches payout email, tooltip "(actual)"
- [ ] Wishlist alert email confirms itself on first real dip
- [x] Phone: auto-scan retested 09-01 — holos + close-up both fire (Chris: "it works"); idle pill now hints "fill the frame, not too close"
- [x] Cancel test sub — DONE 09-02: Stripe portal verified (branded, invoice history; NOTE business name reads "Card Flip" w/ space — fix in branding polish), cancel-at-period-end set (service to Oct 2; sub_status flips + webhook cancel path self-verifies then), $9.99 refunded ("Requested by customer"). NEW FIND: Stripe has NO BANK ACCOUNT for payouts — red banner in dashboard — promoted to pre-launch blockers

### Waiting on third parties
- [x] PSA prod retest — CONFIRMED 09-02 (~10am ET): Chris tapped Verify (cert 26573583, real session, fresh quota window) → PSA answered 403. Vercel IPs blocked at PSA's edge, diagnosis AIRTIGHT, do not retest. UI degrades fine (manual grade + help link). ONLY path forward: collectors-apis reply (Chris emailed 09-01 from support@cardflip.io, reply lands in Fastmail) — or a non-datacenter egress proxy if they never answer. CORROBORATION (Chris found, 09-02): r/psagrading thread ~2025 ("Is there an easy way to find a card's SpecID?") — commenter Elevate_ with a BRAND-NEW account hit the same "quota exceeded 100/day" after ~3 Swagger calls, retry-after present. With our garbage-token 429: PSA's free-tier quota looks pooled/per-IP at their edge and has been broken ≥1yr. Free tier is unreliable by design — the paid/raised tier ask in the email is the real fix. Same-day findings: PSA 429s "quota exceeded" even on a garbage token (scripts/psa-quota-check.mjs) so a 429 proves nothing about our token; quota reset ~6am UTC not ET; local .env.vercel.local TURSO creds stale ("group not found") — db counters only readable via prod.
- [ ] ~~eBay draft-scope keyset application~~ NEVER FILED — discovered 09-02 eve (only 2 tickets exist on developer.ebay.com: Negotiation 260901-000003 + Insights 260816-000004 closed/denied). Chris's call: DROPPED for now — bulk-CSV road covers drafts; re-file only if single-click drafts become a real user ask (code stays behind EBAY_DRAFT_SCOPE=1)
- [x] eBay Negotiation ticket 260901-000003 — RESOLVED 09-02 eve: their reply just confirmed sell.inventory covers both Negotiation calls (already knew; feature live). Chris posted a closing thanks. eBay ticket queue now empty of open asks.

### Claude's code queue (rough order)
- [ ] Tests: ~~enCards ranking + db ALTER probes~~ DONE 09-02 (`test:mirror`, 16 checks: every COLUMN_PROBES column verified present — probes swallow errors, a typo would be invisible; ranking ladder pinned incl. misread-set-total behavior). seedMtgMirror completeness DONE 09-02 next-day session (7 checks in `test:mirror`, now 24: fresh copy incl. sets/history/tcg map, marker no-op, fresh-but-incomplete prod replaced (the 08-16 bug pinned), merge keeps prod points + fills gaps, full+newer mirror kept). Remaining: API-route tests (cookies() harness, lower value), Playwright someday
- [x] Bulk drafts CSV validated against a real eBay Seller Hub upload — DONE 09-02: 3-row test file (plain single / quotes+commas title / sealed NEW qty 3) generated through toEbayDraftsCsv, uploaded at Seller Hub → Reports → Uploads on christophis01 (NOTE: that's the real+only eBay account; docs said "truefreemoney" = his email, not the username). All 3 landed as drafts with titles, prices, quantities intact; escaping survived the importer; drafts deleted after. eBay side note: account has NO payout method (banner) — Chris PARKED 09-02 ("not worried about selling cards myself", test rig only); only matters if a live-test ever needs a real completed sale/payout
- [x] Watcher offers v2 — DONE 09-02 (Chris approved auto-fire design in chat): (1) auto-fire on slow movers — opt-in checkbox in the offers panel (users.auto_offer_percent/message), daily-job sweepAutoOffers sends the set % to watchers of listings 14+ days old, never offered, eBay-eligible; 10/day/seller cap, off by default; (2) eligible-list pagination to 1000 (5×200 pages); (3) custom message on manual + auto sends (offers route POST message + PATCH settings). tsc/auth/cards/mirror green. LIVE-VERIFIES when a real listing ages 14d with watchers. NOTE: auto-mode classifier blocked auto-send edits until Chris allowed Edit(cardflip/**) in settings.local.json
- [x] Automate catalog syncs — DONE 09-02 late: scripts/push-catalog.mjs (7 catalog tables local→Turso, INSERT OR REPLACE, skips in-step tables, never price_series/user tables) + scripts/catalog-sync.cmd + Task Scheduler "CardFlip catalog sync" Sundays 10:30 AM (logs backups/catalog-sync.log). First run verified live 09-02: sync:en 21,066 cards; MTG + push observed
- [x] Graded-chart polish r2 — DONE 09-02 late (9b28f1d): neighbor-grade prefetch after each lookup (cache-warm, 60/min limit), skeleton tiles during first fetch. Axis already re-derives per tween frame
- [x] Graded price history accumulation — DONE 09-02 late (7dbec86): comps route records graded averages as price_series points (variant graded-psa-10, source ebay); chart prefers the recorded series over the estimate the moment it exists (chip "PSA 10 (recorded)")
- [ ] Anthropic credits auto-reload — CHRIS 1-min errand: console.anthropic.com → Billing → enable auto-reload (ran dry once 09-01; optional)
- [ ] **Missing catalogue art — hammer the list** (Chris 09-03). `npm run fill:images --prod` filled 102 of 661 (TCGplayer CDN via tcgplayer_products + pokemontcg.io set map); 559 left in `docs/missing-images.csv`. Worth doing by hand (~130): MEP Black Star Promos 29, McDonald's 2017/2018/2023/2024 (53 — no provider has art), My First Battle 34, Yellow A Alternate 6, Celebrations Classic 6 (ptcgio numbers are `4_A` style — needs a map). The ~430 trainer-kit cards are near-worthless bulk — skip. Route: drop `public/cards/<cardId>.jpg`, rerun the script.
- [ ] **Remove "Mark sold" from Live rows** (Chris 09-03: "I don't want the user having that control" — eBay order sync + daily job flip sold automatically). Leave for now; when pulled, keep only the bulk-select "Mark sold (n)" as the off-eBay escape hatch, and think about the no-orders-scope / not-connected sellers.
- [ ] Known drift to watch: queue rows/CSV quote the pricing snapshot, not the chart's current-day rebase — flag if Chris notices

### PRE-SCALE TRACK (added 09-02 night — Chris is a professional advertiser; plan = POC month of real sales FIRST ("i need to see at least one month of sales"), then if numbers hold, aggressive paid acquisition. Items 1 + address are POC-relevant; the rest gate on the POC verdict. Order = what breaks first at 5-25k users)
- [x] **1. Scan model margin** — DONE 09-02: A/B on 64 prod photos = identical identification, Sonnet 2.5x cheaper ($0.011 vs $0.028/scan); vision.ts switched (63c1f8e), on origin/main + deployed 09-02 am. MEASURED 09-02 night: Chris's 73-card real-phone stress test = $0.52 on the Anthropic console ($6.25→$5.73) = $0.0071/scan. 500-scan worst case $3.56 vs $9.40 net of Stripe = 62% margin at max usage; ~100 scans typical = 92%. The earlier "$3.50 for 82 scans" was the A/B run ($2.52) + ~$0.90 of scans. scan_usage ledger + admin tiles now measure it continuously.
- [ ] **2. PSA at scale** — 100/day dies in an hour at volume. Need the paid/raised tier (email pending) or feature-flag graded verify off at launch
- [ ] **3. Replace the shared demo account** — one communal wiped-per-visit account cannot serve thousands of simultaneous visitors; becomes per-visitor sandbox or a real free tier (free tier also = the CollX-proven funnel; ~10¢/user/mo at Sonnet prices)
- [x] **4. Durable rate limits** — DONE 09-02 (6eed61f, deployed): dayBudget.ts db counters on vision scans (500/day/user, 60/day demo) + PSA route ported to the shared helper; per-minute burst caps stay in-memory by design. Monthly 500 quota was already durable.
- [ ] **5. eBay app-level call limits** — one keyset serves all sellers; apply for eBay rate-limit increase BEFORE launch (application takes time)
- [~] **6. Support surface** — /help FAQ SHIPPED 09-02 (f49e10d: 13 articles w/ stable anchor ids for deep-linking, footer link; facts verified against code; same commit refreshed stale privacy/terms — Stripe live, Vercel/Turso, eBay present-tense). Error-state deep-links SHIPPED 09-02 (9b80008: quota banner, reprice toast, PSA error, offers panel) + Help section on the account page (270a752). Remaining: move support@cardflip.io out of personal Fastmail triage; onboarding tour (also on backburner)
- [ ] **7. Infra tiers** — Vercel/Turso plan review + connection behavior at 10k+ users
- [ ] **8. MD LLC** — $250k/mo through a sole proprietorship = liability/tax problem; LLC also solves the Stripe address blocker in one move
- [ ] **9. Soft-launch cohort FIRST** — few hundred users, 2 weeks: measure conversion, churn, real scans/user before ad spend (sets the CAC ceiling; ads amplify what exists)
- [ ] 10. Revenue shape for the $250k/mo path (from 09-02 analysis): dealer tier $49.99 (bulk tools), free tier funnel, eventual success-fee on GMV — sequence after retention proves out

### BACKBURNER (Chris's explicit parks)
- [ ] TCGplayer selling road — Chris "thinking about it" 09-02. Scoped: their API is CLOSED to new devs (docs still say so 08-2026; docs-portal login ≠ access), so v1 = CSV export in their Staged Inventory format next to the eBay drafts button (Seller Portal → Import to Staged → Move to Live), per-stack marketplace choice. tcgplayer_products map already covers 21,116/21,186 Pokémon cards; MTG ids come free via Scryfall's tcgplayer_id in sync-mtg. Unblock = Chris confirms a TCGplayer seller account + drops an Export-From-Live CSV (header row = ground truth, like the Seller Hub validation). API application = post-POC long-shot email.
- [ ] First-login overlay tour (M, coach marks + tour_seen_at) — "totally want to add those one day". Its /help FAQ prerequisite SHIPPED 09-02 (13 articles + error-state deep-links + account-page section, all deployed)
- [ ] Own eBay price series: record asking avg in comps route + ~150/day sweep; chart prefers ebay source once points exist
- [ ] Photo-first sealed re-add in the scanner — "sometime later"
- [ ] Merge Search cards into Watchlist — post-launch maybe, only if real users get confused
- [ ] CGC cert lookup — their API is tough to get (Chris checked 09-01)
- [x] Listed-for price shown on sold rows — DONE 09-02 (un-parked by Chris): sold rows show "listed $X" under net/sold when it differs; the ask survives the sale so it was UI-only
- [ ] Off-site backup copy (S3/Drive) on top of the nightly local Turso dump
- [ ] PriceCharting API if deeper history wanted. (Root-SPF note for superiormarketing.com REMOVED 09-02 by Chris — that domain only ever sent CardFlip mail pre-08-31; all sending is support@cardflip.io with its own SPF/DKIM now, so it is personal-domain hygiene, not a CardFlip item)
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
- → §0 (backburner): ~~Root SPF record superiormarketing.com~~ removed 09-02 — obsolete once sending moved to cardflip.io
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
