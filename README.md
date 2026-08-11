# CardFlip

Scan Pokémon cards, price them against what they're actually selling for, and
turn them into eBay listings.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Reading cards with vision

When a photo is scanned, Claude reads the card directly — name, set, collector
number, language, and a condition grade from the same image. This replaces
Tesseract OCR, which was the weak link: on Japanese cards it returned "反卡乒"
for 皮卡丘 (one correct character of three), which is why the CJK lookup needs
fuzzy matching at all.

Needs an API key from [console.anthropic.com](https://console.anthropic.com):

```
ANTHROPIC_API_KEY=sk-ant-...
```

In production:

```bash
flyctl secrets set ANTHROPIC_API_KEY=sk-ant-... --app cardflip-superior
```

Without it the scanner falls back to OCR — everything still works, just less
accurately on foreign cards, and no condition grading.

Photos are downscaled to 1024px on the long edge before upload. Card text is
legible well below phone-camera resolution and image tokens scale with pixels,
so the original would cost several times more per scan for no extra accuracy.

## eBay price comparison

When a card is scanned, CardFlip searches eBay for the same card and prices it
at the average of the comparable listings it finds. That needs eBay API
credentials — without them the app still runs and still links out to the eBay
search for each card, it just falls back to card-market pricing and shows
"eBay pricing isn't connected yet".

To turn it on:

1. Create a free developer account at
   [developer.ebay.com](https://developer.ebay.com/), then make a **Production**
   keyset under *Application Keys*.
2. Copy the **App ID (Client ID)** and **Cert ID (Client Secret)**.
3. Locally, put them in `.env.local`:

   ```
   EBAY_CLIENT_ID=your-app-id
   EBAY_CLIENT_SECRET=your-cert-id
   ```

4. In production, set them as secrets instead — never commit them:

   ```bash
   flyctl secrets set EBAY_CLIENT_ID=your-app-id EBAY_CLIENT_SECRET=your-cert-id --app cardflip-superior
   ```

Only the Browse API scope is needed, which every production keyset has by
default. No eBay account linking or user OAuth is involved — this is
application-level access for reading public listings.

### Sold prices vs asking prices

Two different numbers, from two different eBay APIs:

| | API | Access |
|---|---|---|
| **Sold** (90 days) | Marketplace Insights | Requires separate eBay approval |
| **Asking** (active listings) | Browse | Included with any production keyset |

Sold prices drive the suggested price when available — an asking average tells
you what sellers *hope* for, including the ones whose cards never sell. The UI
shows both side by side, because the gap between them is the useful signal.

Marketplace Insights is requested separately from your keyset in the eBay
developer console. Without it the app prices off asking data and says so; the
"View sold on eBay" link still works (though eBay may ask the seller to sign in
— it gates sold search harder than active search).

### What the averages actually mean

A raw search for a card name is mostly noise, so results are filtered before
averaging — bulk lots, graded slabs, proxies, sealed product, and cards whose
collector number doesn't match are all dropped, then remaining prices are
trimmed with a Tukey fence so one moonshot listing can't drag the average.
The UI reports how many results were filtered out.

```bash
npm run test:ebay
```

exercises that filtering against real eBay listing titles.

## Card data

**Identification is local; pricing is live.** Every card — English, Japanese,
Chinese — is mirrored from [TCGdex](https://tcgdex.dev) into SQLite, so
identifying a scan never depends on a third party being up. Prices are layered
on afterwards from [pokemontcg.io](https://pokemontcg.io) and eBay, and are
allowed to fail on their own.

That split exists because pokemontcg.io was measured failing **5 of 10
requests**, which used to fail scans outright on perfectly good photos. It's
still the best English price source; it just can't be load-bearing for
identification.

```bash
npm run sync:en       # English cards — 218 sets, ~23,400 cards, ~4 MB
npm run sync:jp       # Japanese cards
npm run sync:zh       # Traditional Chinese cards
npm run sync:species  # English species names, for the foreign-card overlay
```

Re-run `sync:en` when new sets release. The English mirror also carries set
release dates and card images, which do two things the price API can't:

- **Rank printings.** A scanned "Charizard #4" is Base Set (1999) rather than
  one of its reprints, ranked by release date.
- **Join to pricing safely.** Providers name sets differently — TCGdex's
  "Base Set" is pokemontcg.io's "Base" — and fuzzy name matching silently
  paired it with "Base Set 2", pricing a $818 card at $466. Release dates
  agree exactly across both sources, so they're the join key.

## Admin

```bash
npm run admin
```

creates the admin account, which unlocks `/admin`.
