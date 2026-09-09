# CardFlip Board

The one organised list. Ask "list categories" and this is what gets read.
Every task is one line; detail and history live in BACKLOG.md. Rules:
a task lives in exactly one category; moving is fine, losing is not.
The LIVE board is edited in the admin console (settings table, key "board").
This file is the SEED — parsed once when nothing is stored yet — and a reference
copy; GET /api/admin/board?format=md exports the live one in this dialect.

Owner tags: **[Chris]** needs Chris · **[Claude]** Claude can do it alone · **[both]** needs a decision then code.

## Now — current main tasks

- [ ] [Chris] Lock down Pokémon + the website: clear the inventory, scan a fresh batch on the phone, report what looks off.
- [ ] [Chris] First soft-launch invite — docs/SOFT-LAUNCH.md (20–30 hand-picked sellers over 3 weeks, green/red table).
- [ ] [Chris] Yea/nay still open on the live site: Watchlist summary strip makeover (from your photo, PR #12), Pikachu stage card + "Your turn to scan", the board's run panel / Merge button / Live–Completed tabs / ↳ Reply; plus sold-row look (needs a real sale), category manager, admin toggle.

## Chris — needs you

- [ ] [Chris] eBay live-test batch next time you post: non-NM push, graded push, reprice PUT on a drifted listing, one watcher offer, multi-qty partial sale, net estimate→actual, watchlist dip email.
- [ ] [Chris] MD LLC decision (also solves the Stripe address).
- [ ] [Chris] iPostal1 business name: Mailbox Settings → Change Plan → Virtual Business Address (from $14.99/mo); do it with the LLC (ticket #3081502).
- [ ] [Chris] Stripe public details errand (v1.0.0 tag waits on this + your own paid signup working).
- [ ] [Chris] Log in to /admin once in the Browser pane each session (panel password is yours to type; I never enter passwords, no override exists) — then I can drive and verify every admin page from that tab.

## Claude — my queue (in order)

- [ ] [Claude] Homepage demo frame: static 2x image of the Inventory with one card per stage, EXAMPLE ribbon on the art, one-line caption + Try 10 scans free. Mockup approved 09-08; build after lockdown.

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

- [x] 09-09 BOARD RUNNER LIVE: ▶ Run → GitHub issue (label board-run) → cloud routine "CardFlip board runner" (Sonnet 5, fires on issue opened/labeled + daily 6am ET) → PR "Closes #n", never merges, labels needs-chris with questions when unsure. Proven on issue #1 (runner asked questions; Chris scrapped the idea). Status chips on the board after Run (read from GitHub on each visit, not live): ▶ Running · ? Needs you · ✓ PR ready · ✓ Done · ✕ Closed, each linking to the PR or issue. Issue #2 (Gyarados full-art stage slot) → PR #3; duplicate PR #4 closed; routine now ignores the labeled event so one Run = one run.
- [x] 09-09 HARD PASS (3 audit agents + 4 fix agents + browser sweep on desktop/Android Chrome/iPhone WebKit): 36 code findings fixed — API validation (cards POST floor, PATCH coercion, wishlist/price-check bodies), eBay refresh failures → reconnect/502 not 500, trial gate on push, partial-sale transaction, comps id trust, signup name cap, Stripe timeout; N+1s batched (nudges, alerts, live prices), showcase + CJK searches use indexes, daily job survives Vercel limits; eBay deletion signature, Stripe sub-id pin, DB rate limiter, explicit child deletes on account delete, admin refuses default creds in prod; client: 5xx no longer bounces to login, tour anchors pick the visible copy, species regex fixed ("Not your card?" works), Android Back closes sheets, network failures show a banner not an empty state, paywall refresh unsticks, rewards no flash, landscape iPhone inputs 16px, help chips on old iOS, trial copy; scanner ✕ above the blocked-camera overlay.
- [x] 09-09 Reload from file keeps the Chris's thoughts notes (they were wiped before). Admin console is sub-pages (/admin, /switches, /board, /users, /cards, /data, /errors, /system) — Chris yea (09-09). Board is live in the admin console (DB-backed, editable) · e2e runs on Android Chrome (Pixel 7) AND WebKit/iPhone 13 every push.
- [x] 09-08 Category management (add / rename / merge / delete) · admin toggle in the user drawer · sold cards are the record · fee floor is a hard rule · scanned → now in the card detail · Inventory Text row + price column makeover · Live / End Auction / Not Listed slots · watchlist tile makeover · watchlist rows from Inventory get a price · second art source (pokemontcg.io) · e2e tour flake fixed · scan counter in the header · tier decides plan cards (not admin role) · landing CTA becomes Open the App when signed in.
- [x] 09-07 Live Inventory prices · Inventory row makeover for phones · two-row phone header · stage sweep loops under reduced motion · tcgdex heartbeat probe.
