# Magic: locking down card identification

Written 2026-09-10 from four research passes (code map, printed identifiers,
how other scanners work, art/finish variants and pricing). Sources at the end.
Goal: a Magic scan should land on the exact printing and finish as reliably
as a Pokémon scan lands on the exact set, before Magic leaves admins-only.

## 1. Why Magic is harder than Pokémon

Pokémon has a printed fraction (`4/102`) whose denominator names the set.
Magic has no denominator on most cards people actually sell:

| Era | What the bottom-left line carries | Enough to pick the printing? |
|---|---|---|
| 1993–1997 (Alpha … Tempest) | nothing — artist + copyright only | No. Name + border colour + corner cut + copyright text + artist. |
| 1998–2014 (Exodus … M15) | `187/350` (number/total), rarity by symbol colour | Partly. Number + total + name is usually 1–3 sets; the copyright year (`© 1993–2003`) settles it. |
| 2014– (M15 frame) | `0187/0281 R  LTR • EN` — number, total, rarity, set code, language | Yes. `set code + collector number` is a unique key (Scryfall `/cards/:set/:number`). |

Multiplied on top of that: 64 printings of Lightning Bolt; Sol Ring in 50+
products; the same art reused across sets; showcase / extended / borderless /
retro-frame variants that share the name and differ only in collector number
(numbers past the set total, e.g. `300/281`); The List (`PLST`) reprints that
wear the ORIGINAL set's frame and symbol plus a tiny planeswalker icon; Secret
Lair (`SLD`); promo stamps; serialized numbers. And finish: foil vs nonfoil vs
etched is NOT a separate card object anywhere — it is a price line on the
same printing, and it is often the bigger price difference (Sol Ring $1 vs
$950 judge foil; Bolt $1 vs $40 player-rewards foil).

Every scanner app and open-source project that leans on the NAME (OCR or
LLM) or on ART hashing gets the printing wrong on reprints. The ones that
work read the collector line and do an exact keyed lookup, and fall back to
art matching only when there is no collector line (pre-1998).

## 2. What CardFlip does today (src/lib/server/vision.ts, mtgCards.ts)

Right, already:
- The MTG vision prompt asks for name, collector number (leading zeros
  stripped, suffix letters and ★ kept), set total and set code; it knows
  tokens and Art Series cards; it knows borderless/showcase/extended as
  `artStyle: full-art`.
- The mirror is Scryfall `default_cards` (94k printings, own images), matched
  locally; `searchMtgCardsLocal` scores name → number → set code, keeps a
  number+code hit even when the name is misread, and deprioritises The List
  and promo-type sets unless the printed evidence says so.
- Prices stored per printing: usd, usd_foil, usd_etched (+ EUR).

Missing, and each one is a wrong price or a wrong listing:
1. **Finish is never read.** No `foil` field in the scan schema. Every scan
   prices as nonfoil unless the seller flips the variant picker by hand.
2. **No era cue for 1998–2014 cards.** Those print number/total but no set
   code, so name + `187` ties across 2–6 sets and the ranker breaks the tie
   by "has a price" and "not a promo set" — a coin flip. The copyright year
   printed on every card is not read; the artist name is not read; the
   frame generation (old border / 2003 / M15) is not read; the mirror does
   not store artist, frame, border colour or release year to match against.
3. **No cue for pre-1998 cards at all** beyond the name.
4. **Variant marks are not read.** The List icon, the promo-pack planeswalker
   stamp, the prerelease date stamp, a serialized `045/500` — each of these
   changes the set code or collector-number suffix, and the scan can only
   guess.
5. **`artStyle` is binary.** Showcase / extended / borderless / retro frame
   are all "full-art", so a showcase read cannot prefer the showcase row
   over the extended-art row when the number is misread.
6. **The seller never sees the printing we chose next to their card.** A
   one-look confirm (our image of that printing beside the photo, with
   "not this one → other printings of this name" underneath) catches every
   remaining miss for free, and is what ManaBox/Delver users say they end
   up doing by hand anyway.
7. **No accuracy number.** The Magic stress test (BACKLOG) has never run, so
   "unreliable" has no denominator. Pokémon got reliable because
   `replay-scans` gave every fix a before/after.

## 3. The plan

### Phase 1 — read everything the card prints (vision + mirror + ranker)

Scan schema, MTG only (Pokémon untouched):
- `finish`: `nonfoil | foil | etched | null`. Tells: a traditional foil has a
  rainbow sheen across the WHOLE face including the text box and border
  (glare is one bright patch, not a sheen); etched foil is a metallic glitter
  in the frame linework with a matte face; the oval holofoil stamp at the
  bottom is a security stamp on all rares since 2014 and means NOTHING about
  foil. Null when the photo cannot settle it — never default.
