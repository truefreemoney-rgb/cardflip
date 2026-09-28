# Feature ideas — pick list (09-27-2026)

Chris asked for a menu of user-facing additions to make the subscription worth
more. Built from a code inventory of what CardFlip does today plus a survey of
18 competitor apps (docs/research/competitor-survey-2026-09.md). Effort is a
gut call: S = a day, M = a few days, L = a week or more. Nothing here is
started. Chris picks rows; each picked row becomes a board task.

Ground rules kept: manual eBay listing is never an option, pricing stays in
src/lib/pricing.ts, USD only, graded slabs stay locked until PSA pricing is
paid for, CSV export was removed on purpose (listed below as a question).

## Tier 1 — nobody in the market has these, and we already hold the data

| # | Idea | What the user gets | Effort |
|---|------|--------------------|--------|
| 1 | **Profit & loss per card + tax report** | A cost field on each card (what you paid), then sold price − eBay fees − cost = real profit. Collection page shows total profit, per-year P&L, and a downloadable year-end report for taxes. Not one competitor does this. | M |
| 2 | **Centering check from the scan photo** | After a scan: left/right and top/bottom centering percentages drawn on the card image, with a "PSA 10 needs 55/45 or better" verdict. A whole sub-category of standalone apps exists just for this. We already have the photo. | M |
| 3 | **Condition suggestion from the photo** | Vision looks at corners, edges and surface and suggests Near Mint / Lightly Played with a one-line reason; user confirms or overrides. Fewer returns, faster listing. | M |
| 4 | **Binder-page scanning (9 cards in one photo)** | Photograph a binder page or a spread on the table, get every card identified and queued. Turns one scan into nine. Biggest quota-value jump possible. | L |
| 5 | **"Worth grading?" verdict** | Raw price vs graded price spread for the card, with the grading fee subtracted: "PSA 10 sells for $310, raw $85, grading $25 → grade it if centering passes". Needs graded price data (PriceCharting or PSA), so gated on that spend. | M+data |

## Tier 2 — the features users pay other apps for

| # | Idea | What the user gets | Effort |
|---|------|--------------------|--------|
| 6 | **Set completion** | Per set: "you own 142 of 198 (72%)", the missing list, and what filling the gaps costs today. Pokellector's whole draw (1M downloads). Also a "cheapest 10 to finish" list. | M |
| 7 | **Price alerts on cards you own** | Today alerts are wishlist-only. Add "tell me when this hits $X" on any owned card, plus "sell now" nudges when a held card spikes. | S |
| 8 | **Weekly collection digest email** | Sunday email: collection value and change, your top 5 gainers and losers, what sold, what's been listed 30+ days. Brings people back without opening the app. | S |
| 9 | **Push notifications on the phone** | iPhone home-screen PWAs support web push now. Dip alerts, "your card sold", offer accepted, reply on a ticket, all as phone banners instead of email only. | M |
| 10 | **Public collection / binder page** | SHIPPED 09-27: cardflip.io/u/<handle> — Account → Profile → Public collection page (claim an address, Make Public / Make Private, Copy Link). Server-rendered grid of every unsold card at today's price, dearest first, Buy on eBay on live listings, OG title/description/image for shares, one CardFlip line at the bottom. Private by default; unknown and private handles both 404. lib/handle.ts rules + reserved words; lib/server/publicCollection.ts read-only. | M |
| 11 | ~~**Quantity on a card**~~ | DECLINED by Chris 09-27 (and 09-03): cards sell individually only, never a multi-quantity listing. Duplicates stay separate rows. Do not propose again. | — |
| 12 | **Import from other apps** | SHIPPED 09-27: /app/collection/import — any CSV with a name column (Collectr / TCGplayer / TCG Collector header names all recognised, TCGplayer Id exact), matched through the scanner's ranker with the file's set name as a filter, priced by condition at today's market, one row per copy, 500 per import, review list with doubts before anything is written. Pokémon, English, singles only. | M |
| 13 | **Sealed product price feed** | SHIPPED 09-27: booster boxes, ETBs, tins, packs, blisters, bundles priced from TCGplayer daily (lib/server/sealedPrices.ts; displays/cases dropped, Pokémon Center variants listed but out of the median). Came with the photo-first sealed add the 09-01 cleanup removed (Add a sealed product → photo of the box → set + kind). Only PokeData did this. | M |

## Tier 3 — selling power (Pro plan material)

| # | Idea | What the user gets | Effort |
|---|------|--------------------|--------|
| 14 | **Repricing rules** | "Drop 5% every 14 days unsold, never below floor", "match market weekly". Runs nightly, user turns it on per card or for all. Was a dealer-tier idea; works as a Pro perk. | M |
| 15 | **Scheduled listing + auto-relist** | Queue drafts to go live Sunday 7pm ET (eBay's best hour); ended-unsold listings relist themselves once. | S |
| 16 | **Listing polish** | Best Offer auto-accept/decline thresholds, promoted listing toggle, listing title A/B (two title styles, we track which sells). | M |
| 17 | **Collection insights tab** | Your collection's movers this week, value by set, value by game, "your most valuable 10", what percent is listed vs sitting. Stock-portfolio feel, which is how Collectr sells itself. | M |

## Tier 4 — switches already built, just off

| # | Idea | What the user gets | Effort |
|---|------|--------------------|--------|
| 18 | **Japanese Pokémon cards** | Identification is built and disabled. Named gap in Dex and Collectr reviews. Needs a price source check before flipping on. | S+check |
| 19 | **Lorcana / One Piece** | Scaffolded behind admin switches; catalog and pricing pipeline need a status check. Collectr wins on breadth (25 games). | L |
| 20 | **Public card pages for search traffic** | cardflip.io/cards/<set>/<number>: one page per card with live price and history, "scan yours" button. Thousands of pages Google can index. Growth, not a user feature, but it feeds everything above. | M |

## Questions for Chris

- CSV export was removed on your call. Competitors get praised for it and paywall it. Bring it back as a Pro perk, or keep it out?
- Tier 1 #5 and Tier 4 #18 need paid data. Say if either is worth the spend.

## My pick order if it were mine

1, 6, 8, 7, 11 first (a week of work, all Standard-plan value, no new data spend). Then 2 and 3 (scanner showpiece gets stronger). Then 14 and 15 for Pro. Then 10 and 20 for growth.
