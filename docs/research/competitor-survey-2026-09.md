# CardFlip's rivals split into scanners, trackers, and sellers

**Methodology caveat (read first):** Reddit (r/PokemonTCG, r/pkmntcgcollections, r/mtgfinance, r/Flipping) was **blocked** throughout this research — WebFetch could not reach reddit.com/old.reddit.com/web.archive.org, and `site:reddit.com` search queries returned Wikipedia and e-commerce pages instead of thread content, across roughly a dozen independent attempts by different researchers. Every "user sentiment" claim below therefore comes from Apple App Store / Google Play reviews, review aggregators (JustUseApp, Cards AI, DelightfulTCG), vendor forums, and eBay's own community forum — a reasonable proxy for the same collector base, but not a Reddit thread. Treat it as the best available evidence rather than a gap to keep re-flagging.

**Data-quality notes on the assigned list:** "Card Dealer Pro" is a B2B dealer SaaS (flatbed/auto-feed scanner hardware, bulk cross-listing) acquired by CollX in 2022 — not a consumer scanning app, and not on any app store. "MTG Assistant" isn't a real competitor: the name only matches two tiny, likely-abandoned Android life-counter apps (~13K installs, last updated 2022). "Kingpin" could not be identified as any real card-listing tool — only an unrelated B2B AI sales platform and an eBay seller storefront share the name. TCGplayer Pro is seller-side inventory/repricing software (Quicklist, MassPrice), not a collector price tracker, and its actual current fee could not be pinned down (official copy says "no monthly payment"; aggregators cite conflicting commissions). Manapool is an MTG marketplace with a public seller API and a community "Grade Yard," not a portfolio tracker.

## 1. Feature and pricing snapshot