- `frame`: `1993 | 1997 | 2003 | 2015 | future | null` (Scryfall's own
  values): old rounded-frame with the coloured inner bevel, the 1997 frame,
  the 2003 modern frame with square title bar, the 2015 frame with the
  holofoil stamp and the bottom-left collector block.
- `treatment`: `standard | showcase | extended-art | borderless | retro |
  full-art | textless | null` replaces the binary `artStyle` for Magic.
- `marks`: list of `list-icon | promo-stamp | date-stamp | serialized |
  buy-a-box | none`, read from the bottom-left / set symbol area.
- `copyrightYear`: the last year in the `© 1993–2003 Wizards of the Coast`
  line (integer), null if unreadable.
- `artist`: the artist credit as printed.
- `borderColor`: `black | white | silver | gold | borderless | null` (white
  border = Unlimited/Revised/4th–9th era; silver = Un-sets).
- `serialNumber`: `045/500` style, when printed.

Mirror (`scripts/sync-mtg.mjs`, `mtg_cards`): add `artist`, `frame`,
`border_color`, `frame_effects`, `promo_types`, `full_art`, `textless`,
`set_type`, `released_year`, `printed_name`. All are in `default_cards`.

Ranker (`searchMtgCardsLocal`): after the existing name/number/code ladder,
add agreement scores for release year (±1 of copyright year), artist (exact
fold), frame, border colour, treatment ↔ `frame_effects`/`full_art`, marks ↔
`promo_types`/set code (`list-icon` → PLST; `date-stamp` → `promo_types:
prerelease` / `s` suffix; `promo-stamp` → `promopack` / `p` suffix;
`serialized` → `promo_types: serialized`). A set-code read that agrees stays
decisive; the new cues break the ties that today fall to "has a price".

Price: `pickPrice` for Magic picks the `finish` line the scan read
(`usd_foil` / `usd_etched`), and the editor's variant picker shows what the
scan chose so the seller can correct it in one tap.

### Phase 2 — measure, then fix what the numbers say

`scripts/replay-scans.mjs --game mtg`: a fixed panel of ~200 Scryfall
`normal` images chosen to cover every row of the era table and every
treatment/mark (pre-1998 incl. Alpha/Beta/Unlimited/Revised, 1998–2014
number-only, M15 with code, showcase/extended/borderless/retro, PLST, SLD,
promo pack, prerelease, serialized, DFC/adventure/split names, tokens, art
series, non-English). Score = exact printing id AND finish. Target ≥ 95% on
clean images before a real-photo pass; then a Chris phone batch of 30
mixed cards (`replay-scans` records those too) with a target ≥ 90%. Every
future ranker change re-runs the panel — that is the Pokémon discipline.

### Phase 3 — pick-by-picture for the leftovers

When the top two candidates are within a point after Phase 1 (pre-1998
reprints, unreadable collector line, sleeves/glare), send the photo plus the
top-3 candidates' Scryfall images to the vision model and ask "which of these
is the card in the photo — same frame, border, art, symbol?". This is the
art-hash fallback every open-source scanner ends up building, done with the
model we already pay for, only on ambiguous scans (a few cents, rare). A
classical pHash of `art_crop` against Scryfall's `unique_artwork` file stays
the option if the LLM compare is too slow or too dear.

### Always — the confirm screen

After identification, the editor shows our image of the chosen printing
beside the seller's photo, with set name · collector number · finish, and a
"Not this printing?" link listing the other printings of that name (our
images, sorted by ranker score). One glance, one tap. This is the safety
net while Phases 1–3 push the miss rate down, and it stays after.

## 3b. Phase 1 status (09-10)

Shipped: `MTG_READ_SCHEMA` + `SYSTEM_MTG` read finish / treatment / marks /
artist / copyrightYear / borderColor / serialNumber; `lib/mtgCues.ts` carries
them scan → `/api/search-card` → `searchMtgCardsLocal(…, cues)`;
`cuePenalty()` in `mtgCards.ts` (treatment 3, marks 3, artist 4, year 3,
border 3 — all below the set-code penalty 9 and a name tier 8); The List
row is read through the original's code + number when the icon is seen;
as-is reprint sets (PLST, MB1/2, CMB1/2) skip the year cue; the scan's
finish becomes the item's variant when the printing comes in that finish;
Magic photos upload at 1568px long edge (`visionApi.ts`).

Measured on five Scryfall images (replay-scans --file): 5/5 exact printing;
treatment/artist/year read right on all five; The List icon was missed at
Scryfall's 680px "normal" size and read at 936px "large" — hence the
1568px upload. Foil cannot be judged from catalog images; that is Chris's
phone batch.

Not yet: the confirm screen (the editor's "Not your card? See every …"
list already covers the tap-to-fix), the phase 2 panel, prod cue data
(`scripts/push-mtg-cues.mjs` after the deploy).

