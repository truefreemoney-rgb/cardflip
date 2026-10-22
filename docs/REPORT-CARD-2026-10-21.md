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

## 5. Automatic eBay referee re-read (clean reads: Ungraded + plain Buy It Now)

Calls spent: run 1 (10:15pm ET) **3,054 eBay Browse calls**, 2,026 of 3,990 rows re-read in 9 minutes. Run 2 (set for 11:01pm ET, after eBay's window reset) did not run: at 11:01pm and again at 11:15pm eBay still reported the day's 4,000 used with only 1,000 left, which is the floor kept for sellers, so the script stopped itself (0 calls). The remaining 1,964 rows get the normal nightly 900 a day (done by ~10-24).

Caveat on the new "too high" calls: the referee's thresholds were calibrated on slab-mixed asks. Ungraded Buy It Now pools are smaller (n = 3-6, some n = 1-2, e.g. Armageddon Unlimited $195 vs 2 asks at $0.99 = junk listings). So the 30 new "too high" calls are **suspects for the TCGplayer-first hand check**, not price changes: nothing was retuned or moved tonight (measure first).
The referee compares each $100+ printing's TCGplayer price to what the SAME printing is asked for on eBay. Until tonight it read every listing; now it reads only **Ungraded** cards listed at a **plain Buy It Now** price (no slabs, no auctions, no Best Offer).

- Rows re-read tonight: **2026** of 4184 (Pokémon 746, Yu-Gi-Oh! 232, Magic 967, Lorcana 81).
- Verdict changes: ok → none: 219; ok → check: 100; check → ok: 76; check → none: 49; high → ok: 32; high → none: 27; check → high: 21; high → check: 15; ok → high: 9; none → ok: 8; none → check: 2.
- "Too high" calls **cleared**: 74 (slabs had pushed eBay's asks up). "Too high" calls **new**: 30. Still "too high": 34.
- Of the 426 prices with a standing keep/hide call, 12 changed verdict (all were KEEP calls; no HIDE call flipped).

### New "too high" calls (dearest first) — TCGplayer is checked FIRST before any of these move
| Game | Card | Our price | eBay asks before (n) | eBay asks now, ungraded BIN only (n) | Referee's call |
|---|---|---|---|---|---|
| Pokémon | Heracross · Neo Genesis 6 · 1stEditionHolofoil | $281 | $140 (18) | $80.00 (4) | needs a hand check → too high vs eBay asks |
| Yu-Gi-Oh! | Left Leg of the Forbidden One · The Legend of Blue Eyes White Dragon LOB-121 | $270 | $89.26 (13) | $76.00 (4) | needs a hand check → too high vs eBay asks |
| Pokémon | Raikou & Suicune LEGEND · Unleashed 93 · holofoil | $256 | $130 (18) | $125 (4) | needs a hand check → too high vs eBay asks |
| Pokémon | Umbreon · BW Black Star Promos BW93 · holofoil | $250 | $138 (8) | $16.00 (4) | needs a hand check → too high vs eBay asks |
| Magic | Last March of the Ents · The Lord of the Rings: Tales of Middle-earth 739 · foil | $249 | $40.00 (13) | $31.39 (6) | needs a hand check → too high vs eBay asks |
| Magic | Jeweled Lotus · Commander Legends 695 · foil | $236 | $80.99 (16) | $72.99 (9) | needs a hand check → too high vs eBay asks |
| Yu-Gi-Oh! | Swords of Revealing Light · The Legend of Blue Eyes White Dragon LOB-101 | $222 | $173 (18) | $28.49 (4) | fine → too high vs eBay asks |
| Magic | Marsh Flats · Zendikar Expeditions 21 · foil | $220 | $90.00 (8) | $90.00 (7) | needs a hand check → too high vs eBay asks |
| Pokémon | Heatran-EX · Plasma Freeze 109 · holofoil | $205 | $135 (16) | $90.00 (3) | needs a hand check → too high vs eBay asks |
| Magic | Witch-king of Angmar · The Lord of the Rings: Tales of Middle-earth 736 · nonfoil | $203 | $19.70 (13) | $13.84 (4) | needs a hand check → too high vs eBay asks |
| Pokémon | Raichu · Expedition Base Set 25 · reverseHolofoil | $200 | $120 (18) | $63.19 (5) | needs a hand check → too high vs eBay asks |
| Magic | Emrakul, the Aeons Torn · Rise of the Eldrazi 4 · foil | $196 | $250 (5) | $35.93 (3) | fine → too high vs eBay asks |
| Magic | Armageddon · Unlimited Edition 2 · nonfoil | $195 | $24.66 (6) | $0.99 (2) | needs a hand check → too high vs eBay asks |
| Magic | Ertai, the Corrupted · Planeshift 107★ · foil | $190 | $62.29 (6) | $53.08 (4) | needs a hand check → too high vs eBay asks |
| Pokémon | Steelix ex · Unseen Forces 109 · holofoil | $181 | $157 (7) | $53.51 (3) | fine → too high vs eBay asks |
| Yu-Gi-Oh! | Dragon Master Knight · Retro Pack 2 RP02-EN097 | $170 | $67.97 (38) | $29.42 (10) | needs a hand check → too high vs eBay asks |
| Pokémon | Absol · Team Magma vs Team Aqua 96 · holofoil | $168 | $300 (11) | $16.00 (3) | fine → too high vs eBay asks |
| Pokémon | Giratina · DP Black Star Promos DP38 · holofoil | $164 | $53.04 (15) | $49.99 (6) | needs a hand check → too high vs eBay asks |
| Pokémon | Absol · Triumphant 91 · holofoil | $155 | $175 (12) | $16.00 (3) | fine → too high vs eBay asks |
| Pokémon | Umbreon · XY Black Star Promos XY96 · holofoil | $149 | $150 (17) | $93.66 (6) | fine → too high vs eBay asks |
| Pokémon | Exeggcute · Plasma Blast 102 · holofoil | $149 | $107 (14) | $93.84 (3) | fine → too high vs eBay asks |
| Magic | Saruman of Many Colors · The Lord of the Rings: Tales of Middle-earth 743 · nonfoil | $149 | $8.99 (9) | $8.49 (6) | needs a hand check → too high vs eBay asks |
| Magic | Berserk · Unlimited Edition 186 · nonfoil | $139 | $9.99 (23) | $5.99 (6) | needs a hand check → too high vs eBay asks |
| Magic | Doctor Doom · Marvel Super Heroes 394 · foil | $138 | $39.99 (40) | $24.45 (24) | needs a hand check → too high vs eBay asks |
| Magic | Plains · Asia Pacific Land Program 4 · nonfoil | $135 | $28.28 (2) | $32.78 (3) | needs a hand check → too high vs eBay asks |
| Yu-Gi-Oh! | Compulsory Evacuation Device · Turbo Pack: Booster Four TU04-EN005 | $122 | $250 (1) | $1.15 (1) | fine → too high vs eBay asks |
| Magic | Fabricate · Secret Lair Drop 7118 · nonfoil | $119 | $54.99 (9) | $49.50 (3) | needs a hand check → too high vs eBay asks |
| Magic | Mana Confluence · Edge of Eternities: Stellar Sights 70 · foil | $116 | $69.99 (6) | $68.06 (3) | needs a hand check → too high vs eBay asks |
| Pokémon | Umbreon · Undaunted 10 · holofoil | $115 | $67.43 (28) | $60.00 (6) | needs a hand check → too high vs eBay asks |
| Magic | Ghyrson Starn, Kelermorph · Warhammer 40,000 Commander 124★ · foil | $111 | $176 (3) | $43.66 (3) | fine → too high vs eBay asks |

### Keep/hide calls whose reading changed
| Game | Card | Our price | eBay asks before (n) | eBay asks now, ungraded BIN only (n) | Referee's call |
|---|---|---|---|---|---|
| Yu-Gi-Oh! | Left Leg of the Forbidden One · The Legend of Blue Eyes White Dragon LOB-121 | $270 | $89.26 (13) | $76.00 (4) | needs a hand check → too high vs eBay asks |
| Magic | Spectacular Spider-Man · Marvel's Spider-Man 240 · foil | $264 | $19.95 (36) | $350 (5) | needs a hand check → fine |
| Pokémon | Pikachu & Zekrom GX · Team Up 184 · holofoil | $249 | $107 (57) | $234 (9) | needs a hand check → fine |
| Pokémon | Rocket's Meowth · Team Rocket Returns 46 · reverseHolofoil | $250 | $30.00 (5) | — (0) | needs a hand check → no eBay asks found |
| Magic | Llanowar Elves · Foundations 429 · foil | $218 | $2.79 (30) | $241 (8) | needs a hand check → fine |
| Magic | Spectacular Spider-Man · Marvel's Spider-Man 237 · foil | $217 | $19.95 (36) | $350 (5) | needs a hand check → fine |
| Pokémon | Palkia · Great Encounters 106 · holofoil | $174 | $14.99 (34) | $10.00 (2) | too high vs eBay asks → needs a hand check |
| Magic | Spectacular Spider-Man · Marvel's Spider-Man 241 · foil | $199 | $19.95 (36) | $350 (5) | needs a hand check → fine |
| Pokémon | Snorlax · Call of Legends 33 · reverseHolofoil | $190 | $74.99 (5) | $90.00 (2) | too high vs eBay asks → needs a hand check |
| Magic | Xiahou Dun, the One-Eyed · Portal Three Kingdoms 92 · nonfoil | $185 | $7.99 (2) | $250 (1) | needs a hand check → fine |
| Pokémon | Scizor ex · Unseen Forces 108 · holofoil | $190 | $20.00 (56) | $11.75 (2) | too high vs eBay asks → needs a hand check |
| Lorcana | Ariel - Spectacular Singer · Curator's Collection: Heroines Edition 1 · foil | $137 | $25.34 (5) | $120 (3) | needs a hand check → fine |

### "Too high" calls that cleared (dearest 15 of 74)
| Game | Card | Our price | eBay asks before (n) | eBay asks now, ungraded BIN only (n) | Referee's call |
|---|---|---|---|---|---|
| Pokémon | Darkrai & Cresselia LEGEND · Triumphant 99 · holofoil | $276 | $45.99 (77) | $250 (5) | too high vs eBay asks → fine |
| Magic | Sol Ring · Fallout 887 · foil | $273 | $49.22 (15) | $291 (2) | too high vs eBay asks → fine |
| Magic | Exalted Sunborn · Edge of Eternities 384 · foil | $270 | $47.00 (43) | $509 (1) | too high vs eBay asks → fine |
| Magic | Leonardo, the Balance · Teenage Mutant Ninja Turtles Eternal 83 · foil | $269 | $2.79 (25) | — (0) | too high vs eBay asks → no eBay asks found |
| Magic | Nazgûl · The Lord of the Rings: Tales of Middle-earth 723 · foil | $269 | $46.18 (3) | — (0) | too high vs eBay asks → no eBay asks found |
| Magic | Muldrotha, the Gravetide · Foundations 440 · foil | $268 | $4.49 (41) | — (0) | too high vs eBay asks → no eBay asks found |
| Magic | Mountain · Arabian Nights 77 · nonfoil | $267 | $2.99 (3) | $3.28 (2) | too high vs eBay asks → needs a hand check |
| Magic | Michelangelo, the Heart · Teenage Mutant Ninja Turtles Eternal 92 · foil | $251 | $2.99 (23) | $251 (1) | too high vs eBay asks → fine |
| Magic | Tidus, Yuna's Guardian · Final Fantasy Commander 213 · foil | $247 | $79.16 (5) | $317 (1) | too high vs eBay asks → fine |
| Magic | Aragorn, the Uniter · The Lord of the Rings: Tales of Middle-earth 741 · foil | $245 | $16.00 (6) | $79.95 (2) | too high vs eBay asks → needs a hand check |
| Magic | Enduring Curiosity · Duskmourn: House of Horror 398 · foil | $242 | $11.99 (44) | $293 (1) | too high vs eBay asks → fine |
| Magic | Enduring Courage · Duskmourn: House of Horror 402 · foil | $236 | $5.29 (40) | — (0) | too high vs eBay asks → no eBay asks found |
| Magic | Nazgûl · The Lord of the Rings: Tales of Middle-earth 551 · foil | $227 | $46.46 (3) | — (0) | too high vs eBay asks → no eBay asks found |
| Magic | Celes, Rune Knight · Final Fantasy Commander 209 · foil | $227 | $99.97 (7) | — (0) | too high vs eBay asks → no eBay asks found |
| Magic | Raphael, the Muscle · Teenage Mutant Ninja Turtles Eternal 91 · foil | $227 | $2.59 (26) | — (0) | too high vs eBay asks → no eBay asks found |



## 6. Tomorrow's post cards + the reader flag (checked by me, 11:30-11:50pm ET; TCGplayer first, eBay sold only as the fallback)

eBay sold read the new way: Graded: No, Buy It Now, and every listing counts as Near Mint unless its title says LP/MP/HP/damaged (your 11:40pm rule). 2 eBay searches used, 60 s apart.

| Card | Ours | TCGplayer market | eBay sold (NM-read) | Verdict |
|---|---|---|---|---|
| Rayquaza ex · EX Dragon 97/97 (7am) | $595.55 | $595.55, 0 listings (out of stock) | no usable sale: 7 of 12 were Best offer accepted (out), 2 listed or-Best-Offer (out), the 2 plain Buy It Now were a Moderately Played $500 and a $379 from a 0%-feedback seller | **Stands on TCGplayer alone** (eBay could neither confirm nor deny; first read counted Best Offer sales by mistake, caught by Chris) |
| Rotting Regisaur · The List M20-111 (1pm) | $3.52 | $3.57 (121 listings) | not needed | Stands |
| Uthros Research Craft · EOE Commander 7 (1pm) | $3.58 | $3.89 (46 listings) | not needed | Stands |
| Hunter's Insight · Marvel Universe 35 borderless (1pm) | $2.77 | $2.67 (222 listings) | not needed | Stands |
| Dragonite · Dragon Vault 5 (7pm) | $27.87 | $34.76 (53 listings) | not needed | Stands (20% under TCGplayer, inside the band) |
| Latios · Dragon Vault 10 (7pm) | $18.71 | $19.07 (44 listings) | not needed | Stands |
| Venusaur · Base Set 15/102 holo (reader: "too high", 10-19) | $136.30 | $167.66 (218 listings) | plain Buy It Now only: $53.50 (no condition), $53.34 (MP), $100 (LP); the other 8 were Best Offer = out. One clean sale is not a read | **Stands by the TCGplayer-first rule** (19% under TCGplayer; eBay has too little clean data to argue) |

All six post cards marked "Looks right" on prod (scripts/_post-check-mark.mjs, the same write as the button). The reader flag itself stays open on /admin/prices (resolving it needs the admin sign-in); nothing to fix.

## 7. The 47 hand-set prices re-read TCGplayer-first (11:40pm-12:05am ET, your sign-in, read only)

Each of these was set from eBay sold on 10-18..10-21 (before tonight's rules). With your TCGplayer sign-in I pulled each card's last 25 TCGplayer sales and kept Near Mint sales of our exact finish. DONE 12:12am ET on Chris's "do whatever you think is best": the 27 in Verdict A were retired on prod (scripts/_retire-checks-1022.mjs); they return to TCGplayer's market on the next nightly write.

**Verdict A: TCGplayer should win back these 27** (its Near Mint sales sit well above our eBay number; "retire" = the hand-set price is switched off and the card goes back to TCGplayer's market from the next nightly write).

| Card | Ours (eBay) | TCGplayer NM sales | TCGplayer market |
|---|---|---|---|
| Mewtwo ex · Ruby & Sapphire 101 | $250 | 3 sales, median $999.69, last $1,167 (10-12) | $746.79 |
| Charizard GX · Burning Shadows 150 rainbow | $350 | 8 sales, median $950 | $840.75 |
| Crystal Celebi · Skyridge 145 reverse | $489.99 | no NM sale; MP $775, LP $699, HP $650-700 (all above ours) | $775 |
| Rocket's Suicune ex · TRR 105 | $400 | NM $1,349.99; LP $650; MP $300-475 | $500 |
| Gyarados · HGSS 123 reverse | $170 | 1 sale $499.99 (09-18) | $369.59 |
| Charizard · Secret Wonders 3 reverse | $200 | 1 sale $441.24 (10-12); LP $240 | $310.62 |
| Rocket's Sneasel ex · TRR 103 | $260 | 2 sales $399 / $420 | $386.33 |
| Lugia GX · Lost Thunder 227 | $245 | 1 real sale $499.97; LP $203-245 | $326.25 |
| Typhlosion ex · Sandstorm 99 | $200 | 4 sales, median $275, last $299.99 (10-22) | $259.63 |
| Spectacular Spider-Man 238 textured foil | $174 | 16 sales, median $249.73 | $250.59 |
| Zapdos ex · FRLG 116 | $135 | 5 sales, median $268.96 | $260.97 |
| Suicune & Entei LEGEND top · Unleashed 94 | $125 | 1 sale $340; LP $141-200 | $305.95 |
| Rare Candy · Plasma Blast 105 | $122 | 4 sales, median $195, last $310 (10-18) | $231.25 |
| Scyther ex · Ruby & Sapphire 102 | $115 | 6 sales, median $175 | $180.86 |
| Keldeo-EX · Boundaries Crossed 142 | $100 | 1 sale $155; LP $75-100 | $140.65 |
| Suicune & Entei LEGEND bottom · Unleashed 95 | $90 | 3 sales, median $213.98 | $210.25 |
| Venusaur · Base Set 15 | $75 | no NM sale; LP $93-95 (above ours) | $167.66 |
| Hitmonchan ex · Ruby & Sapphire 98 | $70 | 2 sales $199.99; LP $100-120 | $125.32 |
| Scraggy · McDonald's 2016 7/12 | $65 | 1 sale $199.99; LP $140 | $144.99 |
| Lightning Energy · Call of Legends 91 | $50 | 3 sales, median $220.50 | $116 |
| Metagross δ · Delta Species 11 | $48 | 2 sales $127.84 / $199.99 | $175.94 |
| Pikachu · POP Series 4 13 | $45 | no NM sale; LP $90, MP $70 | $101.47 |
| Blaziken · Ruby & Sapphire 3 | $40.64 | 3 sales, median $179.99 | $101.02 |
| Minun · HGSS17 promo | $23.33 | 2 sales $79.95 / $79.99 | $79.97 |
| Scapegoat · Retro Pack RP01-EN090 | $12.74 (eBay asks, 0 sales) | LP $160-185, MP $80 | $181.85 |
| Dark Magician · Retro Pack RP01-EN003 | $11.50 (asks) | NM $69.80, LP $149.99 | $147.50 |
| Elemental Hero Knospe · PP02-EN005 | $4.24 (asks) | LP $100, MP $96 | $103.38 |

**Verdict B: keep our number on these 20** (TCGplayer has no usable Near Mint data for the exact printing, or its sales agree with ours): Charizard 1st Edition $4,000 (no 1st Ed sale in the last 25, only unlimited); Mickey Best in Town Iconic $3,000 (no TCGplayer sales, 14 asks from $2,449); Rocket's Mewtwo Best of Game $1,000 (2 NM sales $899.99, LP $645-1,200: ours fits); Rocket's Mewtwo ex $750 (1 NM sale $900, 17% off); Milotic ex $530 (1 NM sale $799.99 two months ago: one sale is not a read, flag); Raigeki LOB 1st $107 (no 1st Ed sales); Kingdra δ reverse $92 (no reverse NM sale; TCGplayer's $289 looks wrong); Mewtwo Legends Awakened reverse $55 (thin, one $959 outlier); Torchic 017 $25 (NM sales $26); Genex Ally Axel $2, Tower of Babel $1.50, Bujingi Crane $1.25, Red-Eyes RP01 $15 (TCGplayer's five- and six-figure numbers are junk, no sales); and Pikachu Wizards promo 1 $42 (TCGplayer's $499.99 is junk). Second pass 12:27am on the 7 my match missed, by product id: 6 more retired (Sengenjin LP $140 / MP $120 vs our $7.06; Elemental HERO Heat LP $199.98 vs $3.99; Hecatrice six NM sales $190-200 vs $2.66; King Dragun Ultimate NM $153 vs $70; Ancient Gear Beast 1st Ed LP $75-78 vs $35; Mewtwo LV.X DP28 LP $195-296 and NM $445 vs $100). **Total handed back to TCGplayer: 33 of 47; 14 keep.**

Why the eBay numbers were low: those reads mixed in played copies and Best Offer sales (both excluded as of tonight), so they landed near TCGplayer's LP price, not NM.

## 8. The 10-22 hand list, done TCGplayer-first from the signed-in sales (12:30-12:50am ET; 0 eBay searches used)

| Card | Ours | TCGplayer | Verdict |
|---|---|---|---|
| Mewtwo Star · Holon Phantoms 103 | $6,887.50 | market $9,200; one NM sale $9,200 (10-08); no copies listed | Stands (25% under one sale; eBay asks at $50 were proxies) |
| Shining Tyranitar 1st Ed · Neo Destiny 113 | $4,249.99 | NM 1st Edition sold $4,099.05 (10-12); market $4,099 | Stands (4%) |
| Gengar & Mimikyu GX alt art · Team Up 165 | $2,155.56 | market $2,155.56; NM sales $1,600-2,950, median ~$1,850 | Stands |
| Celebi ex · Unseen Forces 117 | $999.99 | market $999.99; LP sold $999.99 (10-15) | Stands |
| Typhlosion 1st Ed · Neo Genesis 17 | $475 | market $475 (1st subtype); only unlimited copies sold lately ($200-275 NM) | Stands |
| Light Dragonite 1st Ed · Neo Destiny 14 | $699.99 | market $699.99; unlimited NM $499.99 | Stands |
| Kabutops ex · Sandstorm 97 | $160.30 | market $160.30; NM $152-180 | Stands |
| Luffy OP05-119 manga (Premium Booster) | $4,250 | one copy asked at $5,000, market $5,000 | Stands |
| Luffy OP05-119 gold / special / manga (prize prints) | $13,000 / $5,749.97 / $3,915.86 | not sold on TCGplayer | Keep (no source but eBay, and eBay shows nothing clean) |
| Blastoise 1st Ed · Base Set 2 | $1,300 | only unlimited copies sold (NM $230); market $228.99 is the unlimited line | Keep |
| Treecko Star, Pikachu Star · Power Keepers | as set | not on TCGplayer at all | Keep |
| Uria 1st Ed Ultimate Rare · SOI-EN001 | $999.97 | TCGplayer only lists the regular print ($9.64) | Keep |
| Darkpact Alpha/Beta, Judge token, Red Cliffs Armada, Gengar Fossil | as set | not pinned to an exact product tonight | Unchanged; low value or ambiguous, not worth an eBay slot |

Net: nothing on the hand list moves. The two cards the asks referee called "too high" (Mewtwo Star, Shining Tyranitar) were right all along; the asks it compared against were junk listings.

## 9. The "round-number" Pokémon prices (12:05-12:20am ET 10-22; TCGplayer sales, your sign-in, 0 eBay)

366 Pokémon TCGplayer prices are whole dollars in multiples of 5 at $50+; 204 of them are real cards at $100+ (the rest are sealed products). Read all 204 against TCGplayer's last 25 sales. Result: a round number is TCGplayer's own market for that printing in all but one case, usually set by a single recent sale (Skyridge holos, Legendary Collection reverses, Star cards, 1st Editions: thin markets where one $300 sale is the market). Where the public market looked far off it was a different finish of the same product (TCGplayer's search shows the unlimited/normal line). Nothing systematic on our side.

| What | Count |
|---|---|
| Round price = TCGplayer's market for our exact finish, or its NM sales agree | 174 |
| Already retired tonight (§7), nightly write fixes them | 18 |
| No TCGplayer product match (Expedition holos, Lucky Stadium, Mewtwo DP28): unchanged | 11 |
| **Caught wrong and fixed** | **1** |

**Fixed:** Entei · SM Black Star Promo SM219, holofoil: ours **$205** (flat at $203-205 since May) vs TCGplayer market **$22.17** with 11 Near Mint sales Sep-Oct at $18-27. Checked price $22.17 written (scripts/_fix-price-tcg.mjs, same write as the admin Fix button), 28 series points corrected, page caches dropped. Cause to look at: our TCGplayer product mapping for that promo (the raw feed kept writing ~$205, which is a different product's price). Not retuned anything else.

Worth a glance later, not acted on (one or two sales, inside or near the band): Torchic ☆ TRR $6,500 vs 4 NM sales median $9,500 (last $4,000); Machamp Stormfront $145 vs 4 sales ~$200; Reshiram Legendary Treasures $290 vs 5 sales ~$345.

## 10. Found while sweeping: Staff-stamped promos priced the plain card (12:25-12:55am ET 10-22)

The Entei SM219 miss in §9 had a cause worth measuring: TCGplayer sells stamped copies of a promo as separate products ("[Staff]" prerelease stamps, Worlds placement stamps like "[Champion]" or "[Top 32]"), our catalog has the plain card only, and the product matcher mapped both products to it. The nightly price write takes the first product it meets, so whichever stamp came first in TCGplayer's list priced the plain card.

| Measured (read only, tcgcsv product names + prices) | Count |
|---|---|
| Pokémon cards with 2+ TCGplayer products mapped | 688 |
| ...of which one product is a Staff / placement stamp | 160 |
| Price lines following the STAMP while the plain product has its own price (wrong) | 15 incl. Entei |
| Price lines following the stamp because the plain product has no TCGplayer price | 7 |
| Plain product's price in use (fine) | 145 |
| Doubles with no stamp involved (matcher dupes, e.g. "Clefable (Prerelease)" mapped to Pikachu promo 1): separate item | 528 |

**Fixed on prod (same write as the admin Fix button, 28 series points each corrected):** Entei SM219 $205 -> $22.17; Dragalge XY10 $64.95 -> $19.95; Zygarde XY129 $72.50 -> $15.80; Bruxish SM11 $38.02 -> $10.72; Zygarde SM48 $59.25 -> $15.30; Crabominable SM47 $32.23 -> $4.47; Manectric SM130 $92.62 -> $8.24; Celesteela SM131 $40.49 -> $7.23; Delcatty SM132 $82.98 -> $8.93; Rillaboom SWSH006 $147.50 -> $5.74; Galarian Perrserker SWSH008 $69.58 -> $4.75; Hydreigon SWSH037 $98.77 -> $8.87; Lugia SWSH069 $256.34 -> $42.01; Charizard SWSH066 $621.21 -> $104.97; Donphan SWSH067 $49.59 -> $4.59.

**Code (committed, NOT pushed):** stamped products are recognised by name and skipped in the price loop, so they can never price a plain card again (test added). After the push, the 7 stamp-only cards (Tropical Tidal Wave HGSS18 $1,400, Champions Festival XY91 $370, three SV prerelease promos, two Mega Evolution promos) stop getting a TCGplayer point: their price goes stale and then unsure, which is right, a Staff stamp is not the plain card. Making stamps their own catalog cards (like 1st Edition twins) is the real answer; parked under the feature freeze.
