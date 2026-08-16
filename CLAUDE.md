@AGENTS.md

# CardFlip

Scan Pokémon cards → identify → price → generate an eBay listing.
Next.js 16 (App Router) · TypeScript · Tailwind v4 · `node:sqlite` · Fly.io.

Live: https://cardflip-superior.fly.dev (app `cardflip-superior`, region `iad`)
Current state and next steps: **`docs/STATE.md`** — read it before starting work.

---

## The one architectural rule

**Identification is local. Pricing is live.**

Every card (en/ja/zh) is mirrored from TCGdex into SQLite. Identifying a scan
never touches the network. Prices are layered on afterwards from pokemontcg.io
and eBay, and are *allowed to fail* — a card still identifies without them.

This exists because pokemontcg.io was measured failing **5 of 10 requests**,
which used to fail scans outright on good photos. Don't reintroduce a
dependency on it for identification.

---

## Traps that have already caused real bugs

Each of these was a shipped bug found by testing with a real card. Don't
re-derive them.

| Trap | Rule |
|---|---|
| **Set names are not a join key.** TCGdex "Base Set" is pokemontcg.io "Base", and prefix-matching pairs it with "Base Set 2" — priced an $818 card at $466. | Join on **collector number + set release date**. Dates agree exactly across providers (`1999-01-09` / `1999/01/09`). |
| **Caching a priceless result** pins a transient upstream outage in place for the whole TTL. | Only `putCachedCards` once pricing actually attached. |
| **Cached rows are serialized cards**, so adding a field leaves them structurally stale in a way the TTL can't see. | Bump `CACHE_VERSION` in `lib/server/cardCache.ts` on any change to the cached shape. |
| **Cardmarket quotes EUR**; the listing is USD on eBay US. Rendering € as $ once put a €4,184 figure one click from becoming the asking price. | Currency travels on `CardPrice`. Only USD can set a listing price (`canPriceListing`). Render with `formatMoney(value, currency)`. |
| **OCR noise words were rejected, never stripped** — "b Hp Charizard" went to the API verbatim and matched nothing. | Strip furniture/debris; see `lib/ocrText.ts`. |
| **OCR reads "/" as 7/1/l/I** — "4/102" arrives as "47102", losing the collector number. | Strict slash first, then a loose pass requiring a non-zero-leading denominator. |
| **A collector number is only unique inside its own set.** Name + number alone is ambiguous for **1,306 keys / 2,890 cards** in the mirror — "Charizard #4" is both Base Set (~$818) and Base Set 2 (~$466). | Carry the *whole* printed fraction. The denominator is a set fingerprint (4/102 vs 4/130) and settles **94.3%** of those collisions. `lib/cardNumber.ts`. |
| **The set total must rank, never filter** — it rides on the same misread slash. | Penalties in `enCards.ts` stay below one name tier, so a bad denominator can only reorder candidates, not erase them. Agreement is three-valued: `unknown` ≠ `mismatch`. |
| **Indexing a column added by an `ALTER` probe** fails inside the same `db.exec` as `CREATE TABLE IF NOT EXISTS` — the CREATE is a no-op on an existing table, so the column isn't there yet. | Create such indexes *after* the ALTER loop. Bit both `db.ts` and `sync-cards.mjs`. |
| **Raw eBay results are mostly not the card** — bulk lots, graded slabs, proxies, sealed product. Averaging blind describes nothing. | Filter (`lib/ebayComps.ts`) then trim outliers with a Tukey fence. |
| **TCGdex name-search returns `[]` for `ja` and `zh-tw`** even for exact names. | Those locales search the local mirror only. Verified directly — don't retry it. |
| **Fetching newest-N and ranking client-side can't find old cards.** A 1999 Charizard is ~100 results deep. | Rank from the local mirror, or fetch a large page before ranking. |
| **MTG names carry commas** ("Ragavan, Nimble Pilferer") and a typed/read query usually doesn't — a plain LIKE misses. | `mtgCards.ts` compares `REPLACE(name, ',', '')` on both sides. |
| **MTG: the same name is reprinted across dozens of sets** — name alone never identifies a printing, and a collector-number coincidence in another set is common. | The printed **set code** is decisive: a code mismatch costs more than a whole name tier (9 > 8) in `searchMtgCardsLocal`. Carry `setCode` from vision / `parseMtgQuery` everywhere. |
| **Everything game-specific lives in `lib/games.ts`** (words, eBay aspects, sealed types, finish labels). eBay's CCG categories are shared by every game — 183454 for singles — the game is an item specific, not a category. | Add per-game facts to the registry; don't sprinkle `if (game === "mtg")` through components. `gameOf(card)` defaults to Pokémon so old rows keep working. |

---

## Commands

```bash
npm run dev
npm run build

npm run sync:en        # English mirror — 218 sets, ~23.4k cards, ~4 MB. Re-run for new sets.
npm run sync:jp        # Japanese
npm run sync:zh        # Traditional Chinese
npm run sync:species   # English species names (foreign-card overlay)

npm run test:ocr        # OCR name parsing — pins the "b Hp Charizard" bug
npm run test:cardnumber # the printed fraction — pins "47102" and the 4/102 vs 4/130 split
npm run test:ebay       # eBay comp filtering + trimmed average
npm run test:pricing    # currency handling — pins the €/$ bug

npm run admin          # create the admin account (unlocks /admin)
```

