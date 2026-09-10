# CardFlip Board

The one organised list. Ask "list categories" and this is what gets read.
Every task is one line; detail and history live in BACKLOG.md. Rules:
a task lives in exactly one category; moving is fine, losing is not.
The LIVE board is edited in the admin console (settings table, key "board").
This file is the SEED — parsed once when nothing is stored yet — and a reference
copy; GET /api/admin/board?format=md exports the live one in this dialect.

Owner tags: **[Chris]** needs Chris · **[Claude]** Claude can do it alone · **[both]** needs a decision then code.

## Now — current main tasks

- [x] [Chris] Lock down Pokémon + the website: fresh scan batch on the phone 09-10 — "nothing looks off".
- [ ] [Chris] Soft launch IN PROGRESS — first invite sent 09-10. Ledger: docs/COHORT.md (Chris: who/where per invite; Claude fills the numbers weekly). Week 1 target: 10 invites; follow-up message on day 3.
- [ ] [Chris] Yea/nay still open on the live site: Pikachu stage card + "Your turn to scan", the board's run panel / Merge button / Live–Completed tabs / ↳ Reply; plus sold-row look (needs a real sale), category manager, admin toggle. (Watchlist summary strip: yea 09-09. /admin/system: fine for now, 09-09.)

## Chris — needs you

