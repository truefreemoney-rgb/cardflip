# One Piece: every printing TCGplayer sells gets its own row + price (build plan, 10-25)

Chris 10-25 9:06am ET: "go ahead with the one piece fix". Rules that apply: every card priced, accurate to the real sold
market (TOP PRIORITY); every print TCGplayer sells separately = its own price + scan read (asked 09-03 and 10-17);
existing row ids never change (customers' cards / wishlists / price checks point at them); prod data writes only after
Chris says yes to a dry run with samples (same as B7); screenshots at phone width before any visible push.

## Measured 10-25 ~8:50am ET (read only)
- tcgcsv category 68: 87 groups, 7,762 products, 7,082 with a card Number. Local One Piece rows 5,549; TCGplayer products
  that some row points at (image_url / own_image_src product id) 4,210.
- 2,875 card products are tied to NO row. Of the 462 worth >= $20, 181 have their price on no row for that number
  (within 25%); 9 numbers have no row at all.
- Sorted (scripts/_op-gap-sort.mjs -> data/op-gap-2026-10-25-sorted.json):
  - LINK 813: one of our rows for that number is tied to no TCGplayer product and its variant slug names the product's
    tag (mostly "#promo" rows: "OP05-091#promo[october-championship-2024-online-regional]" = TCGplayer 584366 Rebecca
    (October Championship 2024 Online Regional) $8,000, our row unpriced). 662 have a TCGplayer market; 79 of our rows
    are unpriced today; 235 are >= $20.
  - ADD 2,062 (1,933 in released sets; EB05 releases 10-30 and OP18 11-20, skip until then): no row names them.
    1,793 have a TCGplayer market, 140 none. Bands: < $1 703, $1-5 548, $5-20 319, $20-100 148, $100+ 75.
    By group: OP-PR promos 393, pre-release "OPxx PRE" ~75 each (OP02-OP08), release event "OPxx RE" ~75-90 each
    (OP10-OP17), anniversary "OPxx ANN" ~75 (OP05/OP09/OP13), LT-01 Learn Together deck reprints 49, plus ~60 special
    arts (Alternate Art 31, SP 15, Gold/Manga/...).
  - Examples: Gecko Moria OP14-080 (Alternate Art) 666573 $18.48 (no row); Shanks OP01-120 (Parallel)(Manga)
    (Alternate Art) 454666 $3,998.74 (our manga row $1,250); Boa Hancock EB02 (SP) 629181 $6,969.69 (our "spr" row
    $376.27); Shanks OP09-004 (SP)(Gold) OP13 $1,522.20 (we have silver, no gold).
- Scripts (all read only, run from the repo root): scripts/_op-gap-measure.mjs [out.json] (fetches tcgcsv with the
  CardFlip User-Agent; a bare node UA gets 401), scripts/_op-gap-prices.mjs <op-gap.json> [MIN],
  scripts/_op-gap-sort.mjs <op-gap.json>, scripts/_op-rows.mjs <number...> (local rows), scripts/_prod-q.mjs "<SELECT>"
  [args] (prod, SELECT only).

## Related findings the same morning
- Usopp OP11-003_r1 = the LT-01 "Luffy Deck" reprint (656670, NM sales $0.09-0.10): prod's 5am cron price $0.09 is right,
  the optcgapi feed's $1.66 that the 2am push sends is wrong (prod flips ~2:30-5am nightly). Pricing every row from its
  own TCGplayer product, locally too, ends the flip; 21 more starter-deck reprints share the shape.
- Kingdew OP17-006#3597 pandaman-art: TCGplayer 712593 "Kingdew (Pandaman Art)" is right (the 2am picker restored it);
  712668 is the plain Kingdew in "OP17 RE". The picker chooses by price; it should match the product's name tag first.
- OP14-080#3019 is a duplicate feed entry (both optcgapi pictures byte-identical, same name and price).

## Draft design (check against the code map below before building)
1. Tie by name tag before price: a row's product = same Number + the product's tag matches the row's variant
   (alt-art = "Alternate Art", parallel = "Parallel", manga, sp/spr = "SP", gold, silver, pandaman-art, promo slugs =
   the promo tag); price only breaks ties. Record the product id on the row (a column, not just the picture URL).
2. LINK the 813: set the TCGplayer picture (own copy through the usual picture pass) + price from that product.
3. ADD the missing ones as new rows, id `${number}#tcg${productId}` (stable, unique, never reused): name = product name
   minus " - NUMBER" and the tags; set = the TCGplayer group (name, code, release date); variant = slug of the tags, or
   the group kind for plain-name products ("pre-release", "release-event", "anniversary", LT-01 deck name);
   price = TCGCSV market (low/mid fallback; no price at all = do not add yet, count them); picture = TCGplayer CDN, then
   own copy.
4. Scans: stamped twins (pre-release, release event, anniversary, promos) never win a tie against the plain printing
   (same rule as 1st Edition twins); the Printing dropdown lists them.
5. Prod: the nightly (PC 2am) writes the rows and push-catalog sends them; the 5am cron must price new rows by their own
   product id (check how it picks today). Dry run first: counts per group + a picture sheet of ~40 samples (high value
   first) for Chris; then apply, push-own-pictures, crawl the new pages and the set pages.

## Code map (helper report, 10-25 ~9:10am)
(pending: appended when the helper finishes; if missing, re-map sync-onepiece.mjs, sync-onepiece-images.mjs, the prod
One Piece price update in src/lib/server/dailyJobs.ts, push-catalog.mjs, cardPath ids, the scanner's printing choice,
customer tables that hold card ids)
