# Report card, Wed 10-21 night (after the 10pm reset)

Rules in force tonight: TCGplayer FIRST; eBay only as the fallback, and then Ungraded + plain Buy It Now only (no slabs, no auctions, no Best Offer), net of eBay's fee (13.25% + $0.40) and shipping. Hand eBay searches: none tonight (the 10-21 budget was already spent); they resume 10-22.

## 1. What shipped

| What | Where | Status |
|---|---|---|
| Every eBay read in the code asks eBay for Ungraded + plain Buy It Now (eBay's own condition filter, not title words); Best Offer and auction listings dropped | live comps, nightly referee, sold comps | PUSHED `6ba0c921`, CI + Production smoke green 10:25pm ET |
| Hand-check links (card page, /admin/prices, post-check) open eBay sold with Graded: No + Buy It Now ticked + the fuller no-slab word list | links | same push |
| Pinterest pin text keeps all 5 cards (the TikTok opener and the question go first, cards last) | scripts/lib/pin-text.mjs, pack writer | committed `16aeecf0`, not pushed (scripts only) |
| Admin can gift BOOSTER scans (Plan / Booster toggle) | /admin/users Adjust Scans | committed `18ef47f8`, not pushed; phone shot sent |

## 2. TCGplayer-first look at the cards on the list (read only, no eBay)

| Card | Our price | TCGplayer says | Verdict |
|---|---|---|---|
| Latias & Latios GX, Team Up #170 (1pm post, "looks graded?") | $4,500 | market $4,499.66 for 6 days (was $3,917 the week before); cheapest live TCGplayer listing $3,799.99 today; eBay asks (10-19 read) median $3,300, 27 listed | **Stands** under TCGplayer-first: a live TCGplayer copy sits at $3,800, so $4,500 is a raw-card market price, not a slab's |
| Smaug the Magnificent, The Hobbit #249 foil (serialized) | $24,500 | flat 27 days; cheapest live TCGplayer listing $26,799.99 | **Stands**: the only copy for sale asks more than we show |
| Monkey.D.Luffy OP05-119 gold / special / manga ×2 (prize printings) | $13,000 / $5,750 / $4,250 / $3,916 | flat 21 days; no TCGplayer listing data (prize cards) | **Hand check 10-22** (eBay sold, the only source) |
| Uria, Lord of Searing Flames 1st Ed SOI-EN001 | $999.97 | flat 21 days; no TCGplayer listing data; eBay asks 2 at $600 (old read) | **Hand check 10-22** |
| Red Cliffs Armada (Portal Three Kingdoms), Dragonite Neo Destiny 1st | — | not on the referee's list under those names | **Hand check 10-22** |

## 3. Stale prices (Chris: "how will we ever tackle that many cards")

256,487 TCGplayer USD price lines on the site. Flat (identical) for 30+ days: **18,777**; for 90+ days: 5,163; no price point at all in 30+ days: 2,939.

| Game | Lines | Flat 30+ days | Flat 90+ days | Nothing in 30+ days |
|---|---|---|---|---|
| Magic | 147,353 | 17,146 (330 at $100-499, 143 at $500+) | 4,847 | 2,897 |
| Pokémon | 37,689 | 1,631 (223 at $100-499, 68 at $500+) | 316 | 42 |
| Lorcana / One Piece / Yu-Gi-Oh! | 71,445 | 0 | 0 | 0 |

How to read it: Magic's 17,146 are mostly sub-$10 cards nobody trades (11,810 of them under $1). The ones worth hands: **Pokémon $100+ flat 30+ days = 291 cards**, Magic $100+ = 473. Lorcana / One Piece / Yu-Gi-Oh! show 0 because tcgcsv re-prices them daily and the lines are young. A flat price is not automatically wrong (a 1st Edition Charizard sits flat for months); it is the list to spot-check, dearest first, TCGplayer listing first, eBay sold second.

## 4. Scan cost test (Sonnet 5 + Haiku 5.5 vs Opus on the picture tiebreak)

Run 10:40pm ET on the testing key, **$0.14** (estimate said $0.08; Sonnet's picture tokens ran higher). Replayed your own 8 real tiebreak calls from the last 30 days (your saved photo + the exact candidate list the live scanner sent; scripts/_tiebreak-ab-owner.mjs). Truth = the card you kept.

| Model | Same pick as Opus | Right vs the card you kept | Cost per tiebreak |
|---|---|---|---|
| Opus (today's) | — | 3 right, 3 wrong, 2 unknown | ~$0.020 |
| Sonnet 5 | **8 of 8** | 3 right, 3 wrong (identical) | ~$0.011 |
| Haiku 5.5 | **8 of 8** | 3 right, 3 wrong (identical) | ~$0.0066 |

The "wrong" ones are the same for all three: two Sylveon calls where no candidate matched the photo (all three said "none", correctly: the photo was a plain Sylveon, the candidates were Sylveon ex) and Fan Rotom, where all three read "PRE 085/131" off the photo and you kept the ASC #171 printing. So the cheaper models give exactly Opus's answers on your scans.

What it means for the bill: a scan today ≈ $0.013 (Sonnet read) + the tiebreak on ~77% of scans. Opus tiebreak → ~$0.028 a scan. Sonnet 5 tiebreak → ~$0.021. Haiku 5.5 tiebreak → ~$0.018. Your target was ~$0.012: the tiebreak alone can't reach it; the next step would be a smaller picture for the first read.

**Your call (one word):** "Sonnet" or "Haiku" for the Pokémon / Magic / Lorcana / Yu-Gi-Oh! tiebreak (One Piece already runs on Haiku). It is a one-line change (TIEBREAK_MODEL in vision.ts); 8 pairs is a thin sample, so I'd watch the first week's picks in /admin after the switch. Honest lean: Sonnet 5 (half of Opus's cost, more margin on subtle pattern cards like Poké Ball / Master Ball, which these 8 pairs did not cover).
