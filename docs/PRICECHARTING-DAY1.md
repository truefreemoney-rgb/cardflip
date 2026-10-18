# PriceCharting: day-1 runbook (written 10-18, before the subscription)

Decision (Chris 10-17): PriceCharting is the FINALE. Build first, subscribe after, day 1 = key in, import, re-score,
screenshots, push. Terms: display OK until $1,000/month revenue (then a cut); attribution = a text link to
https://www.pricecharting.com/game/<id>; purge all their data if the subscription ends.

## Built (10-18, commit only)
- `src/lib/pricecharting.ts`: CSV/API row reader, product-name tags, and `planPcImport` (product -> our card + variant).
  - Pokémon: tcg-id -> `tcgplayer_products`; tags pick the variant: none = the card's one plain printing,
    `[Reverse Holo]`, `[1st Edition]` (-1st twin), ball / Energy Symbol / Team Rocket patterns, `[Holo]` for
    normal+holo cards. Any other tag (Shadowless, Staff, Prerelease...) = another printing, skipped.
  - Magic: tcg-id -> Scryfall uuid (`data/mtg-tcgplayer-ids.json`, rebuilt nightly on Chris's PC); `[Foil]` / `[Etched]`.
  - Yu-Gi-Oh: `ygo-<tcg-id>`, `[1st Edition]` -> `ygo-<tcg-id>-1st`.
  - Lorcana / One Piece: NOT matched yet (we store no TCGplayer id for them). Next: match by set + number + name.
  - Only writes onto a variant the card already has a TCGplayer series for; everything unsure is counted, never guessed.
- `scripts/import-pricecharting.mjs`: download/read the CSV, match, write today's ungraded price to
  `price_series` source `pricecharting` (our own history) + `pc_products` (PC id for the link, yearly sales, grade 9 / PSA 10).
  `--dry` prints the match counts; `--prod` needs `--fenced`.
- Fence: every reader that takes "any USD series" skips `pricecharting` (priceHistory.ts x4, enCards.ts), pinned by
  `npm run test:pricecharting`. So importing changes NO screen until the switch below.
- `scripts/pc-rescore.mjs`: the 10-17 eBay sold sample (94 cards) re-scored with the imported numbers. Bar: 78%.

## Day 1 (after Chris subscribes; ~1 hour)
1. Chris: pricecharting.com > Subscriptions > API/Download. Copy each CSV link (Pokémon, Magic, Yu-Gi-Oh) into
   `.env.local` as `PRICECHARTING_CSV_URL_POKEMON` / `_MTG` / `_YUGIOH` (contains his token: never in git). Max one CSV call per 10 min.
2. Me: `--dry` per game: read the match counts (matched / skipped by reason). Fix matching if "other printing" or
   "ambiguous" is large; look at 20 random matches by eye against pricecharting.com.
3. Me: import locally, `node scripts/pc-rescore.mjs`: PC-first as built must beat 78% overall and not lose any game.
4. Me: the reader fence commit must be live (it rides the next push), then import with `--prod --fenced`.
5. Me: the PC-first switch (NOT built yet, needs real rows to build against):
   - card pages: headline + chart from the fresh `pricecharting` series when there is one; label "PriceCharting"
     linked to `pcProductUrl(pc_id)`; "Based on N sales this year" from `pc_products.sales_volume`;
   - search / scanner (`listing.ts pickPrice`), Inventory (`livePrices.ts`), Watchlist, social posts: the same number;
   - guard: PC number with few sales (< ~3/yr) keeps the TCGplayer fallback; hand eBay checks (price_checked) still win.
   - phone screenshots + Chris's yes, then push.
6. Nightly: add the import to `scripts/catalog-sync.cmd` (Chris's PC, after the Magic id file is rebuilt), one game
   per 10 minutes.
7. If the subscription ever ends: `DELETE FROM price_series WHERE source = 'pricecharting'; DELETE FROM pc_products;`