Tests are plain Node scripts using `--experimental-strip-types`, so pure logic
lives in modules free of browser/server-only imports (`ocrText.ts`,
`ebayComps.ts`) specifically to stay testable. Keep it that way.

## Verifying a change

**Test with a real card image, not a blank one.** Three of the four scanner
bugs were invisible in code review and only appeared with a genuine photo:

```bash
curl -s https://images.pokemontcg.io/base1/4_hires.png -o public/__t/c.png
# upload it via the file input in the browser, then delete public/__t
```

Base Set Charizard (`base1-4`) is the reference case: it should resolve to
**Charizard · Base Set · #4 · ~$818 TCGplayer**, not a reprint.

Before shipping: `npx tsc --noEmit`, `npx eslint src`, the three test suites,
`npm run build`.

## Deploying

```bash
flyctl deploy --app cardflip-superior
```

The Fly machine scale-to-zeros — **wake it with a request before `flyctl ssh`**
or you get "no started VMs". Production DB is at **`/app/data/cardflip.db`**
(the mounted volume), *not* `/data`. After deploying a schema/mirror change,
re-run the sync on production:

```bash
flyctl ssh console --app cardflip-superior -C "node scripts/sync-cards.mjs en en_cards"
```

## Environment (Windows)

- `flyctl` → `PATH="/c/Users/Chris/AppData/Local/Microsoft/WinGet/Links:$PATH"`
- `node`/`npm` → `PATH="/c/Program Files/nodejs:$PATH"`
- Git Bash mangles `/`-prefixed args — use `MSYS_NO_PATHCONV=1` for `flyctl ssh -C`
- `flyctl ssh` prints `Error: The handle is invalid.` **after succeeding** — a
  benign Windows artifact. Check the output above it before believing a failure.
- Don't write to `/tmp` from `node -e` — it resolves to `C:\tmp` and fails.

---

## Credential-gated features (built, deployed, dormant)

All three degrade cleanly and need **no code change** to activate.

| Feature | Secret | Fallback while dormant |
|---|---|---|
| Vision card reading + condition grading | `ANTHROPIC_API_KEY` (instant, console.anthropic.com) | Tesseract OCR |
| eBay asking-price average | `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | card-market pricing |
| eBay **sold**-price average | Marketplace Insights approval on the same keyset | asking-price average |
| "Connect with eBay" (user OAuth, `lib/server/ebayAuth.ts`) | keyset + `EBAY_RU_NAME` (the RuName eBay assigns to the registered callback `/api/ebay/callback`) | /connect-ebay shows honest "not live yet" copy; `/api/ebay/connect` 503s |
| Account-deletion endpoint validation | `EBAY_VERIFICATION_TOKEN` (32–80 chars, we choose it) | GET challenge 503s |

`EBAY_TOKEN_KEY` is optional — user tokens are AES-GCM encrypted at rest with
a key derived from the client secret unless it's set. `redirect_uri` in the
authorize URL is the RuName, **not** a URL. The demo account can never link
eBay (`isDemoUser`) — it's shared.

```bash
flyctl secrets set ANTHROPIC_API_KEY=... --app cardflip-superior
```

When a user reports **"pricing looks wrong"** or **"foreign cards aren't
recognized"**, check which secrets are set *before* investigating — the
fallback paths are the likeliest explanation.

## Data sources

- **TCGdex** (`api.tcgdex.net`) — the catalogue, all languages. Free, no key.
- **pokemontcg.io** — English prices only. Unreliable; never load-bearing.
- **eBay Browse / Marketplace Insights** — asking and sold comps.
- **PokeAPI** — English species names for the foreign-card overlay.
- **Scryfall** (`api.scryfall.com`) — Magic: The Gathering catalogue AND
  prices (USD nonfoil/foil/etched from TCGplayer, EUR from Cardmarket), one
  row per paper printing, mirrored into `mtg_cards` + `mtg_sets` by
  `npm run sync:mtg` (paginated search, ~540 pages, ~6 min from a home IP;
  the bulk file is too big for the Fly machine's memory). Prices refresh on
  every sync — there is no live MTG price call. **Scryfall 429s Fly's egress
  IP** (seen 08-16, retries never clear), so the sync does NOT run on the
  machine: `npm run export:mtg` packs the local mirror into
  `seed/mtg-mirror.db.gz` (~9 MB, shipped in the image) and `db.ts`
  imports it on boot when the volume's copy is empty/older. Refresh =
  `npm run sync:mtg && npm run export:mtg && flyctl deploy`.
- **Scrydex was evaluated and rejected**: their robots.txt disallows ClaudeBot
  and they have a paid official API, so scraping was both unnecessary and
  against their stated wishes. Don't revisit it as a scrape target.

## Conventions

- Comments explain *why*, especially where a non-obvious constraint forced the
  shape. Don't narrate what the code does.
- Degrade, don't fail: a missing price, image, or credential should never
  break identification.
- Error messages should name the real cause — "card lookup is down" when the
  provider is down, not "try another photo".