- [ ] [Chris] eBay live-test batch next time you post: non-NM push, graded push, reprice PUT on a drifted listing, one watcher offer, multi-qty partial sale, net estimate→actual, watchlist dip email.
- [ ] [Chris] MD LLC decision (also solves the Stripe address).
- [ ] [Chris] iPostal1 business name: Mailbox Settings → Change Plan → Virtual Business Address (from $14.99/mo); do it with the LLC (ticket #3081502).
- [ ] [Chris] Stripe public details errand (v1.0.0 tag waits on this + your own paid signup working).
- [ ] [Chris] Log in to /admin once in the Browser pane each session (panel password is yours to type; I never enter passwords, no override exists) — then I can drive and verify every admin page from that tab.

## Claude — my queue (in order)

- [ ] [Claude] Homepage demo frame: static 2x image of the Inventory with one card per stage, EXAMPLE ribbon on the art, one-line caption + Try 10 scans free. Mockup approved 09-08; build after lockdown.
- [ ] [Claude] RUNNER UPGRADE 1 — brain files: docs/RUNNER.md distilled from STATE.md + my memory rules (mobile-first, tight spacing, build for everyone, no auto-scan, one obvious action per screen) + the recent Completed list; the routine prompt reads it first. ~1h.
- [ ] [Claude] RUNNER UPGRADE 2 — prove visuals: before/after phone-size Playwright screenshots committed to the branch and shown in the PR body, so Chris yea/nays from the board without deploying. ~1 day.
- [ ] [Claude] RUNNER UPGRADE 3 — check the merged result: runner rebases onto main right before opening the PR; the board's Merge button refuses until CI is green on that rebased head (a green PR still broke main after merge, 09-09). ~1 day.
- [ ] [Claude] RUNNER UPGRADE 7 — the runner cannot see Chris's photos (its cloud box blocks the Vercel Blob host; run #19 read the task from the text alone). Fix: the Run button copies each photo into the repo on a board-assets branch; the runner fetches that branch and reads the file. ~1h.
- [ ] [Claude] RUNNER UPGRADE 6 — self-review step before the PR: re-read the issue + the diff and answer "does this do what was asked, on a phone, in the site's style". Prompt change. ~30 min.

## Prove on prod — built, not yet seen live

- [ ] [both] 09-09 hard pass on prod: eBay account-deletion webhook now verifies eBay's signature (needs the real key fetch to succeed once — check Vercel logs after the next eBay test notification); Stripe webhook now pins the subscription id (first real subscribe/cancel proves it); DB-backed login rate limit (rate_limits table created on first request).
- [ ] [both] Sold-row treatment (SOLD marker, no delete/relist) — needs a real sale.
- [ ] [both] Help chat's Haiku call on prod (dev has no key; verified by a one-off script).
- [ ] [both] Trial selling gate (402 on draft/publish) on prod.
- [ ] [both] Admin plan overrides + Add account on prod.
- [ ] [both] Tour once-only stamp on prod.
- [ ] [both] Verify-match gate on a live phone scan; vision printing/finish accuracy on real phone photos.
- [ ] [both] Welcome email on a real subscribe; wishlist dip email; Finances call after a real sale; ended-listing sync; live-offer PUT; multi-qty order.
- [ ] [both] Camera controls / torch positions on a real device.

## Launch gates — must be true before v1.0.0

- [ ] [Chris] Chris's own paid signup works end to end (trial → wall → Stripe → webhook).
- [ ] [Chris] Stripe public details done.
- [ ] [Chris] Admin console opened once on prod to confirm the new tables initialised.
- [ ] [Chris] Soft-launch cohort measured (conversion / churn / scans) before any ad spend.

## Future ideas — parked, not forgotten

- [ ] [both] More games on THIS site via the game switch, slowly, admin-toggle first: Magic → Yu-Gi-Oh → sports cards. Sports needs a dealer design partner. Ranking + reasoning: BACKLOG §0.0 → NEXT VERTICALS.
- [ ] [both] Dealer tier ($49–$99/mo): volume scanning, cost basis + profit reports, multi-channel (eBay + TCGplayer), nightly auto-reprice rules, team logins.
- [ ] [both] Homepage redesign direction C "product-first" (the app is the hero, bento features). Mockups: 09-08, A editorial / B card shop / C product-first. C ranked first.
- [ ] [both] Alternative themes: Midnight Emerald, Ember, Ocean, Graphite — demoed 09-08, current theme kept. Any of them is ~15 lines behind an admin switch.
- [ ] [both] Revenue shape after retention: free-tier funnel, GMV fee.
- [ ] [both] PSA at scale (paid tier email pending; or flag graded verify off at launch).
- [ ] [both] TCGplayer selling road; eBay Marketplace Insights re-apply post-POC.

## Technical — the complicated stuff; ask a friend before touching

- [ ] [Chris] ANDROID EMULATOR (paused 09-09, asking a friend): Android Studio is installed; the SDK + Pixel 7 Play image (3.5 GB) downloaded into a sandboxed AppData copy (AppData\Local\Packages\Claude_…\LocalCache\Local\Android\Sdk) and needs moving to AppData\Local\Android\Sdk; the emulator will NOT run until SVM Mode (CPU virtualization) is enabled in the BIOS (Ryzen: Advanced → CPU Configuration → SVM Mode). Then: avdmanager create Pixel7, boot, open cardflip.io in Chrome. Purpose: see real Android Chrome (address bar, keyboard, camera, PWA) from the desktop.
- [ ] [Chris] Mobile device strategy: iPhone = your phone (no iOS simulator on Windows); Android = the emulator above; more iPhone models = BrowserStack by the minute. CI already runs the phone e2e on Android Chrome + WebKit every push.
- [ ] [Chris] MTG stress test — say when; ~1h pre-flight on Claude's side first.
- [ ] [Chris] WAITING on Chris + his friend — STEWARDSHIP PHASES 1–3 (from the 09-05 brief; Phase 0 = docs/ARCHITECTURE.md done). DO NOT START without Chris saying "go" explicitly on this row — no inference from other tasks. (1) scanner queue loop → its own module (the 1,400-line scanner page); (2) numbered migrations run once from CI instead of schema in the request path; (3) background jobs off Vercel functions, only after a refresh first times out. Added 09-10.
- [ ] [Chris] Watch Turso Analytics rows-read for a week after the 09-06 index fix.
- [ ] [Claude] External heartbeat pinger (cron-job.org or a scheduled task) so the prod smoke runs every 15 min, not best-effort.
 WAITING on Chris — needs a cron-job.org account you create; say when.
- [ ] [Claude] Card art durable fallback: store image_url_alt per catalog row (pokemontcg.io twin) so server-rendered art (OG image) survives a tcgdex outage. Only if outages keep coming.
- [ ] [Claude] MTG Art Series USD prices (multi-hour TCGCSV→Scryfall product map from Chris's PC) — only if asked.
- [ ] [Claude] Own eBay price series; PriceCharting; CGC cert (blocked); photo-first sealed re-add.
- [ ] [Claude] Queue/CSV pricing-snapshot drift vs chart rebase — only if noticed.
- [ ] [Claude] Off-site backup copy (S3/Drive) on top of the nightly Turso dump.
- [ ] [Claude] Infra tiers: Vercel (Pro) / Turso plan at 10k+ users.
- [ ] [Chris] MTG mirror + Pokémon set sync stay manual from Chris's PC (Scryfall 429s cloud IPs).

## Backburner — low priority

- [ ] [Claude] Old yea/nay leftovers from 09-04/06 (landing hero on phones, Watchlist By-set, trial Subscribe-now placements) — all shipped; close when Chris confirms.

## Completed — finished work, newest first; the live board sweeps every done item here (Live/Completed tabs)

- [x] 09-10 App icon + favicon = the CF card mark (Chris's friend's PNG, public/brand/cardflip-icon.png): /icon.png rounded-corner favicon, /apple-icon.png 180 for iOS home screen, /icon-maskable.png padded for Android; the generated BrandIcon routes are gone. iOS shows the new icon on the next Add to Home Screen (it caches the old one).
- [x] 09-10 Recent lookups pass — Chris yea 09-10 ("look great and fast"). (Chris: stuck spinner, no stats under the cards, 5s open): a lookup tile opens the modal at once on what the row knows and fills prices in; the tile spinner ends when the card is on screen, not after the log write; the by-id lookup has the same 2.5s pricing budget as name search; past the budget (or when TCGplayer has nothing) the last held price from price_series stands in, on tiles, in the modal and in the stored lookup — no more "—" rows; sparklines under every lookup tile that knows its card; header controls wrap on a phone instead of pushing Clear all off the edge.
- [x] 09-10 RUNNER UPGRADE 4 (Chris yes): GET /api/runner/status — read-only, its own secret (RUNNER_TOKEN, Bearer, constant-time compare): deploy sha, daily job, last-24h errors grouped, scan spend, last prod smoke run. RUNNER.md + the routine prompt tell it to look there first. Vercel side DONE 09-10 (prod answers 401 bare / 200 with the key). Routine side DONE 09-10: Chris made the cloud environment `cardflip-runner` (env_01Thon9Abjp9qwqAbKtL4TMn) with RUNNER_TOKEN and the routine now runs on it. Proof = the next Run press: the runner's first comment should quote /api/runner/status.
- [x] 09-10 RUNNER UPGRADE 5: one run per press — new routine trig_019ZEFG5D6dSJMqiAmEWVQxc with a GitHub trigger on issues.opened only (my API can create but not edit webhooks, so: new routine, old one disabled + renamed). Verify on the next Run press.
- [x] 09-10 RUNNER UPGRADES 1, 2, 3, 6: docs/RUNNER.md (the brain file — who it builds for, the rules not in the code, how to read a task, the self-review); `npm run runner:shots` renders before/after phone screenshots the PR carries and the board shows under the task (images() in boardRuns, own-repo raw URLs only); the Merge button brings a behind branch up to date with main, then refuses until every check is green on that head; routine prompt rewritten around RUNNER.md with a rebase before the PR. Runner 5 waits on Chris (webhook click); runner 4 waits on a read-only token.
- [x] 09-10 Board saves can no longer wipe each other: every save carries the stamp it was loaded from; a stale copy is refused (409) and the page reloads the live board with a "redo that last edit" note; coming back to the tab pulls the live copy if nothing is unsaved. Cause: Chris's open page autosaved over a row Claude had just added (same class as the 09-09 seven-note wipe). test:boardsave pins it. Also fixed the /admin/data build break (DailyJobControl needed `now` after the runner's ops-page second pass).
- [x] 09-09 New logo on the site (Chris's CF card + CARDFLIP wordmark PNG, public/brand/cardflip-logo.png, 28px app header / 32px standalone pages); the old Spin Cycle mark + text are gone from Logo.tsx (favicon/app icon unchanged); marketing nav links no longer wrap beside the wider logo.
- [x] 09-09 Board replies carry photos (📎 in the reply box; a photo-only reply works); ↳ Reply sits under every runner output (reading / question / PR / merged) and ▶ Run again works after any finished run, sending the whole thread + photos; a visible 📎 on every row adds a photo after the fact, before you press Run.
- [x] 09-09 Board run chips are live: re-read every 20s while a run is moving (working / PR open / merged but not yet deployed), every 2 min otherwise, and whenever the tab comes back into view. Also fixed: a merged + live run now ticks itself (the self-complete regex had lost its \d).
- [x] 09-09 Inventory bulk delete is ONE request (DELETE /api/cards {ids}) — 88 parallel deletes lost every reply while the server had removed the rows ("88 of 88 couldn't be removed"); ended auctions are now included (they were skipped silently, the 5 left over); a failed delete refetches the ledger instead of restoring from memory. test:cards pins it.
- [x] 09-09 BOARD RUNNER LIVE: ▶ Run → GitHub issue (label board-run) → cloud routine "CardFlip board runner" (Sonnet 5, fires on issue opened/labeled + daily 6am ET) → PR "Closes #n", never merges, labels needs-chris with questions when unsure. Proven on issue #1 (runner asked questions; Chris scrapped the idea). Status chips on the board after Run (read from GitHub on each visit, not live): ▶ Running · ? Needs you · ✓ PR ready · ✓ Done · ✕ Closed, each linking to the PR or issue. Issue #2 (Gyarados full-art stage slot) → PR #3; duplicate PR #4 closed; routine now ignores the labeled event so one Run = one run.
- [x] 09-09 HARD PASS (3 audit agents + 4 fix agents + browser sweep on desktop/Android Chrome/iPhone WebKit): 36 code findings fixed — API validation (cards POST floor, PATCH coercion, wishlist/price-check bodies), eBay refresh failures → reconnect/502 not 500, trial gate on push, partial-sale transaction, comps id trust, signup name cap, Stripe timeout; N+1s batched (nudges, alerts, live prices), showcase + CJK searches use indexes, daily job survives Vercel limits; eBay deletion signature, Stripe sub-id pin, DB rate limiter, explicit child deletes on account delete, admin refuses default creds in prod; client: 5xx no longer bounces to login, tour anchors pick the visible copy, species regex fixed ("Not your card?" works), Android Back closes sheets, network failures show a banner not an empty state, paywall refresh unsticks, rewards no flash, landscape iPhone inputs 16px, help chips on old iOS, trial copy; scanner ✕ above the blocked-camera overlay.
- [x] 09-09 Reload from file keeps the Chris's thoughts notes (they were wiped before). Admin console is sub-pages (/admin, /switches, /board, /users, /cards, /data, /errors, /system) — Chris yea (09-09). Board is live in the admin console (DB-backed, editable) · e2e runs on Android Chrome (Pixel 7) AND WebKit/iPhone 13 every push.
- [x] 09-08 Category management (add / rename / merge / delete) · admin toggle in the user drawer · sold cards are the record · fee floor is a hard rule · scanned → now in the card detail · Inventory Text row + price column makeover · Live / End Auction / Not Listed slots · watchlist tile makeover · watchlist rows from Inventory get a price · second art source (pokemontcg.io) · e2e tour flake fixed · scan counter in the header · tier decides plan cards (not admin role) · landing CTA becomes Open the App when signed in.
- [x] 09-07 Live Inventory prices · Inventory row makeover for phones · two-row phone header · stage sweep loops under reduced motion · tcgdex heartbeat probe.
