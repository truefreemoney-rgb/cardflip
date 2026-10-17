# Competitor review: PokeData (pokedata.io), 2026-10-17

Method: read-only browsing in the built-in browser, no sign-up or sign-in, about 22 page loads. Nothing copied. Terms page (/termsandconditions) renders EMPTY to a logged-out visitor, so reuse terms for the site itself could not be read.

## 1) What they are
- Pokemon-first price and collection tracker (Browse LLC). Cards + sealed product, English / Japanese / Chinese sets (about 183 set pages). Also lists 14 other TCGs under /tcgs (Yu-Gi-Oh, Magic, One Piece, Lorcana, Digimon, Flesh and Blood and others); the Lorcana page is only a set list, so depth outside Pokemon is unproven.
- Price sources, per card page: three columns "eBay | TCGPlayer | Card Market (EUR)" for Raw, plus PSA / CGC / BGS grade rows with an eBay price per grade. The meta description says "eBay, TCGplayer, raw, PSA, CGC, BGS".
- Shows individual eBay sales (date, price, grade, auction or not, eBay listing ID, seller, title). Logged-out visitors see about the 2 newest rows in full; every older row is blanked behind "Log In!" (the listing ID still shows). Fanatics Collect sales also appear.
- Freshness: Espeon showed a sale dated today (10-17). Eevee 1st Ed newest visible sale was 07-13, Lucario 07-10, Butterfree 06-06, Vivillon 07-20. Fresh on liquid cards, months old on thin ones.
- Money: Raptive ad partner (ads), eBay affiliate links, a new Marketplace (own seller fees and shipping policies in /help), and Pokedata PRO subscriptions.
- Plans (from /pro): Free (6 months price data, 1 portfolio, 1 list, current PSA pop, PSA+CGC pricing, scanning). GOLD $8/mo (all history, 4 portfolios/lists, PSA pop history, 20 price alerts, unlimited scanning). PLATINUM $20/mo (unlimited portfolios, custom charts, sales volume, personal API access).
- API: "Official Pokedata API", Postman docs, bearer token, Platinum only. The docs header says "Non-commercial use only, reach out to us for other use cases". So CardFlip (a commercial site/app) is NOT allowed to use the $20 API; a commercial deal would need a custom quote.
- robots.txt: fully open (Disallow empty), sitemap_index.xml.

## 2) Price-source verdict
Not usable as CardFlip's price source: personal-use-only API, no stated commercial license, and eBay sold data is theirs through a sanitiser we cannot audit. It is useful only as a cross-check by eye. Their eBay column tracks our eBay sold medians on 3 of 5 cards; it was weaker where variants are split or sales are thin.

| Card (raw) | PokeData eBay | PokeData TCGplayer | Our eBay sold 10-17 | eBay vs ours | Within 25%? |
|---|---|---|---|---|---|
| Espeon Undaunted 2/90 Reverse Holo | $21.80 | $72.49 | ~$26.03 | -16% | Yes (TCGplayer col. 2.8x off) |
| Vivillon XY 17/146 Reverse Holo | Pink $0.01 / Orange $1.99 | $2.56 / $10.70 | ~$3.99 | -100% / -50% | NO (split by color; Pink column is one $0.01 junk sale) |
| Lucario C Supreme Victors 31/147 | $11.92 | $26.43 | ~$15.99 | -25.5% | Borderline NO (just outside) |
| Eevee Neo Discovery 38/75 1st Ed | $38.06 | $11.30 | ~$30 | +27% | NO (just outside) |
| Butterfree Southern Islands 9 | $39.52 | $52.09 | ~$37.25 | +6% | Yes |

Notes: all 5 cards and the right variants exist (they split Vivillon into Pink and Orange Meadow patterns, and have a separate 1st Edition set). Only 2 of 5 land within 25%, and our numbers are the ones that match visible recent sales better: their Vivillon Pink $0.01 comes from one real $0.01 eBay sale (cheese_head_cards, 07-01) that was not filtered. Their TCGplayer column is a retail ask-type number and is unreliable for vintage reverse holos (Espeon $72 vs about $26 sold). Single-sale quality filtering is the gap: ours looks better here.

