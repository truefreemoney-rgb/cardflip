# Competitor review: pokemonwizard.com (2026-10-17)

Method: 16 pages loaded in the built-in browser (home, search, sets, 2 set pages, card, Top 100, Stats, Products list + product, Articles list + article, News, Pokemon list + Espeon), plus robots.txt, sitemap index, and CardFlip's card/set/sitemap pages for comparison. No text/data/images copied; ideas only.

## 1. What they are
- Pokemon-ONLY price tracker: 41,753 cards, 316 sets (EN + JP), 1,025 species, 3,017 sealed products. Prices are TCGplayer market prices (every Buy button is a TCGplayer affiliate link via Impact, "subId" tracking per placement).
- Monetization: TCGplayer affiliate + display ads (ADVERTISEMENT slots on every page) + free accounts (favorites, portfolio, price alerts). No scanner, no selling tools, no eBay.
- Content engine: 26 AI-flavored "set guides / chase card" articles, a 3,188-item news aggregator (Pokemon Blog, PokeBeach, YouTube creators), per-set "Investment Guide" with letter grade S-F.
- Next.js style site, server-rendered metadata, hourly-refresh claim, sitemap split by type (default, sets, pokemon, articles, products, cards/1..N).

## 2. Ideas for CardFlip (idea | where | why | effort | tag)
1. Set "market pulse" strip: 7d / 30d / all-time / YTD % change, avg card price, high/low card, cards priced | top of set page | SEO + trust (numbers in meta description) | S-M (we already store daily history) | NOW
2. Add FAQPage + Product (with Offer/price) + ItemList JSON-LD to card and set pages (we only emit BreadcrumbList) | card + set pages | SEO rich results, answer-engine snippets | S | NOW
3. Visible FAQ block on card pages, 4 Qs built from our own facts ("How much is X worth?", "Is it worth selling?", "Which set?", "Other printings?") matching the schema | card page | SEO + trust | S | NOW
4. Meta-description pattern with live number + date ("Market price $15.99 ... range $10-$162") | card/set titles | CTR; ours already has price+date, add range + trend | S | NOW
5. Set title pattern with a verdict hook ("Card Prices 2026: Grade A & Worth It?") | set pages | CTR on question-style queries; build our own plain label (e.g. "Buy / Hold / Overpriced") from price trend, not an AI blurb | S-M | LATER
6. Species / character pages (/pokemon/espeon: all cards, total value, avg, top 10, evolution line, prev/next Pokedex link, price history) | new route per game character (Pokemon first) | SEO long tail ("espeon card prices" is a huge query class), strong internal linking | L | LATER
7. "Gained X% since release" line on card page + "All time" tab on price chart (ours: 153 days only; add sanity cap, theirs shows absurd +8380%) | card page | trust + retention | S | NOW
8. Chart range toggle 7D/30D/90D/All | card + set price history | UX parity, they have it on every page type | S | NOW
9. Top movers / "trending up/down this week" tables for sets and cards (global per game) | new /stats or /cards/pokemon/trending | SEO + return visits; data already in daily history | M | LATER
10. Market index headline ("Total market value $698K, 7d +2.0%, 30d +7.5%") on home + /stats | home | trust, press-friendly number | M | LATER
11. Set ranking by Average Card Value ("best sets to open / avoid") | sets list sort + page | SEO + useful for pack openers; pure math on our data | S | NOW
12. Sets list filters: region, series, sort (newest, price, ACV) | /cards/pokemon | UX | S-M | NOW
13. Top 100 page with rarity filter and "Top Sets / Top Pokemon" toggle | new /top | SEO + shareable | M | LATER
14. Sealed products (booster box, ETB) price pages tied to their set, "Sealed products" block on set page | set page | big commercial intent; needs new data source | L | LATER
15. Per-card "More <name> cards" and "Products featuring <name>" rails (we have other printings, good) plus "More from set" with next/prev numbers | card page | internal linking | S | NOW
16. Breadcrumbs visible (Set > Series > Card) with series level added | all pages | SEO + nav | S | NOW
17. Favorites / price-alert hook ("Favorite" button on every card, "get price alerts, free") | card page, tied to our accounts + email | retention; ties to scanned collection | M | LATER
18. Prev/next navigation by Pokedex number on species pages | species page | crawl depth | S | LATER
19. Quick-search at top with grouped results (Pokemon match card + 83 cards + 11 sealed counts) | search | UX | S | NOW if our search lacks grouping
20. Data-freshness stamp ("Data last refreshed Oct 17, 2026; prices refresh hourly") on index pages | stats/set pages | trust | S | NOW

