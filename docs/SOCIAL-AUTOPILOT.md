# Social autopilot

Chris (09-10): social media has to be done and he does not want to do it.
So it runs itself. He creates each account once and pastes one token on
the board; after that he never opens a social site. Everything posted is
made from our own data, in the site's voice (docs/SOCIAL.md: plain, dry,
sentence case, no exclamation marks, ends on cardflip.io).

## What exists (09-10, session 23)

| Piece | Where | Status |
|---|---|---|
| Content engine: set spotlight + movers of the week + price drops, per game, from `price_series` | `src/lib/server/social.ts` | shipped |
| Post image, every site size (1080², 1080×1920, 1200×628) | `GET /api/social/image?kind=movers\|card&game=pokemon\|mtg&day=&size=` | shipped |
| Preview page: today's drafts, image at each size, caption + Copy | `/admin/social` (owner only; nav "Social") | shipped |
| Test | `npm run test:social` (in the `npm test` chain) | green |
| Publisher: three posts a day (7am card / 1pm movers / 7pm drops ET), one per slot | `src/lib/server/socialPublish.ts`; runs as the last step of the daily Pokémon cron (`/api/cron/pokemon-prices`, Hobby = two crons) and by hand from `GET\|POST /api/social/publish?key=CRON_SECRET[&force=1][&dry=1][&day=]` | shipped 09-10 |
| Drafts as JSON + site status | `GET /api/social/drafts` (owner cookie or `?key=`) | shipped 09-10 |
| Sites strip on `/admin/social`: connected / last post / Post now | `src/components/admin/SocialSites.tsx` | shipped 09-10 |
| Bluesky adapter (app password, image + alt, link/tag facets, JPEG under 1 MB) | `src/lib/server/sites/bluesky.ts`; env `BLUESKY_HANDLE` + `BLUESKY_APP_PASSWORD` | shipped 09-10, waiting on the password |
| Test | `npm run test:socialpublish` (in the `npm test` chain) | green |
| Meta / X / Pinterest adapters | `src/lib/server/sites/` (one file each, registered in `socialSites.ts`) | next, in reach order below |

### How posting works

- A site is **connected** when its env vars exist on Vercel. Nothing else
  switches it on; `/admin/social` shows the rest as "not connected".
- Three posts a day, Eastern (Chris 09-25, hands off): 7am card of the
  day, 1pm movers of the week, 7pm price drops (`SLOTS` in
  socialPublish.ts). `.github/workflows/social-post.yml` pings
  `POST /api/social/publish?slot=` at each slot's EDT and EST hour with
  the `SOCIAL_POST_KEY` secret (also on Vercel); the publisher picks the
  slot from the Eastern clock when none is given. Pokémon only
  (`socialGames()` follows the game switches).
- Catch-up rule (Chris 09-25: every platform gets the same posts): a run
  posts every slot whose hour has passed today that the site has not
  posted yet, so a site connected at 3pm gets the 7am and 1pm pictures at
  once and a missed ping is made good by the next. A slot with no draft
  (say, fewer than 3 drops) stays quiet instead of repeating another kind.
- Once per slot per site per Eastern day: `settings` key
  `social_slot:<site>:<slot>` = the ET day; `social_last_post:<site>` and
  `…:uris` keep the strip on /admin/social current. `force=1` posts the
  next unposted slot (the Post now button).
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
- **Set spotlight** (7am, replaced card of the day 09-25, Chris: no
  single-card posts, more informative multi-card ones): the five most
  valuable cards of one set with their 7-day move. The set is chosen by a
  hash of the date over every set with ≥ 5 cards worth ≥ $10, so sets cycle
  and every run agrees. Pokémon only (set = card id prefix).