## 3) Ideas for CardFlip (own design, built our way)
| Idea | Where | Why | Effort | When |
|---|---|---|---|---|
| Show 2-3 recent sold sales per card (date, price, condition) with a link to the eBay listing (affiliate-able), full list for signed-in users | Card page under the price | trust + conversion + signup | M | LATER (needs sold-sale storage; check eBay terms first) |
| "Price from N sales, last sold DATE" line under every price | Card page + scan result | trust (answers "is this accurate") | S | NOW |
| Show variant split clearly (Reverse Holo vs Holo vs 1st Ed, pattern) as labelled chips with own price | Card page | trust; avoids blended price like Vivillon | M | LATER |
| Low-confidence flag when sales are thin or older than 90 days ("Last sale 3 months ago") | Card page, scan result | trust, honesty | S | NOW |
| Source breakdown row: "eBay sold $X" and a second reference number, labelled | Card page | trust, SEO text | S | LATER (PRICES rule: single source in pricing.ts) |
| Sets page: total set value + owned/total progress bar | /sets/[set] pages | retention, SEO (set value queries) | M | LATER |
| Price-history chart free for 6 months, longer history as the signup hook | Card page | retention, conversion | M | LATER |
| Price alerts ("tell me when above or below $X") as the free-account hook | Account | retention (email) | L | LATER |
| Sealed product pages (boxes, bundles) with price | New section | SEO volume | L | LATER |
| Portfolio / shareable collection link and "Showcase" page | Collection | virality, retention | M | LATER |
| Home hero: "Top movers this week" and newest set with real prices | Home | SEO freshness, trust | S | NOW (after crawl check) |
| Real H1 on card and set pages (they have none) with name, set, number | Card/set templates | SEO | S | NOW |
| Unique meta description per card using real numbers: "Espeon 2/90 Reverse Holo Undaunted: $26 sold median (N sales, Oct 2026)" | Card templates | SEO CTR | S | NOW |
| Card-page schema.org Product + Offer (AggregateOffer low/high) and BreadcrumbList | Card pages | SEO rich results | S | NOW |
| Soft-404 fix: unknown card URL should return real 404 (theirs returns an empty 200 shell) | Router | SEO hygiene | S | NOW (verify ours) |
| Per-game hub pages (/tcg/lorcana style) listing sets | Game pages | internal links, SEO | S | LATER (probably have) |
| Collection scan counts as free feature (they cap/gate scanning behind PRO) | Scanner | conversion | S | NOW (copy only) |

## 4) SEO patterns seen
- Titles: card "PokeDATA - Check current Pokemon card values for {Card Name} {Number}!"; set "PokeDATA - Up to date {Set} (Pokemon) card list!"; sets index "Browse all Pokemon sets!". Page title initially shows a template placeholder, then fills in via JS (client-rendered: bots may see "all supported cards").
- Meta descriptions: home "Current and Accurate Pokemon Card Values"; card "View up to date price history and statistics (eBay, TCGplayer, raw, PSA, CGC, BGS) for {Card}"; set "Pokemon card values (PSA CGC BGS graded and raw) from {Set}"; Lorcana hub just "Browse all Lorcana sets". No numbers in any description.
- Structured data: only a WebSite + SearchAction on the home page; NO ld+json on card, set or game pages. No FAQ, no Product/Offer schema.
- og tags are site-wide generic (og:title "Pokedata", og:url home) on card pages: weak social previews.
- No H1/H2 elements on a card page (confirmed by DOM check).
- URLs: /card/{Set}/{Card+Variant+Number}, /set/{Set}, /tcg/{game}, /product/{name}. Readable. Canonical correct per card.
- Internal links: home has set and card links, set pages list every card (about 270-340 links each); no "related cards" block seen.
- robots wide open; sitemap index present.

## 5) What they do worse than CardFlip
- Price on the page is one raw number per source with no sale count or confidence; one $0.01 junk sale becomes the headline for Vivillon Pink.
- TCGplayer column is far off for vintage/reverse holos (Espeon $72.49 vs about $26 sold).
- Free visitors see only about 2 sales rows and a blurred, signup-gated history chart; most of the value is paywalled.
- Everything meaningful needs an account; scanning is metered; API is non-commercial only.
- Pages are client-rendered with a placeholder title, no H1, no structured data, generic og tags, soft-404 shell for unknown cards.
- Terms page does not render without JS or login; no visible FAQ or methodology explaining how a price is computed.
- Pokemon-first: other games exist as set lists, depth unverified; no Magic/Lorcana price spot-check done here.
- No "what is my card worth right now from the camera" flow on the web (scan is behind signup/plan).
