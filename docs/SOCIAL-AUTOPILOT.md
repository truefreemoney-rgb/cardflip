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
| Publisher routine (cloud, scheduled) | — | next |
| Per-site adapters | — | next, in reach order below |

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

1. **Publisher routine** — a cloud routine on the `cardflip-runner`
   environment, once a day (Tue/Thu/Sat cadence from docs/SOCIAL.md to
   start), calls a small `GET /api/social/drafts` (same auth as the image
   route), fetches each image, posts to every connected site, writes
   `social_last_post:<site>` to the settings table so a day never posts
   twice, and leaves a line on the board's Completed list.
2. **Bluesky** — app password from Chris, one paste. Free API, image
   posts with alt text. First because it is the cheapest connection.
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