- **QUALITY RULES (Chris 09-25, "highest quality possible", pictures AND
  words)**: (a) a price is only shown as today's when it has held 3 of the
  last 7 days (carry-forward across ≤ 3 missing days); otherwise the week's
  median is shown and NO % is claimed (`Mover.unsettled`; Pikachu Star
  $3,217 → $900 in one day was the trigger). (b) A week-ago price must be a
  real point within 3 days of a week ago, never a month-old one. (c)
  MOVER_MIN_PRICE is $10 (was $3; "$1.83 → $3.10, +69%" is not news).
  (d) 1pm = gainers only, 7pm = drops only, so no card is in both posts.
  (d2) NO-REPEAT: a card in a landed gains/drops post sits out that kind for
  7 days (settings social_featured:<game>:<kind> = {cardId: day}, written by
  the publisher after the post lands; drafts and pictures both read it;
  same-day entries do not count so a re-render stays stable). Chris 09-25
  chose to keep 3/day for volume; this keeps the daily posts fresh.
  (e) ☆/★ in names become the word "Star" (Satori has no glyph; drew a box).
  (f) Set spotlight rows read "#131 · Holo", the heading is the set name on
  one line (long names shrink), art is 126 px. Before changing the engine
  again: render real pictures (local dev: CRON_SECRET=local-dev-only in
  .env.local, `/api/social/image?kind=set&day=…&key=local-dev-only`) and
  read them as a collector would; local price_series has ONE point per card
  (synced once), so locally every card reads "unsettled" and the movers
  posts are empty — that is the local mirror, not prod.
- Card of the day (one card ≥ $15 by date hash) still exists in code
  (`cardOfTheDay`, `?kind=card`) but no slot posts it.
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
3. **Instagram + Facebook + Threads** — adapter DONE 09-25
   (src/lib/server/sites/meta.ts = three sites: facebook, instagram,
   threads, each with its own slot). Env on Vercel prod: META_PAGE_ID +
   META_PAGE_TOKEN (long-lived Page token; also drives Instagram),
   META_IG_USER_ID (IG business account linked to the Page), THREADS_TOKEN
   (Threads has its own token; THREADS_USER_ID optional, /me resolves it). Facebook takes the picture
   as an upload; Instagram and Threads only take a public image URL, so the
   picture is parked on the Vercel Blob store (BLOB_READ_WRITE_TOKEN) for
   the post and deleted after. THREADS LIVE 09-25 (@cardflipio; token pasted by Chris into Vercel;
   long-lived token expires after 60 days, refresh via
   /refresh_access_token before 11-24). FACEBOOK LIVE 09-25 (Page 1314676718400499; META_PAGE_TOKEN is a
   user token from the Explorer, swapped for the Page token at post time).
   INSTAGRAM LIVE 09-25: INSTAGRAM_TOKEN from the "Instagram API with
   Instagram Login" use case (graph.instagram.com, /me, no Page needed;
   60-day token);
   the Page <-> Instagram link is restricted on the new account and not needed.
   TOKEN REFRESH IS AUTOMATIC (09-25): every scheduled publish run ends with
   refreshMetaTokens() (sites/meta.ts), which renews the Instagram Login and
   Threads tokens once a week via GET /refresh_access_token (ig_refresh_token /
   th_refresh_token). The renewed token lives in settings social_token:<site>
   and is only used while it descends from the current env token (fingerprint),
   so pasting a new env token always wins and restarts its clock
   (social_token_refreshed:<site>). A failed refresh keeps the last good token
   and retries next run; the run's report.json carries a `tokens` array. The
   Facebook Page token needs no refresh (a Page token from a long-lived user
   token does not expire); if the user token Chris pasted was the 1-hour kind,
   the first failed Facebook post says so and he re-pastes an extended one.
4. **X** — adapter DONE 09-25 (src/lib/server/sites/x.ts, OAuth 1.0a signed
   with node:crypto, v2 media upload + /2/tweets). LIVE 09-25: @cardflipio,
   four keys on Vercel prod (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN,
   X_ACCESS_SECRET; app permissions Read and write BEFORE generating the
   access token). The free tier is GONE: console.x.com is pay-per-use,
   $0.015 per post created, prepaid credits; Chris bought $5 on 09-25
   (about 330 posts, 3 to 4 months at 3/day), auto-recharge OFF. When the
   balance runs out posts fail with 402 and the Completed line says so.
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
