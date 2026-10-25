# One Piece: every printing TCGplayer sells gets its own row + price (build plan, 10-25)

Chris 10-25 9:06am ET: "go ahead with the one piece fix". Rules that apply: every card priced, accurate to the real sold
market (TOP PRIORITY); every print TCGplayer sells separately = its own price + scan read (asked 09-03 and 10-17);
existing row ids never change (customers' cards / wishlists / price checks point at them); prod data writes only after
Chris says yes to a dry run with samples (same as B7); screenshots at phone width before any visible push.

## BUILD STATUS (s250 save, 10-25 9:58am ET) - read this first
SAMPLE SHEET SENT 10-25 10:07am ET (private Artifact https://claude.ai/artifact/3jmcAAbo2i5wqwis3n9EXz): waiting on Chris's
yes, then his push. Before the new rows go up I also check the 15 new prices of $300+ (11 adds + 4 first prices) on
TCGplayer sales, and hand-price the Chopper Winner OP01-015#promo (no price on TCGplayer or on our site).
BUILT + committed 9f116aa7 (LOCAL, NOT pushed, NOT wired into the nightly; the 2am run is unaffected: the images pass
changes 0 rows with nothing tied, push-catalog unchanged without the column; both verified). Tests pass:
test:onepiecetie (43, fixture scripts/fixtures/onepiece-tie.json), test:tcgprices 25, test:tcg, test:pushcatalog,
onepieceimages, onepiecesets, cardpages, setcompletion; tsc + eslint clean.
- scripts/lib/onepieceTie.mjs (matcher + rows to add), scripts/sync-onepiece-tcg.mjs [--dry] [--report out.json]
  (CARDFLIP_DB_PATH = another mirror file), column tcg_cards.tcg_product_id (db.ts probe; push-catalog adds it on
  Turso; empty = not in the row fingerprint), prod refresh prices tied rows by product (onePieceTiedPoints), scanner:
  stamped twins rank like promos (isOnePieceSideline / isOnePieceStampedTwin in lib/onepiece.ts).
- Holds: a FIRST tie moving a $20+ price >25% is held (85 rows: EB02 SP x23, manga rares, championship promos);
  clear one by adding its id to scripts/onepiece-tcg-cleared.json {"<id>": "<what the check found>"} after a
  TCGplayer-sales check (pane tab-1 helpers tcgV(productId, null, 4) / tcgPP(productId); EB02 SP products show NO
  sales in latestsales, listings only) or put a price check (scripts/_fix-price-tcg.mjs) where TCGplayer is wrong.
- No photo: TCGplayer's CDN 403s some products: a reprint / stamped copy borrows its booster card's picture (117),
  anything else waits (28 "no photo yet"). A tied row whose product 403s keeps its picture (Demo Deck 2023 promos).
REHEARSAL (copy of the mirror, outputs in data/op-printings-2026-10-25/: plan-apply.json, pic-changes.jsonl,
sheet-data.json, tcgcsv-68.json): 1,577 printings added (stamps 1,292 = release event / pre-release / anniversary /
super pre-release; promos 138; deck sets + reprints 137 = LT01 / SD01 / OPDD / OPRP; special 10), 5,173 rows tied,
1,172 prices moved (1,032 within 25%, 132 >25% under $20, 8 unpriced filled incl. Rebecca OP05-091#promo $8,000),
85 held, 305 pictures change (mostly promos: Bandai SAMPLE art -> TCGplayer photo); second run = 0 changes; push dry
run = 6,762 of 70,700 tcg_cards rows (one time). Rebuild the rehearsal: cp data/cardflip.db <tmp>/cardflip.db, then
CARDFLIP_DB_PATH=<tmp>/cardflip.db node --no-warnings scripts/sync-onepiece-tcg.mjs --report <tmp>/plan.json, then
CARDFLIP_DB_PATH=<tmp>/cardflip.db DRY_OUT=<tmp>/pics.jsonl node --experimental-strip-types --no-warnings
scripts/sync-onepiece-images.mjs --dry (~2 min), then node --experimental-strip-types --no-warnings
scripts/_op-sheet-data.mjs <tmp>/cardflip.db <tmp>/plan.json <tmp>/pics.jsonl <out.json>.
ROLLOUT ORDER (prod code first, or the OLD 5am refresh hands each "#tcg" stamp its base card's optcgapi price and the old
scanner coin-flips base vs stamp): 1) sample sheet -> Chris yes; 2) Chris says push (deploys the held commits + 9f116aa7;
TO-TEST entries go in then); 3) daytime by hand: sync-onepiece-tcg.mjs on data/cardflip.db, npm run
sync:onepiece:images, push-catalog --only tcg_cards, save-pictures --game onepiece --prod + push-own-pictures, then
the same-day crawl (set browser, search, scans, user rows; memory crawl-after-picture-changes); 4) wire it into
package.json sync:onepiece (between the feed and the images pass); 5) hand-check the 85 held.
Known leftovers (status quo, not worse): 104 untied rows (feed duplicates, loose PRB01/ST "reprint" rows), 28 "maybe
ours" products not added beside a loose row, 20 old two-rows-one-picture pairs, 1 clash (Ryuma P-072 Oda signature);
403 thumbnails are re-tried nightly by the stamp check (~2 min, not cached).

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
1. sync-onepiece.mjs: optcgapi allSetCards/allSTCards/allPromos(--with-promos)/allDonCards(--with-don) -> tcg_cards
   only, UPSERT (never deletes; ON CONFLICT updates all but image_url + set_release_date). Ids = feed card_image_id
   (_p1/_r1/_pr1 from the feed), repeat ids get positional `#${seenIds.size}`, promos `${imageId}#promo`, DON `#don`.
   price_usd = feed market_price (>0 else NULL). Nightly: Task Scheduler 2am -> catalog-sync-hidden.vbs ->
   catalog-sync.cmd: sync:en, mtg, lorcana, sync:onepiece (= sync-onepiece.mjs --with-promos --with-don &&
   sync-onepiece-images.mjs), yugioh, mtg-tcgplayer-ids, push-catalog, cardmarket maps, then per game save-pictures
   --prod + push-own-pictures, catalog-nightly-record. THE 2AM RUN USES THE WORKING TREE.