## 3. SEO patterns worth matching
- Titles: `<Name> Card Prices 2026: Grade A & Worth It?` (sets), `<Card> Price 2026 | <Set>` (cards), `<Name> Card Prices & Value 2026 | 77 Cards Ranked` (species). Year + "Price/Prices/Value" + a count or verdict. Ours: "Terapagos ex 170/142 Stellar Crown price" (no year, no number).
- Descriptions carry real numbers: card count, price floor/ceiling, all-time %, grade, "Updated hourly". Ours has price + "Checked daily"; add range and % change.
- Schema per page type: card = Product + BreadcrumbList + FAQPage; set = Product + BreadcrumbList + ItemList + FAQPage; species = Thing + Breadcrumb + ItemList + FAQPage; article = Article + Breadcrumb + ItemList; stats = Breadcrumb + FAQPage; home = WebSite + Organization. List pages (sets, top, products, news) have none. CardFlip: BreadcrumbList only. Biggest gap.
- FAQ blocks (4 questions) on every money page, answers are number-filled sentences, mirrored in FAQPage JSON-LD.
- Internal links: card -> set, species, 10 sibling printings, up to 8 sealed products, 10 same-set cards; set -> top 10 cards, 4 sealed, articles, all cards; home -> trending sets, top species, top cards, articles; species -> prev/next Pokedex. Roughly 40-260 links per page.
- Sitemaps: index with default/sets/pokemon/articles/products/cards-N (50k-style splits). Ours is per game per chunk (12 files, ~9.9k cards in pokemon-1, 1,534 pages file) which is fine; consider a species file later.
- robots.txt minimal: Allow all, block /account, /api, auth pages, one Sitemap line.
- Hubs by region/series/grade/ACV are crawlable filter UIs, not separate URLs (so no thin-page problem); keep the same discipline.
- Canonical on card pages present; slugs are `/cards/<numericId>/<slug>` (ours is cleaner: `/cards/<game>/<set>/<name>--<number>`).

## 4. Things they do worse than CardFlip (keep these)
- Price honesty: they show "No price" on many sealed items, a booster box at $18,750 with a flat history dated 2026-08-19, and a booster pack at $382.43; "gained 8,380% since release" figures on Top 100. Our "a price that looks wrong is not shown" rule and daily-recorded history are a clear trust edge.
- Internal inconsistency: /stats "Top 5 cards" (Umbreon ex $1,240) disagrees with /top-cards (Mewtwo Star $9,200); the Southern Islands blurb says "30 cards" while the page says 18; article card numbers render duplicated ("101/084101/084"); card titles read "Espeon - 2/90 (HGSS Undaunted) 2/108" (doubled numbering).
- Generic AI filler: species and set "descriptions" and investment theses are boilerplate and sometimes wrong. We write short, factual lines tied to real data (rank in set, x of median, 90-day range).
- No selling help: no "what you keep after fees", no eBay suggested price, no condition ladder (NM/LP/MP/HP), no scanner. Our card page is more useful to a seller.
- No eBay-sold basis; TCGplayer only. Heavy ad load (several ADVERTISEMENT slots per page).
- One game only. We cover five games with one UX.
- Our card-page "Price your own copy" and "Have one? Scan it" CTA is a conversion path they cannot match; they push sign-up for a portfolio instead.

## Notes for follow-up
- CardFlip pages render text client-side after hydration (document.body.innerText was empty to the browser tool; textContent had it). Worth confirming the full text is in the server HTML for crawlers (view-source / curl) as part of the existing Search Console checks.
- No screenshots were needed (layout was not the point); one low-res CardFlip set-page screenshot showed dark placeholder tiles until images load.
