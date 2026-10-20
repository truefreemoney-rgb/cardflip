# Price source test, 2026-10-19

Chris: eBay is out as a price base ("ebay prices are always going to be higher and wrong because they bake in the ebay fees and shipping"). TCGplayer market is #1 (he uses the TCGplayer app and finds its prices "usually really good"). This test asks which backups belong behind it and in what order. Everything measured on the SAME Magic printings against TCGplayer market (local mirror data/cardflip.db, synced 10-19 06:18 UTC; ECB rate 10-16, $1.1253 per euro).

Ratio = source price / TCGplayer market. "Within ±25%" = share of cards whose ratio lands between 0.75 and 1.25.

| Source | What it is | Cards | Typical ratio, $5-20 | $20-100 | $100+ | Within ±25% ($5-100) |
|---|---|---|---|---|---|---|
| Cardmarket (converted) | Europe's marketplace, real sales trend | 81,464 | 0.89 | 0.87 | 1.00 | 55-68% |
| Cardmarket, POKÉMON (trend, EUR converted) | same marketplace; English Pokémon sells much cheaper in Europe | 3,169 pairs (fresh: 3,033 updated Oct) | 0.59 | 0.56 | 0.44 | 24-25% |
| Card Kingdom retail | US shop, sets its own prices, official public list | 138,436 | 1.24 | 1.22 | 1.32 | 42-51% |
| Card Kingdom buylist | what the shop pays you | 51,483 | 0.60 | 0.63 | 0.71 | 24% |
| CardTrader cheapest NM listing | EU marketplace, thin for US-priced cards | 3,872 pairs, 8 sets | 1.22 | 1.66 | 1.56 | 25-48% |

Pokémon is different from Magic: Cardmarket sits at roughly HALF of TCGplayer (lower on 78-85% of cards, wide spread, only a quarter within ±25%). A flat lift does not rescue it. For Pokémon it stays what it is today, the referee that catches a WRONG TCGplayer number (4x apart), and a last-resort fill behind our own 30-day median; it is not a Pokémon second opinion. The 1.12 lift is Magic only.

Under $5 every source is noise (16-43% within ±25%); it does not matter to anyone at that price.

Not measurable / not independent:
- PriceCharting: built from eBay sold (same fee + postage cushion). Not measured, needs the paid plan.
- pokemontcg.io, YGOPRODeck, Scryfall, TCGdex, tcgapi, JustTCG, TCG Price Lookup: relay TCGplayer's own number (already our backups for an OUTAGE, not a second opinion).
- Troll and Toad, CoolStuffInc: no feed, scrapers only.

## Verdict (order for the quote and for filling cards TCGplayer does not price)

1. TCGplayer market (today).
2. Our own TCGplayer series, 30-day median: same source, smooths a bad day, a cap break, a spike.
3. Cardmarket converted to USD and lifted 12% (Magic only): the closest independent read, usually a little low. Pokémon: Cardmarket drops to step 5 (half of TCGplayer, too scattered).
4. Card Kingdom retail divided by 1.24 (Magic only): consistent shop markup, a sane second opinion.
5. CardTrader: last resort only (cards nothing else lists); too thin to rank above the others.
6. Unsure: the seller types it.

eBay sold / asking: never a base. Stays as the "vs N listings" comparison and the referee for catching a WRONG catalog number.

Scripts: scripts/_ct-vs-tcg-measure.mjs (CardTrader, live, read-only), scripts/_cm-vs-tcg-measure.mjs (Magic), scripts/_cm-pokemon-measure.mjs (Pokémon; _ scripts stay untracked) and scratch ck-vs-tcg.mjs (local mirror; Card Kingdom list = https://api.cardkingdom.com/api/pricelist, 47 MB, public). Data: data/ct-vs-tcg-measure.json.

## The other games (measured 10-19 ~8:20pm ET, local mirror)

TCGplayer (tcgcsv) prices the whole catalog for the three small games, so there is almost nothing for a backup to fill:

| Game | Catalog cards | No TCGplayer price | No series at all |
|---|---|---|---|
| Yu-Gi-Oh! | 59,991 | 0 | 159 |
| One Piece | 5,549 | 0 | 214 |
| Lorcana | 3,505 | 0 | 29 |
| Pokémon | 22,200 | 112 (0.5%) | 65 |
| Magic (English) | 99,080 | 1,937 (2.0%) | 1,498 |

Independent second opinions for Yu-Gi-Oh!, One Piece, Lorcana: none worth ranking. Our stored CardTrader / Cardmarket rows for them are a few dozen fills for cards TCGplayer once missed (YGO 89 + 38 pairs, Lorcana 17 + 52, One Piece 0) and they agree with TCGplayer on fewer than 1 card in 5. Card Kingdom is Magic only. So those games get the short chain.

## Chain per game

- Magic: TCGplayer > own 30-day TCGplayer median > Cardmarket x1.12 > Card Kingdom retail /1.24 > CardTrader > unsure.
- Pokémon, Yu-Gi-Oh!, One Piece, Lorcana: TCGplayer > own 30-day TCGplayer median > CardTrader or Cardmarket (last resort, today's fills, unchanged) > unsure.
- Every game: eBay sold never a base; hand-checked prices (checkedPrices) keep winning as today.

Scripts: scripts/_other-games-measure.mjs, scripts/_unpriced-by-game.mjs (read-only, untracked).

## Built 10-19 ~9:20pm ET (Chris: "yes build it")

- src/lib/priceChain.ts: the order, CARDMARKET_LIFT { mtg: 1.12 }, CARD_KINGDOM_DIVISOR 1.24, BACKUP_ORDER per game, backupRank/backupSourceLabel, recentMedian (30 days, 5+ points).
- Nightly Magic fill (mtgPriceRefresh.ts) now runs TCGplayer > Cardmarket lifted > Card Kingdom (new, src/lib/server/cardkingdom.ts: public list, retail / 1.24, out-of-stock $100+ placeholders skipped, 15x oracle guard) > CardTrader last. Dry run on the local mirror: Card Kingdom fills 51 of 1,256 blank released printings (Cardmarket already covers the rest).
- Card pages rank stored backups by the chain per game (Magic: Cardmarket > Card Kingdom > CardTrader; others: CardTrader > Cardmarket) and label "Card Kingdom (adjusted)"; the Magic euro path (card page + scan, withEurMarket) is lifted 12%; Pokémon untouched.
- Flagged-card fallback (priceTrustSite fallbackOf): before-jump / Cardmarket reference > OWN 30-DAY MEDIAN (when >10% away from the flagged number) > eBay ask > cheapest listing > sibling.
- Quote (listing.ts pickPrice, 9bb74143): TCGplayer > eBay sold (only flagged / 45+ days flat / missing) > eBay ask > the rest.
- Tests: scripts/test-price-chain.mjs (26 checks), test-mtg-prices, test-mtg, test-pricing, test-sitetrust, test-cardpages, test-pricetrust, test-mtgfill, test-tcgprices, test-pkcardmarket all green; tsc + eslint clean. Not pushed (Chris: commits only today).
