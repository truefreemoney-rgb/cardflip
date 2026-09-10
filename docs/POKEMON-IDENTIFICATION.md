# Pokémon identification — the 98% push

Chris, 2026-09-10: "nothing else matters except getting to high 90%s, both
Pokémon and Magic" — 98% first-try identification on a **clear** photo, because
the site is about to be launched to customers. This is the Pokémon half; Magic
lives in docs/MTG-IDENTIFICATION.md.

## The panel

`npm run pokemon:panel` — 213 fixed printings (scripts/pokemon-panel.json)
spread over 14 buckets: every era from Base Set to the current block, 1st
Edition twins, secret/illustration rares, promos with no denominator,
lettered numbers (TG/GG/SV/RC/SH), same-name-same-number-same-total twins,
energy, McDonald's / trainer kits. Each card's catalog image goes through the
scanner's own vision read and the scanner's own lookup walk
(app/app/page.tsx → /api/search-card → searchEnglishCardsLocal). Score =
exact printing id at the top; "one tap" = within the first 3.

- Reads are cached in scripts/pokemon-panel.cache.json, so ranker changes
  re-score for free. A prompt/schema change means a `--fresh` re-read.
- **Cost:** one uncached card ≈ 5.5k Sonnet input tokens; a full fresh panel
  ≈ $2.35. The script prints the count and refuses > 40 uncached calls
  without `--yes`. Say the cost to Chris before a full re-read.
- `--bucket <substr>`, `--id a,b,c`, `--limit N`, `--pick` (re-choose).

## Rules added 09-10 (all pinned in scripts/test-mirror.mjs)

| Miss on the panel | Rule |
|---|---|
| Type: Null 183/236 is Unified Minds AND Cosmic Eclipse | vision's `setName` is a 1-point tiebreak (loose match: "Black & White (Base Set)" ≈ "Black & White") |
| Eevee 63/100 is Sandstorm (2003) AND Majestic Dawn (2008) | `copyrightYear` read off the copyright line; a set > 1 year off loses a point |
| "Pupitar" read off Pupitar δ 59/101 lost to plain Pupitar 58 | number + total agreeing outranks an exact name with the wrong number (only when the total was read) |
| Grookey SWSH001 fell to a McDonald's Grookey | promo numbers compared raw, read-stripped and row-stripped of the set code |
| SVE 024 read "Basic Metal Energy", mirror says "Metal Energy" | "Basic … Energy" also searches the name without "Basic" |
| Snivy RC1/25 lost over "25 ≠ 113" | lettered sub-series totals never count as a contradiction |
| DPBP#307 read as the number; SH1 read as SN1; TG01/TG30 | prompt names the lettered series, the Shining "SH", and the DP-era database code |

The 1-point tiebreaks (set name, year) sit below the fraction and code
penalties on purpose — they reorder ties, they never overrule a read number.

## Where the number stands

| Run | First try | One tap |
|---|---|---|
| Baseline (09-10) | 167/188 = 88.8% | 94.1% |
| After the ranker rules | 178/188 = 94.7% | 96.3% |
| After year + prompt, cached | 206/211 = 97.6% | 97.6% |
| Same, clear images only | 206/208 = **99.0%** | |
| Fresh prompt pass (TCGdex throttled 112 fetches; gaps filled from run 1) | 206/211 = 97.6% | 98.1% |
| **Real phone photos on prod** (`npm run pokemon:phone`, 14 kept cards) | **14/14 = 100%** | 100% |
| + picture tiebreak (Opus on near-ties, 18 of 213) | **208/211 = 98.6%** | 99.1% |
| Same, clear images only | **208/209 = 99.5%** | |

Remaining: one McDonald's Pikachu (2015 vs 2016, same fraction; the tiebreak
read the catalog picture as 2015 — the picture itself may be the 2015
print) and two trainer-kit cards whose catalog images are blurry 12 KB
TCGplayer product photos, one of which is the wrong card. The two Gym
energies are settled by the picture tiebreak.

## Catalog faults the panel exposed (not scanner faults)

- **TCGdex's WotC-era scans are 1st Edition copies.** 18 of the 25
  "unlimited" Base–Neo panel rows show the stamp, so the unlimited row's
  catalog art is a stamped card. The panel counts the -1st twin as the right
  answer for that image. App-side: the card art shown for an unlimited WotC
  card carries a 1st Edition stamp — fix when catalog art gets a pass.
- **Trainer Gallery sets exist twice** in the mirror (swsh9tg AND swsh9.5tg,
  same for 10/11/12). The sync should keep one.
- **g1-28's image is 28a** (the Jolteon EX full-art twin).
- **pokemontcg.io plain PNGs are 245px thumbnails**; the panel reads the
  `_hires` twin. Anything rendering catalog art large should too.
- **tk-xy-sy-20's image is card 24.**

## The second look (shipped 09-10)

`analyzeCardImageWithUsage` in lib/server/vision.ts is now first look +
second look: when the first read is unsettled — confidence under 0.7, no
number read, (Magic) an Art Series / unreadable name, or a set+number that
The List reprinted — the server crops the bottom 45% of the photo, widens
it to ~1400px and asks a small schema for just the printed details (number,
denominator/code, copyright year, List icon, date stamp, serial, edge
colour). The close-up fills what was null and, on a low-confidence first
read, overrides the fraction. Both panels and both phone scripts run this
exact path, so their numbers are the customer's numbers. `read.secondLook`
says why it fired (the scan ledger keeps it).

## The picture tiebreak (shipped 09-10, Chris: "get us close to 99%")

Both rankers now expose `rankScore` on every result. When #1 and #2 sit
within a point (lib/tiebreak.ts isNearTie) the scanner posts the photo and
the two ids to POST /api/vision/tiebreak; the server fetches both catalog
pictures and asks Opus 5 which printing the photo shows, judging only
printed details (border, symbol, number, year, stamps, icon, frame, art).
A confident A/B reorders the pair; null keeps the ranker's order. Billed on
the scan ledger as Opus, ~3¢, on roughly one scan in ten on the panel and
fewer on real photos. Both panels run the same call.

## Next

1. Chris's 30–40 card phone batch — mixed eras, a few twins, one or two
   1st Editions — then `npm run pokemon:phone -- --pull` and read the number.
2. Catalog dedupe (Trainer Gallery twins) and the stamped WotC art.
3. Re-read the panel fresh when TCGdex stops throttling (≈ $2.35).
