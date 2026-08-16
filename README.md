# CardFlip

Scan Pokémon and Magic: The Gathering cards, price them against what they're
actually selling for, and turn them into eBay listings.

Next.js 16 (App Router) · TypeScript · Tailwind v4 · `node:sqlite` · Fly.io.
Design system, voice, and motion policy: `docs/DESIGN.md`. Working state and
backlog: `docs/STATE.md`, `docs/BACKLOG.md`. Architecture traps: `CLAUDE.md`.

## Getting started

```bash
npm install
cp .env.example .env.local   # every key is optional; see the file
npm run sync:en              # Pokémon English mirror (~4 MB, a few minutes)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The Magic mirror imports
itself from `seed/mtg-mirror.db.gz` on first boot; see *Card data* to build
that seed.

## What's in it

- **Scanner** (`/app`) — camera or photo, per-card queue, auto-scan, torch,
  Pokémon | Magic toggle, English/Japanese/Chinese Pokémon.
- **Identification** — Claude vision reads name/set/number/language/condition
  from the photo; Tesseract OCR is the fallback. Matching runs against
  **local** SQLite mirrors, never a live API.
- **Pricing** — TCGplayer/Cardmarket via pokemontcg.io (Pokémon) or the
  Scryfall mirror (Magic), plus eBay asking comps (and sold comps once
  Marketplace Insights is approved). Foil/etched printings for Magic.
- **Accounts** — email/password, sessions, per-user ledger, wishlist,
  price-check history, sealed products, graded slabs, password reset, `/admin`.
- **eBay** — "Connect with eBay" (user OAuth, tokens encrypted at rest),
  Inventory-API draft push and publish with the seller's own photo, prelist
  links, and a bulk "eBay drafts" CSV as the no-API path.
- **Site** — landing with live price ticker, `/terms`, `/privacy`, sitemap,
  OG image, installable PWA (manifest + icons).

## Environment

All keys are documented in [`.env.example`](.env.example). Nothing is required
to boot: each integration answers "unconfigured"/503 honestly when its keys
are missing. In production set them as Fly secrets, never commit them:

```bash
flyctl secrets set ANTHROPIC_API_KEY=sk-ant-... --app cardflip-superior
```

Key ones: `ANTHROPIC_API_KEY` (vision), `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`
(+ `EBAY_RU_NAME` for user OAuth), `POKEMONTCG_API_KEY`, `ADMIN_EMAIL`, `SMTP_*`.

## Reading cards with vision

Claude reads the card directly — name, set, collector number, language, and a
condition grade from the same image. It replaced Tesseract as the primary
reader because OCR on Japanese cards returned "反卡乒" for 皮卡丘. Without a
key the scanner falls back to OCR — everything still works, just less
accurately on foreign cards, and no condition grading.

Photos are downscaled to 1024px on the long edge before upload; card text is
legible well below phone resolution and image tokens scale with pixels.

Vision calls cost money, so `/api/vision/scan` is rate-limited per account
(30/min, 500/day; the shared demo login gets 10/min, 60/day). See
`src/lib/server/rateLimit.ts` — the same guard covers eBay comps, public
search, and the sign-in endpoints.

## eBay

**Pricing** needs only an app keyset (Browse API, included with any production
keyset). **Listing** additionally needs user OAuth (`EBAY_RU_NAME`) so the app
can act on the seller's account.

| | API | Access |
|---|---|---|
| **Sold** (90 days) | Marketplace Insights | Separate eBay approval |
| **Asking** (active) | Browse | Any production keyset |
| **Draft / publish** | Inventory | User OAuth via "Connect with eBay" |

Sold prices drive the suggested price when available — asking averages include
cards that never sell. Comps are filtered before averaging (lots, slabs,
proxies, sealed, wrong collector number) then Tukey-trimmed so one moonshot
listing can't drag the average.

Publishing needs the seller's eBay account to have Business Policies and a
location set, and the listing photo must be the seller's own (eBay's picture
policy) — the seller-photo pipeline serves it at `/api/card-image/[id]`.

## Card data

**Identification is local; pricing is live.** Pokémon cards (English,
Japanese, Chinese) are mirrored from [TCGdex](https://tcgdex.dev); Magic
printings (94k) and sets from [Scryfall](https://scryfall.com). pokemontcg.io
was measured failing 5 of 10 requests, so nothing load-bearing depends on it.

```bash
npm run sync:en       # Pokémon English — ~218 sets, ~23,400 cards
npm run sync:jp       # Japanese
npm run sync:zh       # Traditional Chinese
npm run sync:species  # English species names, for the foreign-card overlay
npm run sync:mtg      # Magic — Scryfall, ~6 min (rate-limited; run from a PC, not Fly)
npm run export:mtg    # writes seed/mtg-mirror.db.gz (mirror + Magic price history), imported on boot
npm run backfill:mtg     # one-off: ~90 days of Magic price history from MTGJSON (~380 MB download)
npm run backfill:pokemon # one-off: ~90 days of Pokémon history from TCGCSV archives (needs 7-Zip)
```

Re-run `sync:en` on new Pokémon sets. For Magic, run `sync:mtg && export:mtg`
then deploy — Scryfall 429s Fly's egress IP, so the seed ships with the image.

The English mirror's set release dates rank printings (a scanned "Charizard #4"
is Base Set, not a reprint) and are the join key to pokemontcg.io pricing —
set *names* differ between providers and fuzzy-matching them once priced an
$818 card at $466.

## Price history

Charts come from our own daily snapshots (`price_series`, one compact row per
card/variant/source — `src/lib/priceSeries.ts`): Magic from every `sync:mtg`
(shipped in the seed, backfilled 90 days from MTGJSON), Pokémon from every
fresh pokemontcg.io lookup plus a lazy daily sweep of cards in ledgers and
wishlists, and every mapped Pokémon card daily from TCGCSV (TCGplayer's prices, `tcgplayer_products` map from `backfill:pokemon`). `/api/price-history?cardId=` serves it; `PriceHistoryChart` draws it.

It updates itself once a day (`src/lib/server/dailyJobs.ts`): an hourly
in-process timer, the `/api/auth/me` heartbeat, or `GET /api/cron/daily?key=$CRON_SECRET`
from an external pinger — whichever fires first after 20 h. Magic prices come
from Scryfall's daily bulk file (one CDN download, ~12 s, works from Fly);
`npm run refresh:prices -- --force` runs the same job by hand.

## Tests

```bash
npm test               # all suites
npm run test:ocr       # OCR text cleanup
npm run test:cardnumber
npm run test:ebay      # comps filtering against real listing titles
npm run test:pricing
npm run test:inventory # eBay Inventory payloads
npm run test:mtg
npm run test:ratelimit
npm run test:pricehistory
```

Plain Node scripts under `scripts/test-*.mjs` (`--experimental-strip-types`),
no framework.

## Operating

```bash
npm run admin                                # create an admin locally
node scripts/issue-reset-link.mjs <email>    # password-reset link without SMTP
flyctl deploy --app cardflip-superior        # single machine, volume at /app/data
```

`/admin` unlocks for whoever signs in with `ADMIN_EMAIL`. Data (users, ledger,
photos, eBay tokens, mirrors) is one SQLite file on the Fly volume — back it
up before anything destructive.