| App | Price | Standout features |
|---|---|---|
| **Collectr / Collectr Pro** | Free; Pro $4.99/mo annual ($59.99/yr) or $7.99/mo | 25+ TCGs + Funko in one portfolio "charted like a stock"; free tier already has unlimited scanning/portfolios; 4.8★/100K+ Play reviews; PSA-only grading, no confirmed eBay listing |
| **TCGplayer app** | Free (scan/track); Marketplace 10.75% commission, Pro tier 9.25%+2.5% | Scans against TCGplayer's own live sale data (Mid/Low/Direct Low/Market); free "Trade-In" to game stores; Seller Portal upload gated to Level 4 sellers only |
| **eBay Scan to List / Magical Listing** | Free, standard 13.25% final value fee (2.35–6.6% above $1,000) | Scan pre-fills listing from eBay's own catalog; free Price Guide pulls 2-yr sold comps + PSA/CGC pop + Card Ladder Index; no collection/want-list layer at all |
| **CardCastle** | Free (Squire); Knight $9/mo or $90/yr | Oldest MTG-native scanner (since 2014); CardBot hardware + POS integrations (BinderPOS, Crystal Commerce); mobile deckbuilder called "clunky"; no want lists/alerts found |
| **Dex** | Free; Dex+ $3.99/mo | "Fill in the Pokédex" completion gamification + friend-based Trade Finder; 4.8★/14K ratings, highest-rated Pokémon app; paid scanner criticized as "awful" |
| **Ludex** | Free (capped); $4.99–$24.99/mo | Only app with a built-in scan-to-eBay-listing pipeline; 28K reviews (largest base surveyed); Pokémon variant database "missing so much" |
| **Pokellector** | Free + ads; ~$4.99–$19.99 IAPs | Signature set-completion % checklist, English + Japanese; 1M+ downloads (largest install base); pricing "lags behind marketplace reality" |
| **PokeData** | Free; GOLD $8/mo; PLATINUM $20/mo | Multi-market, multi-grader (Raw/PSA/CGC) pricing + sealed-product comps + true portfolio P/L across 4 TCGs; 4.8★ but "bare minimum paywalled" |
| **Delver Lens** | Free; paid tier price unconfirmed | Fastest Android MTG scanner, no white-background requirement; exports to Moxfield/Archidekt rather than managing a collection itself |
| **ManaBox** | Free; PRO $2.49/mo or $22.99/yr | Broadest MTG price-source coverage (4 markets) + fullest deckbuilder at the lowest price point; scanning "regressed" with recent updates |
| **PriceCharting** | Free; Collector $6/mo; Legendary $49/mo | Cheapest multi-category (games/comics/LEGO/coins + TCGs) price guide; grading-profitability star system + Centering Calculator; 4.8★/27K ratings |
| **Card Ladder** | Free; Pro $20/mo or $200/yr | ~20-yr sports-card sales archive, GemRate cross-company pop reports; scanner "fails 98% of the time" per one 2025 review; CSV import called "tedious" |
| **Market Movers** | Starter $9.99/mo; Premium $24.99/mo; Unlimited $49.99/mo | Real-time "Movements" gainers/losers + "Market Pulse" hobby index; eBay comp links sometimes point to the wrong item |
| **Alt (alt.xyz)** | Free to browse; 5–14% seller commission, $5 vault intake fee, optional $15/mo data add-on | Vault custody + insurance + 24/7 auction/fixed-price marketplace; AI scanner misidentifies Pokémon cards repeatedly; no free-add collection tracking |
| **Card Dealer Pro** (B2B, see caveat) | ~$9/$19/$59/mo (unconfirmed vs. 2022 figures) | Bulk hardware scanning + simultaneous cross-listing to eBay/Shopify/Whatnot/CollX; "99% recognition" claimed; no consumer collection features |
| **Manapool** | No subscription; 5% marketplace fee + 4.2% single-card fee | Public seller REST API + "Cart Optimizer" (cheapest multi-seller sourcing) + community "Grade Yard"; no portfolio tracking at all |
| **TCGplayer Pro** (seller tool, see caveat) | Unconfirmed — official copy says no monthly fee, aggregators disagree | Quicklist bulk AI scan-intake, MassPrice auto-repricing, storefront + kiosk; zero collector-facing features |
| **Whatnot** | No listing fee; 8% commission (0% above $1,500 in TCG categories) | Live-auction singles sales generated "millions/month" almost immediately; $3B GMV in 2024; not a scan/track app |
| **HipStamp / bulk-listing tools** (Vendoo, List Perfectly, Crosslist, TCG Automate) | $9.99–$249/mo (general cross-listers); TCG Automate scales by scan volume | Cross-post to 10+ marketplaces with auto-delist; only TCG Automate/CardUploader/SpeedyCardLister do actual card-image ID, not general cross-listers |

## 2. The 20 most-valued features across the category

