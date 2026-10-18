# Automatic catch before posts: measured 10-18, NOT buildable on our data

Question (STATE step 3): can a post's cards be checked automatically, so a price well off eBay sold sits out?
Labelled set: the 18 post cards hand-checked against eBay SOLD (raw, no slabs) on 10-18. 4 wrong (Snorlax xy0-26
$64.88 vs $43, Brock's Ninetales gym2-3-1st $260.50 vs $200, Minun hgssp-HGSS17 $39.25 vs $23.33, Rare Candy bw10-105
$191.88 vs $122), 14 right. Cases: docs/research/post-cases-2026-10-18.json. Scripts: scripts/_asks-peek.mjs (prod
ebay_asks), scripts/_post-hist-measure.mjs (prod series), scripts/_post-ask-measure.mjs (Browse, needs eBay keys: none locally).

| signal | wrong cards | right cards | verdict |
|---|---|---|---|
| price / eBay ACTIVE ask median (nightly referee readings) | Rare Candy 0.96, Ninetales 1.47 | Palkia 1.56, Dialga 1.72, Tyranitar 1.62, Genesect 1.42, Exeggcute 1.39, Deoxys 2.5, Sabrina 2.5 (1 ask) | no: asks sit ABOVE sold for some cards (sellers ask $200 for a $122 Rare Candy) and far below for others (played/unlabelled copies) |
| biggest one-day jump, last 14 days | 2.13, 1.60, 3.02, 1.00 | Tyranitar 3.51, Mew 2.60, Deoxys 2.03, Jigglypuff 1.62, Sabrina 1.44 | no: movers posts ARE jumps |
| days the price has not moved | Rare Candy months | Exeggcute 66 | no |
| TCGplayer / Cardmarket | Snorlax 1.09 (others no Cardmarket) | 0.43-1.94 | no data, no spread |

Conclusion: the only evidence that caught the 4 was eBay SOLD prices, which the API does not give us (Marketplace
Insights denied, re-checked 10-17), and we never scrape eBay pages. An automatic rule here blocks right cards and
still misses Rare Candy. The working catch is the hand sold check before each post (4 of 18 caught on 10-18).
