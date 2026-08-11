# CardFlip

Scan Pokémon cards, price them against what they're actually selling for, and
turn them into eBay listings.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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

### What the average actually means

eBay's Browse API exposes *active* listings, so the number is an average of
current asking prices, not completed sales. (Sold-price data lives behind
eBay's Marketplace Insights API, which requires separate approval.)

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

English cards come from [pokemontcg.io](https://pokemontcg.io). Japanese and
Chinese cards come from [TCGdex](https://tcgdex.dev), mirrored into local
SQLite because its name search doesn't work for those locales:

```bash
npm run sync:jp       # Japanese cards
npm run sync:zh       # Traditional Chinese cards
npm run sync:species  # English species names, for the foreign-card overlay
```

## Admin

```bash
npm run admin
```

creates the admin account, which unlocks `/admin`.