## 3c. Phase 2 status (09-10)

`npm run mtg:panel` — 205 printings (scripts/mtg-panel.json, fixed; reads
cached in scripts/mtg-panel.cache.json so a ranker change re-runs free;
`--bucket x --fresh` re-reads one bucket after a prompt change).

Run 1: 155/205 = 75.6%. Fixes from the numbers: stamped twins (promo pack
0/8 → 8/8, prerelease 0/8 → 7/8, serialized 1/5 → 4/5 — the read saw the
mark and the printed number, the row carries a p/s/z suffix and a P-set
code); Art Series rows only answer Art Series reads (they carry no frame
data and won name-only ties); a copyright-year window past the 600-newest
cap (1998–2014 25 → 28); the List-icon paragraph in SYSTEM_MTG (7 → 9/15
at Scryfall large; phones upload 1568px). Run 3: 179/205 = 87.3%.

Clean at 100%: M15 standard, showcase, extended, retro, SLD, promo pack,
DFC/split, textless. Leftovers, in order of value:
- pre-1998 (14/24): name-only ties between Alpha/Beta/Unlimited/Revised/4th;
  copyright year reads null on most (tiny © line). Phase 3 pick-by-picture.
- The List (9/15): the icon is missed at 936px on 6 cards even with the
  sharper prompt; real phone photos are the test.
- Art Series (0/5): the front carries no name; needs the back or art match.
- flavor names (LTC 386 "Shards of Narsil" = Thorn of Amethyst): the mirror
  has no flavor_name column — add it in sync-mtg + name search.
- Kamahl P15A, Archmage of Runes PFDN: the mark was not read.
Excluding the two phase-3 buckets the panel is 165/176 = 93.8%; ≥95% needs
the flavor-name column and one more List pass. Then Chris's 30-card phone
batch (≥90%).

## 4. What NOT to do

- Do not match on name alone or fall through to a fuzzy name lookup as the
  answer — that returns the newest/cheapest printing, exactly wrong.
- Do not treat the holofoil stamp as "foil".
- Do not model foil variants as separate card rows; they are price lines.
- Do not build the pHash pipeline before Phase 2 says name+line+cues is
  short of 95% on clean images — it is the most work for the fewest cards.
- Do not touch the Pokémon schema/prompt while doing this.

## 5. Field cheat sheet (printed → Scryfall)

| Printed | Scryfall field | Notes |
|---|---|---|
| `0187/0281` | `collector_number` (+ set total from set) | keep suffix letters, ★, `s`, `p`, `a/b` |
| `LTR` | `set` | 3–5 chars; PLST = The List; SLD = Secret Lair; `T…` tokens; `A…` art series |
| `R` between number and code | `rarity` | C/U/R/M; also S/L/T |
| `EN` | `lang` | non-English rows are separate printings (`all_cards`) |
| `© 1993–2003` | `released_at` year | ±1 tolerance |
| artist credit | `artist` | strong tie-breaker across reprints |
| frame look | `frame` | 1993 / 1997 / 2003 / 2015 / future |
| border | `border_color` | black / white / silver / gold / borderless |
| showcase, extended, borderless, retro, full-art, textless | `frame_effects[]`, `full_art`, `textless` | own card object, own number |
| List icon, promo stamp, date stamp, serialized, buy-a-box | `promo_types[]`, `promo`, set code | own card object |
| foil / etched / nonfoil | `finishes[]` and `prices.usd_foil` / `usd_etched` | same object, different price line |

## Sources

Scryfall API card objects, frames, rate limits, and the etched/glossy finish
blog; mtg.wiki on collector numbers, the holofoil stamp, The List, SLX,
30th Anniversary, Alchemy; Draftsim (Exodus, Unlimited vs Revised, Brothers'
War Retro Artifacts, Art Series); misprint.com (Alpha/Beta/Unlimited tells,
foil treatments explained); Star City Games (identifying sets); ManaBox
scanner FAQ; TCGplayer "How Scan & Identify works"; Delver Lens; CardCastle;
scanyourmtg.com (wrong-set FAQ, app comparison); open-source scanners: Timo
Ikonen's magic-card-detector (contour + pHash), hj3yoo/mtg_card_detector
(pHash vs all Scryfall images, "set fails frequently"), fortierq/mtgscan
(OCR title + SymSpell, ~10% error, name only), GrimbiXcode/mtgscan (OCR the
collector number only → exact lookup), Jack-Baumgartel/MTG-OCR-Imagehashing,
theDataFox/mtg-scanner, Moss Machine; price examples from TCGplayer,
MTGGoldfish, MTGPrice, Cardmarket, Aetherhub (The One Ring 001/001).
