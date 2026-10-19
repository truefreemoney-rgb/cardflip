# Price source test, 2026-10-19

Chris: eBay is out as a price base ("ebay prices are always going to be higher and wrong because they bake in the ebay fees and shipping"). TCGplayer market is #1 (he uses the TCGplayer app and finds its prices "usually really good"). This test asks which backups belong behind it and in what order. Everything measured on the SAME Magic printings against TCGplayer market (local mirror data/cardflip.db, synced 10-19 06:18 UTC; ECB rate 10-16, $1.1253 per euro).

Ratio = source price / TCGplayer market. "Within ±25%" = share of cards whose ratio lands between 0.75 and 1.25.

| Source | What it is | Cards | Typical ratio, $5-20 | $20-100 | $100+ | Within ±25% ($5-100) |
|---|---|---|---|---|---|---|
| Cardmarket (converted) | Europe's marketplace, real sales trend | 81,464 | 0.89 | 0.87 | 1.00 | 55-68% |
| Card Kingdom retail | US shop, sets its own prices, official public list | 138,436 | 1.24 | 1.22 | 1.32 | 42-51% |
| Card Kingdom buylist | what the shop pays you | 51,483 | 0.60 | 0.63 | 0.71 | 24% |
| CardTrader cheapest NM listing | EU marketplace, thin for US-priced cards | 3,872 pairs, 8 sets | 1.22 | 1.66 | 1.56 | 25-48% |

Under $5 every source is noise (16-43% within ±25%); it does not matter to anyone at that price.

Not measurable / not independent:
- PriceCharting: built from eBay sold (same fee + postage cushion). Not measured, needs the paid plan.
- pokemontcg.io, YGOPRODeck, Scryfall, TCGdex, tcgapi, JustTCG, TCG Price Lookup: relay TCGplayer's own number (already our backups for an OUTAGE, not a second opinion).
- Troll and Toad, CoolStuffInc: no feed, scrapers only.

## Verdict (order for the quote and for filling cards TCGplayer does not price)

1. TCGplayer market (today).
2. Our own TCGplayer series, 30-day median: same source, smooths a bad day, a cap break, a spike.
3. Cardmarket converted to USD and lifted 12%: the closest independent read, usually a little low.
4. Card Kingdom retail divided by 1.24 (Magic only): consistent shop markup, a sane second opinion.
5. CardTrader: last resort only (cards nothing else lists); too thin to rank above the others.
6. Unsure: the seller types it.

eBay sold / asking: never a base. Stays as the "vs N listings" comparison and the referee for catching a WRONG catalog number.

Scripts: scripts/_ct-vs-tcg-measure.mjs (CardTrader, live, read-only), scratch cm-vs-tcg.mjs and ck-vs-tcg.mjs (local mirror; Card Kingdom list = https://api.cardkingdom.com/api/pricelist, 47 MB, public). Data: data/ct-vs-tcg-measure.json.
