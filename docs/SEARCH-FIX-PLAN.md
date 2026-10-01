# Typed search: bugs found 10-01 and the fix plan (SHIPPED 10-01, session 85: all four steps; `npm run search:typed -- --per 150` = 0 misses)

Chris 10-01 ~6:15pm ET: "check the search and watchlist features for similar bugs to nami or any bugs at all, for all games; any change to the search in Search Cards should also affect the Watchlist search and vice versa."

## What exists

- Search Cards = `src/app/app/price-check/page.tsx`, Watchlist = `src/app/app/wishlist/page.tsx`. Both already call the SAME `searchTyped()` (`src/lib/cards.ts`) and the same `SetBrowser`, so a parsing fix lands in both (and in ScannerSearch + CardEditor). The backlog row "Search cards results in the Watchlist tile; Watchlist gets By set" was ALREADY built (CardTile on Search, By Set on Watchlist): tick it.
- What is still duplicated: each page has its own handleSearch, mode pills ("By name / By set" on Search, "By Name / By Set" on Watchlist: Title Case wins), sort list (Search: set / price / rarity / name + a filter box; Watchlist: match / price / Set A-Z, no filter box), results header and Clear button.
- Harness: `npm run search:typed` (`scripts/typed-search-check.mjs`), needs `npm run dev` on :3000. Types real queries for every game through searchTyped + the real route. No vision, no spend. Flags: `--game`, `--per`, `--show`.

## Harness result before any fix (60 cards a game)

| Game | Passes | Misses |
|---|---|---|
| One Piece | name+number, lowercase, number only, name only, no punctuation+number | number without the dash ("OP01041") 0/60 |
| Yu-Gi-Oh | name+number, lowercase, number only, name only | name typed without punctuation 8/27 ("Miracles Wake", "Raidraptor Call", "D D Defense Soldier") |
| Lorcana | name+number/total, name only, number only | "name - version" 0/43, "name version" 0/43 ("rapunzel creative captor"), no punctuation 4/24 |
| Magic | name only | lowercase set code 0/60 ("forest blb 280"), "SET number" alone 0/60 ("BLB 280"), set codes that start with a digit (40K, 2ED, 2XM, 10E), PLST numbers ("2XM-77"), no apostrophe ("Thespians Stage") |
| Pokemon | number/total only | lettered numbers 6 misses ("Nidoking H18", "Falinks V SV115", "Ash's Pikachu SM110", TG23, SWSH146), bracket names ("unown [o]" returns Unown O 70, a different card), no apostrophe / accent ("Ashs Pikachu", "Poke Ball") |

## Fix plan (designed, nothing below is written except looseName.ts)

1. **Server, all games: punctuation-blind fallback.** `src/lib/server/looseName.ts` is written (squash + squashSql, a full walk, so it runs LAST and only when the indexed tiers found nothing).
   - `tcgCards.ts` searchTcgCardsLocal (Lorcana / One Piece): when rows are still empty after the wide tier, walk `squashSql("name || ' ' || subtitle") LIKE %squash(name)%`; rows whose squashed name+subtitle equals the needle count as exactName. This also fixes Lorcana "name - version".
   - `tcgCards.ts` searchYugioh: same on `name` when rows are empty.
   - `mtgCards.ts`: when rows are empty after the wide tier (before the nameMisread block), walk the squashed name; keep those ids in a set so the name gate (`return Infinity`) lets them through (tier 1 when the squashed front face equals the needle, else 3).
   - `enCards.ts`: when rows are empty (or no row carries the number) after the wide tier, walk the squashed name; equal squashed name = exactName.
   - Route: Pokemon passes the sanitized name (brackets stripped) to the mirror; pass a mirror name that keeps brackets to searchEnglishCardsLocal AND to the cache key (else "Unown [O]" and "Unown O" share a cache row).
2. **Client parsing (`lib/cards.ts` searchTyped, `lib/cardNumber.ts`, `lib/games.ts`).**
   - Pokemon: a trailing lettered token (`[A-Za-z]{1,5}\d{1,3}`) after a name is the number; when it finds nothing, search the whole text as a name.
   - Magic: rewrite parseMtgQuery: number = the LAST number-like token (digits + at most one letter or a star, a fraction, or PLST "2XM-77"); set code = the token next to it. Strict pass = uppercase code that may start with a digit (`40K`, `2XM`); when strict finds nothing, a loose pass takes a lowercase neighbour as the code. "SET number" with no name is allowed.
   - One Piece: "OP01041" -> "OP01-041", "P117" -> "P-117". Yu-Gi-Oh: "LOBEN005" / "LOB005" -> with the dash (prefix must hold a letter).
3. **One shared search UI.** A `useCardSearch` hook + `CardSearchBox` / `CardSearchResults` components used by both pages (game toggle, By Name / By Set, input, SetBrowser, error, title, filter box, one sort list: default / price high / price low / rarity / name / Set A-Z, Clear). Pages keep only their own tile (Search opens the price modal, Watchlist adds) and the Watchlist's "From a photo" button.
4. Add shapes to the harness (One Piece and Magic "no punctuation, name only"), re-run all five games to all PASS, add the cases to test:tcg / test:mirror, check both pages at 375px as the local trial account, tick the BACKLOG row, push HEAD:main.
