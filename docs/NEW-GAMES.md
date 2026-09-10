# New games: Disney Lorcana and One Piece (09-10)

Chris, 2026-09-10 night: after Pokémon and Magic, "One Piece and Lorcana,
then sports — no time like the present, start when you want; don't bother
me unless it's a huge change." Same bar as the other two games: 98%+
first-try identification on a clear photo, proven on a catalog-image panel
first (no cards on hand), then on his phone batch.

## Sources

| Game | Source | What it gives | Sync |
|---|---|---|---|
| Lorcana | Lorcast, `https://api.lorcast.com/v0` (free, no key) | 25 sets, 3,198 cards; images small/normal/large (AVIF); TCGplayer USD + foil; set code, collector number, version line, rarity (Enchanted = the alt printing above the set total) | `npm run sync:lorcana` |
| One Piece | optcgapi.com (free, no key, "go easy") | 58 sets incl. starter decks, 4,280 entries; JPEG images; daily market price; card id `OP01-077`; parallels / alt arts / manga / box toppers as separate entries with `_p1` image ids and "(Parallel)" name tags | `npm run sync:onepiece` (3 bulk calls) |

Both land in one table, **`tcg_cards`** (src/lib/db.ts): id, game, name,
subtitle, set_code, set_name, collector_number, set_total, release date,
rarity, variant, image_url, price_usd, price_usd_foil, art_hash. Prod gets
it through `scripts/push-catalog.mjs` (it is in CATALOG_TABLES).

## The read

`TCG_READ_SCHEMA` (vision.ts) = the Pokémon schema + `subtitle` (Lorcana's
version line) + `variant` (standard / parallel / enchanted / alt-art / manga
/ box-topper / full-art / special). One prompt per game: `SYSTEM_LORCANA`
(name + version separately; "42/204 · 1" → number 42, total 204, set 1;
enchanted numbers above the total) and `SYSTEM_ONEPIECE` (the whole id
"OP01-077" in cardNumber, the prefix in setCode, no denominator; parallels
told by the picture, not the rarity letters). The second look and the
picture tiebreak run unchanged; `toClaudeImage` re-encodes AVIF to JPEG.

## The ranker

`searchTcgCardsLocal` (src/lib/server/tcgCards.ts): exact name + number
first, then set (Lorcana set number / One Piece prefix) at 4, denominator at
3, version line at 3, variant at 1–2 (seen variant lifts its row; nothing
seen nudges the plain print), unpriced rows last, newest on a tie; rankScore
on every result so base vs parallel with nothing seen is a near-tie the
picture settles. Pinned in `scripts/test-tcg.mjs` (24 checks).

## Plumbing touched

types.ts GameId; games.ts GAMES / GAME_IDS / isGameId / displayCardNumber;
settings.ts per-game public flags (`<game>_public`, Magic keeps
`magic_public`) + `gameFeaturesFor`; /api/auth/me `features` map;
GameToggle hides games the viewer may not see; admin Switches page has a
row per game; /api/admin/settings takes `{ games: { lorcana: true } }`;
/api/search-card branches on `isTcgGame`; PrintedNumber carries
`subtitle` / `variant` from the read through the client; the scanner page
uses `parseGame` instead of a Pokémon/Magic ternary; social labels/tags.

## Panels

`npm run tcg:panel -- --game lorcana|onepiece [--pick] [--bucket x] [--fresh] [--yes] [--no-tiebreak]`
— buckets per game (Lorcana: standard, enchanted, promo, same name /
different version, reprints; One Piece: booster, starter, EB/PRB,
parallel / alt art, manga / special / full art, reprint, same name /
different id). Cost guard as the other panels.

## Numbers

Filled per run below.
