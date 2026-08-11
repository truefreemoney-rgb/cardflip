# Project state

Last updated: 2026-08-11. Read `CLAUDE.md` first for architecture and traps.

## Where things stand

Everything below is **built, tested, deployed, and verified on production**.

| Area | State |
|---|---|
| Scanning → identify → price → listing | Working end to end |
| English catalogue | Mirrored locally (218 sets, 23,444 cards) — local + production |
| Japanese / Chinese | Mirrored locally, English name overlay on foreign cards |
| eBay comps (asking + sold) | Built, **dormant** — needs credentials |
| Vision card reading + condition grading | Built, **dormant** — needs `ANTHROPIC_API_KEY` |
| Wishlist, price-check history, 3D card viewer, admin dashboard | Working |
| Test suites | `test:ocr` (33), `test:ebay` (34), `test:pricing` (15) — all passing |

Reference case: uploading Base Set Charizard (`base1-4`) resolves to
**Charizard · Base Set · #4 · $818.65 TCGplayer**, quick-sale $719.99, with the
uploaded photo shown beside the match.

## Blocked on someone else

1. **eBay production keyset** — applied for; approval takes up to a business
   day. Unlocks the asking-price average.
2. **Marketplace Insights** — requested *separately* from the keyset in the
   eBay developer console. Unlocks sold prices, which outrank asking prices in
   `pickPrice`, so the suggested price will visibly change when it lands.

## Ready to do, not blocked

3. **`ANTHROPIC_API_KEY`** — instant to obtain; the single highest-value
   remaining action. It replaces the brittle Tesseract chain with one read of
   the card, and is the only thing that resolves the open ambiguity below.

## Known open issue

**Base Set vs. reprint is a coin-flip on OCR alone.** Base Set Charizard and
its Celebrations reprint are both named "Charizard" and both numbered 4. The
only distinguishing feature is the set symbol, which a bottom-band OCR crop
can't see. Currently mitigated, not solved:

- The local mirror ranks by set release date, so the 1999 original wins ties.
- Every candidate has a thumbnail and the uploaded photo sits beside the match,
  so a wrong pick is visible and one click from corrected.

Vision reads the whole card and settles it properly. Don't attempt to fix this
with more OCR heuristics.

## When new Pokémon sets release

```bash
npm run sync:en
flyctl ssh console --app cardflip-superior -C "node scripts/sync-cards.mjs en en_cards"
```

(Wake the machine with a request first — it scale-to-zeros.)

## Suggested next steps

In rough order of value:

1. Add `ANTHROPIC_API_KEY` and verify vision end to end with a real photo —
   check that it reads the set symbol and grades condition sensibly, and that
   `visionStatus` shows "Read from photo" in the editor.
2. When eBay credentials land: verify both comps paths, confirm sold prices
   take over as the pricing basis, and re-check the sold-vs-asking spread copy
   in `MarketMetricsPanel`.
3. Re-run a real-card scan after any change to `ocrText.ts`, `enCards.ts`, or
   the search route — the test suites cover parsing, not the integration.

## Unverified

- The Price Check page's search box didn't register a value when driven
  programmatically during testing. This is likely a test-harness artifact
  (React state vs. synthetic input events) rather than an app bug — it has not
  been reproduced by hand. Worth a manual click-through before assuming it's
  broken *or* fine.