2. sync-onepiece-images.mjs + lib/onepiecePick.mjs: price decides first (same-number product within 15% of the row
   price), then own set by row order, then old pick; writes image_url only (product/<id>_in_1000x1000.jpg; a "stamped"
   pick falls back to Bandai's ref_image_url). No product id stored anywhere. Rows = all but PROMO/DON, ORDER BY id.
3. Prod 5:25am ET cron /api/cron/tcg-prices -> tcgPriceRefresh.ts: One Piece prices come from OPTCGAPI (same feeds),
   tcgcsv only for the "One Piece Promotion Cards" group (folded name + number, one product, one priced subtype ->
   row:true). planTcgRefresh: byRow(id) first, else byPrinting `${id.split("#")[0]}|${set_name}` (same variant, else
   same[0]); a reprint falls back to the original's price; no match = keeps its price. Nothing parses product ids.
4. push-catalog.mjs: tcg_cards INSERT ... ON CONFLICT(id) DO UPDATE all columns (new ids insert), 200 rows/statement,
   price guard COALESCE(NULLIF(local,0),prod); missing Turso columns added automatically; tcgplayer_products compared
   by COUNT ONLY (a changed mapping with the same count never pushes).
5. Schema lib/db.ts: no product-id column; tcgplayer_products(product_id PK, group_id, card_id, game) = Pokemon only
   (22,318 rows). A new tcg_cards column would change every fingerprint = one full resend of all games.
6. Pages: KEY_PATTERN.onepiece /^[A-Za-z0-9]{1,8}-\d{1,4}(?:_[pPrR]\d{1,3})?$/ = any "#" id gets no page/sitemap
   (promos included); %#% filters in server/cardPages.ts, cardSitemap.ts, setCompletion.ts (#promo/#don only),
   onepiece-sets.mjs. The in-app set browser (listTcgSets/tcgCardsBySet) lists every set_code but PROMO/DON and shows
   "#" rows inside a set.
7. Scanner: searchTcgCardsLocal (server/tcgCards.ts) PROMO set +1.25 (+1 promo-only), unread variant +0.25, newest
   set_release_date wins exact ties (stable sort after ORDER BY ... DESC LIMIT 400); tiebreak.ts onePieceTiebreakIds
   (two PROMO rows = no picture call); twin rules exist for Pokemon 1st Ed (penalty 3) and YGO -1st, none for One Piece
   stamps. Printing dropdown = printingChoices (lib/onepiece.ts) over the 24 candidates; labels PRINTING_WORDS.
8. Never re-key: cards.catalog_card_id, wishlist_items.card_id, price_checks, pending_watches, card_removals,
   price_series (card_id, variant, source), price_checked, ebay_asks, listing_lows, pc_products, cardmarket_map.
9. Tests: test:onepiecesets, test:onepieceimages (fixture), test:tcg, test:tcgprices, test:cardpages,
   test:setcompletion; test:pushcatalog is not in npm test.
Risks named by the helper: #tcg rows get no page; the cron's split("#")[0] fallback would give #tcg rows the base
card's price (needs a product-id branch first); linked rows need the same branch or 2am/5am keep flipping; local and
prod must use one price rule (market, then mid up to $20 = askingPrice in mtgTcgplayerFill.ts); 87 tcgcsv /prices
pulls inside the 300 s cron; the images pass would adopt #tcg rows (skip them); fixSetNames renames a set_code to its
majority name (twins need the parent's name or their own code); 24-candidate cap + LIMIT 400 name query can drop old
printings; save-pictures --prod only UPDATEs, so new rows must exist on prod (push-catalog) first.

## Prototype tie (10-25 9:20am, scratchpad tie.mjs, read only)
keep 4,228 picture ties, MOVE 8 (wrong-set pictures: ST21-001_r1, ST11-004, OP12-020_p5, ST11-001, OP03-055_r1,
OP03-057_r1 + Demo Deck 2023 Sanji/Usopp promos), LINK 1,022 (908 promos; prices: 531 same, 218 within 25%, 58 outside,
198 no TCGplayer market), 291 rows untied (184 DON, 47 promos, PRB01/ST reprints the feed names loosely), 20 old
two-rows-one-picture pairs (feed duplicates). ADD pool 1,718 released (EB05/OP18 held): OP-PR 258, PRE/RE/ANN ~75 each,
LT-01 48, OP-RP 33, SD01 30, OP-DD 24, ST-01..04 PRE 17 each. Morning sort bug: "[Winner]"/"[Finalist]" brackets and
extra tags were ignored (22 rows got 2-3 products). Price check: 155 tied rows sit >25% off their own product's market
(32 at $100+; EB02 SP rows e.g. OP08-001_p2 $162.11 vs TCGplayer 629185 market $6,835.94, lowest listing $2,890, no
sales in TCGplayer's latest-sales window) = hand-check before any price moves.