1. **Camera scan-to-identify** — table stakes everywhere; accuracy is the actual differentiator (CardCastle, ManaBox, TCGplayer all criticized for reprint/foil misidentification).
2. **Live/real-time pricing on scan** — Collectr, PokeData, TCGplayer app all lead with instant valuation; users compare it to "checking a stock."
3. **Portfolio value tracking with gain/loss** — Collectr's free tier and PokeData/Market Movers/Card Ladder's paid tiers all center on "spend vs. current value."
4. **Set-completion % / checklist** — Pokellector's signature draw (1M+ downloads); Dex's "Fill in the Pokédex" is the same idea gamified.
5. **Price alerts / watchlists** — PokeData (up to 20/unlimited), Market Movers (5/20/unlimited), PriceCharting (wishlist deal alerts) all gate this by tier — proof users pay for it.
6. **One-tap or scan-to-marketplace listing** — Ludex's scan-to-eBay pipeline and eBay's own Scan to List are the closest matches; TCGplayer's version is gated to Level 4 sellers only.
7. **Multi-game/multi-TCG breadth in one app** — Collectr (25+ TCGs + Funko) and PokeData (4 TCGs) beat single-game apps on this explicitly.
8. **Trade-matching / friend features** — Dex's "Trade Finder" (gated by friend count) is the clearest example; ManaBox has a similar "trade tool."
9. **CSV/data export** — praised repeatedly (CardCastle Google Play reviewer: it let him "log everything, sort it, and export it as a spreadsheet") and just as often paywalled (Collectr Pro, Dex+).
10. **Grading-company pop-report integration** — Card Ladder's GemRate partnership and PriceCharting's proprietary pop reports are named strengths; most apps have none.
11. **Multi-grader pricing (Raw/PSA/CGC/BGS)** — PokeData's headline differentiator; Collectr's PSA-only support is a top user complaint by contrast.
12. **Sealed-product scanning/valuation** — PokeData does it; a dedicated standalone app (Sealed Market) exists specifically because mainstream apps don't.
13. **Deck-building tools** — ManaBox's mana-curve/simulator toolset is the most complete; CardCastle's mobile deckbuilder is explicitly called "clunky."
14. **Public/shareable collection or portfolio pages** — PokeData ships this free; Collectr allows public/private portfolios; most competitors have nothing.
15. **Dark mode / widgets** — Dex is the one app confirmed to have both (widgets paywalled); largely unconfirmed elsewhere, suggesting low prioritization industry-wide.
16. **Offline scanning/search** — ManaBox and Delver Lens both market offline card search as a selling point for at-the-table use.
17. **Grading/centering estimate from a photo** — no mainstream tracker has it; an entire sub-category of standalone apps (Center Grade, Grade My Card) exists to fill the gap.
18. **Trend/"movers" market intelligence** — Market Movers' namesake feature and PriceCharting's "Big Movers" are the two clearest implementations.
19. **Bulk/hardware scanning for high-volume sellers** — Card Dealer Pro's flatbed/auto-feed workflow and TCGplayer Pro's Quicklist serve this dealer-side need, distinct from collector apps.
20. **Live/community grading estimate** — Manapool's "Grade Yard" (crowd-sourced, not AI) shows demand even in a lightweight, non-algorithmic form.

## 3. What sellers say is still missing (2025–2026)

- **Reliable scanning outside perfect conditions.** The single most repeated complaint across every app (Dex, TCGplayer, ManaBox, Card Ladder, Collectr): scanners fail on foil/reflective cards, non-white backgrounds, foreign-language prints, and reprinted artwork across multiple sets. Card Ladder's scanner reportedly "fails 98% of the time" to identify the correct parallel in one 2025 review.
- **No app does true one-tap cross-listing.** Even eBay's own Scan to List still requires the seller to take separate photos and manually verify pricing/details — "sellers are responsible for the details on the listing even if eBay helped fill out the form." This is the clearest open lane for CardFlip's core pitch.
- **Grading breadth stops at PSA.** Collectr users repeatedly ask for BGS/CGC support ("needs to have more grading companies included. PSA is only ones listed"), and Collectr's own PSA pricing feature is reported as non-functional.
- **Bulk/duplicate quantity tracking is clunky.** Pokellector can only mark one copy "obtained" per card; Collectr requires repeated "+1" taps instead of a quantity field.
- **Free-to-paid scanner bait-and-switch breeds resentment.** Dex's scanning feature was reportedly moved behind a paywall after launching free — "the one thing Dex had going for it above manually writing it all down" — a sharper backlash than apps that charged from day one.
- **Japanese/foreign-language card support is a recurring named gap** in both Dex and Collectr.
- **Sealed product (booster boxes, ETBs) is barely tracked** anywhere except PokeData; a standalone app (Sealed Market) exists purely to fill this hole.
- **No app offers real tax/cost-basis reporting.** Searched explicitly across PriceCharting, Card Ladder, Market Movers, Collectr, and Manapool — none has a realized-gains or Form-8949-style export.
- **Print-run/pull-rate data for sealed product** is absent industry-wide, with no tool found offering it.
- **CSV import (not just export) is rare**, and collection-import UX is called out as "unnecessarily tedious" even on paid tools like Card Ladder.
