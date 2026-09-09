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
- [ ] [Chris] Yea/nay still open on the live site: sold-row look (needs a real sale), category manager, admin toggle.

## Chris — needs you

- [ ] [Chris] eBay live-test batch next time you post: non-NM push, graded push, reprice PUT on a drifted listing, one watcher offer, multi-qty partial sale, net estimate→actual, watchlist dip email.
- [ ] [Chris] MTG stress test — say when; ~1h pre-flight on Claude's side first.
- [ ] [Chris] MD LLC decision (also solves the Stripe address).
- [ ] [Chris] iPostal1 business name: Mailbox Settings → Change Plan → Virtual Business Address (from $14.99/mo); do it with the LLC (ticket #3081502).
- [ ] [Chris] Stripe public details errand (v1.0.0 tag waits on this + your own paid signup working).
- [ ] [Chris] Watch Turso Analytics rows-read for a week after the 09-06 index fix.

## Claude — my queue (in order)

- [ ] [Claude] Homepage demo frame: static 2x image of the Inventory with one card per stage, EXAMPLE ribbon on the art, one-line caption + Try 10 scans free. Mockup approved 09-08; build after lockdown.
- [ ] [Claude] External heartbeat pinger (cron-job.org or a scheduled task) so the prod smoke runs every 15 min, not best-effort.
- [ ] [Claude] Card art durable fallback: store image_url_alt per catalog row (pokemontcg.io twin) so server-rendered art (OG image) survives a tcgdex outage. Only if outages keep coming.
- [ ] [Claude] MTG Art Series USD prices (multi-hour TCGCSV→Scryfall product map from Chris's PC) — only if asked.

## Prove on prod — built, not yet seen live

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

## Backburner — low priority / technical

- [ ] [Claude] Own eBay price series; PriceCharting; CGC cert (blocked); photo-first sealed re-add.
- [ ] [Claude] Queue/CSV pricing-snapshot drift vs chart rebase — only if noticed.
- [ ] [Claude] Off-site backup copy (S3/Drive) on top of the nightly Turso dump.
- [ ] [Claude] Infra tiers: Vercel (Pro) / Turso plan at 10k+ users.
- [ ] [Chris] MTG mirror + Pokémon set sync stay manual from Chris's PC (Scryfall 429s cloud IPs).
- [ ] [Claude] Dead "demo" copy stays until the demo@cardflip.dev row is deleted from prod.
- [ ] [Claude] Old yea/nay leftovers from 09-04/06 (landing hero on phones, Watchlist By-set, trial Subscribe-now placements) — all shipped; close when Chris confirms.

## Done this week — so nothing looks lost

- [x] 09-08 Category management (add / rename / merge / delete) · admin toggle in the user drawer · sold cards are the record · fee floor is a hard rule · scanned → now in the card detail · Inventory Text row + price column makeover · Live / End Auction / Not Listed slots · watchlist tile makeover · watchlist rows from Inventory get a price · second art source (pokemontcg.io) · e2e tour flake fixed · scan counter in the header · tier decides plan cards (not admin role) · landing CTA becomes Open the App when signed in.
- [x] 09-07 Live Inventory prices · Inventory row makeover for phones · two-row phone header · stage sweep loops under reduced motion · tcgdex heartbeat probe.
