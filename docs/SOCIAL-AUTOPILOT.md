# Social autopilot

Chris (09-10): social media has to be done and he does not want to do it.
So it runs itself. He creates each account once and pastes one token on
the board; after that he never opens a social site. Everything posted is
made from our own data, in the site's voice (docs/SOCIAL.md: plain, dry,
sentence case, no exclamation marks, ends on cardflip.io).

## What exists (09-10, session 23)

| Piece | Where | Status |
|---|---|---|
| Content engine: movers of the week + card of the day, per game, from `price_series` | `src/lib/server/social.ts` | shipped |
| Post image, every site size (1080², 1080×1920, 1200×628) | `GET /api/social/image?kind=movers\|card&game=pokemon\|mtg&day=&size=` | shipped |
| Preview page: today's drafts, image at each size, caption + Copy | `/admin/social` (owner only; nav "Social") | shipped |
| Test | `npm run test:social` (in the `npm test` chain) | green |
| Publisher: posts every draft to every connected site, once a day, Tue/Thu/Sat | `src/lib/server/socialPublish.ts`; runs as the last step of the daily Pokémon cron (`/api/cron/pokemon-prices`, Hobby = two crons) and by hand from `GET\|POST /api/social/publish?key=CRON_SECRET[&force=1][&dry=1][&day=]` | shipped 09-10 |
| Drafts as JSON + site status | `GET /api/social/drafts` (owner cookie or `?key=`) | shipped 09-10 |
| Sites strip on `/admin/social`: connected / last post / Post now | `src/components/admin/SocialSites.tsx` | shipped 09-10 |
| Bluesky adapter (app password, image + alt, link/tag facets, JPEG under 1 MB) | `src/lib/server/sites/bluesky.ts`; env `BLUESKY_HANDLE` + `BLUESKY_APP_PASSWORD` | shipped 09-10, waiting on the password |
| Test | `npm run test:socialpublish` (in the `npm test` chain) | green |
| Meta / X / Pinterest adapters | `src/lib/server/sites/` (one file each, registered in `socialSites.ts`) | next, in reach order below |

### How posting works

- A site is **connected** when its env vars exist on Vercel. Nothing else
  switches it on; `/admin/social` shows the rest as "not connected".
- Post days: Tue / Thu / Sat (UTC weekday), from docs/SOCIAL.md. The
  cron runs daily; other days the publisher answers "not a post day".
- Once per day per site: `settings` key `social_last_post:<site>` = the
  day; `…:uris` = the post links. `force=1` re-posts (the Post now button).
- Text is fitted to the site's limit: caption + hashtags → caption alone →
  `shortCaption` (name + % only) → cut on a line with `cardflip.io` kept.
- Picture: the square PNG from `/api/social/image` (fetched from the same
  deployment with the cron key), turned into a JPEG when the site caps
  bytes (Bluesky: 1 MB).
- Every run that posted or failed leaves one line on the board's
  Completed list ("Social autopilot 2026-09-10 — Bluesky: … → link").
- A social failure never fails the price cron; it lands in the cron's
  JSON as `social.error`.

### Content rules

- **Movers**: the 5 biggest |%| moves over 7 days among cards worth ≥ $3
  on either end; series must have been updated in the last 3 days; the
  preferred variant per card (normal → holofoil → reverse). Fewer than 3
  movers = no post that day.
- **Card of the day**: one card worth ≥ $15, chosen by a hash of the date
  over the fresh pool — same pick for every viewer and every run, cycles
  instead of repeating the top card.
- Art: TCGdex WebP → PNG through sharp, pokemontcg.io PNG twin as the
  fallback (lib/cardArt.ts). Scryfall JPG passes through.
- One Turso read per call, capped at 6,000 series rows per game.

### Auth on the image route

Owner cookie (the preview page) or `?key=CRON_SECRET` (the publisher).

## Plan, image sites only

Chris (09-10): "we are not video content creators." Every post is a
picture made from data. No YouTube, no TikTok, no Reels — nothing that
needs a video. Order = easiest to connect first, then reach.

1. **Publisher** — DONE 09-10, inside the app (not a cloud routine: the
   pictures, the DB and sharp are all here, and the daily cron already
   fires). See "How posting works" above.
2. **Bluesky** — adapter DONE 09-10; app password from Chris, one paste,
   then the two env vars on Vercel. Free API, image posts with alt text.
   First because it is the cheapest connection.
3. **Instagram + Facebook + Threads** through one Meta app: IG business
   account linked to a Facebook page, one "Allow" → long-lived token;
   Graph API image posts, Threads API text+image. Biggest reach for card
   pictures.
4. **X** — free tier (1,500 posts/mo, image upload OK). Chris creates the
   developer app once and pastes the keys.
5. **Pinterest** — pins = the movers image + a link to cardflip.io; good
   for search. Business account + app access.
6. **LinkedIn / Reddit** — only if free and one-time; Reddit stays human
   (communities punish bot promo).

## Chris's part, one row at a time on the board

Create the account (handle `cardflipio`, assets from docs/SOCIAL-KIT.md at
cardflip.io/social/), then either press one "Allow" link I send or paste
the token/app password as a reply on the row. Nothing else, ever.

## Not doing

- No hand-written posts, no scheduling tool subscription, no engagement
  farming (replies/DMs stay human or not at all).
- No posting from the helper login; the publisher is a routine.
