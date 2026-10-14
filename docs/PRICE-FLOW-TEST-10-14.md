# Price flow test (10-14, 10 cards from /admin/prices Hand check)

Chris's order: eBay US sold (raw) > TCGplayer > PriceCharting > eBay UK/CA/AU > unsure.
eBay = sold, last ~90 days, slabs out (-psa -bgs -cgc -sgc -graded -slab, plus TAG/Beckett/PCG/ACE titles skipped by hand), no Japanese/proxy/plastic-art.
"eBay mid" = median of the clean raw sales. "PC" = PriceCharting Ungraded (public page).

| Card | Ours | eBay US sold raw | PC Ungraded | Flow answer | Verdict |
|---|---|---|---|---|---|
| Shining Celebi Neo Destiny 106 1st | $1,801 | $750-1,135, mid ~$834 (6) | $742 | ~$834 (eBay) | too high, 2.2x |
| Shining Charizard Neo Destiny 107 unl | $1,701 | $610-2,400, mid ~$1,841 (11, $7-15 fakes out) | - | ~$1,841 (eBay) | right |
| Merida Formidable Archer 242 (Lorcana) | $1,687 | $660-1,327, mid ~$899 (10; TAG 10 + "BECKET 9.5" titles slipped the minus-words) | $900 | ~$899 (eBay) | too high, 1.9x |
| Smothering Tithe Ench. Tales 87 foil | $1,760 | 1 sale $1,700 | - | thin: 1 sale agrees with TCGplayer | right (thin) |
| Houndoom Aquapolis H11 | $1,572 | $313-1,699, mid ~$616 (7, wide) | $715 | ~$616-715 | too high, 2.2x |
| Lugia Neo Genesis 9 1st | $1,300 | $350-9,650 (condition all over) | $1,695 | eBay unusable -> TCGplayer $1,300 / PC $1,695 | a bit low |
| Blastoise Base Set 2 1st | $1,300 | 1 English sale $672 (rest German/French) | $1,250 | eBay thin -> TCGplayer $1,300, PC agrees | right |
| Charizard Base Set 4 unl holo | $969 | $175-620, mostly MP/HP/DMG; LP $500-620 | (search page, no single result) | eBay = played copies -> TCGplayer $969 | unclear (NM vs played) |
| Rayquaza Deoxys 22 reverse holo | $1,193 | $210-880, mid ~$450 (9) | $321 | ~$450 (eBay) | too high, 2.6x |

Score: 4 too high, 3 right, 1 a bit low, 1 unclear.

Lessons:
1. PriceCharting Ungraded lands right on the eBay raw median every time we had both (Celebi $742 vs $834, Merida $900 vs $899, Houndoom $715 vs $616). It IS eBay sold data, and it is the only one of these we could pull automatically (paid API).
2. Vintage eBay raw sales are mostly played copies with mixed or no condition words; a plain median undercounts a NM card and the spread (Lugia $350-9,650) makes it unusable. Needs: drop MP/HP/DMG/"played" titles, require 3+ sales.
3. Minus-words miss misspelled/other graders (BECKET, TAG, PCG): the title filter in code (ebayReferee REJECT) catches TAG/PCG/Beckett; add "becket" there.
