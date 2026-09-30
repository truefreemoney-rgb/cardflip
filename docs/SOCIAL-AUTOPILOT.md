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
- Three posts a day, Eastern (Chris 09-25, hands off; 09-26, morning
  switched to movers so the video has something to rank): 7am movers of
  the week (video), 1pm set spotlight, 7pm price drops (`SLOTS` in
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
- Same-day dedupe BY KIND (09-26, the day the slot→kind mapping changed):
  `settings` key `social_kind:<site>:<kind>` = the ET day, written
  alongside the slot key. If a slot's kind already went out today for a
  site (under its old slot, or a re-post), the next kind in the rotation
  movers → set → dips → movers that the site has not posted today runs
  instead. A slot never skips for this reason — if every kind is already
  posted today (or has no draft), the slot's own kind repeats.
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
- **Set spotlight** (1pm since 09-26, replaced card of the day 09-25, Chris:
  no single-card posts, more informative multi-card ones; moved off 7am so
  the morning video could show movers instead): the five most valuable
  cards of one set with their 7-day move. The set is chosen by a hash of the
  date over every set with ≥ 5 cards worth ≥ $10, so sets cycle and every
  run agrees. Pokémon only (set = card id prefix).
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
  again: render real pictures (local dev: CRON_SECRET=<local value, see .env.local> in
  .env.local, `/api/social/image?kind=set&day=…&key=<local value, see .env.local>`) and
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

## Video (09-25, Chris reversed the no-video rule; 09-26, morning switched
## to movers)

The 7am slot goes out as a 9:16 MP4 on every connected site; 1pm set
spotlight and 7pm drops stay pictures for now (variety). The video follows
`SLOTS.morning.kind` (movers since 09-26, Chris: "pick cards that are the
biggest movers and shakers"), ranked No.5 → No.1 by % gain, gainers only,
same `topMovers` quality floors (MOVER_MIN_PRICE, HELD_DAYS) and no-repeat
exclusion the movers post uses — never a junk mover.

- **Render**: `scripts/social-video.mjs` draws the same `topMovers()` gainers
  the movers post would show, as a 1080x1920 HTML scene, steps it frame by
  frame in headless Chromium, ffmpeg stitches H.264 + the backing track
  (`public/social/audio`, ours, synthesized by `scripts/social-audio.mjs`,
  0.5s fade-out). Timeline math lives in `lib/socialVideo.ts`
  (`test:socialvideo`).
- **Text always matches the video** (09-26: a caption once said "Mysterious
  Treasures" over Base Set 2 art, because the picture and the video each
  computed their own card list at a different moment — the render runs
  hours before the post, and the eligible-set/mover list can shift between
  the two). The render job freezes the EXACT cards it drew into the
  registered row (`VideoSpec.cards`, cardId/name/number/setName/variant/
  from/to/pct) and `kind`. `parseVideoSpec` accepts rows with or without
  `cards` (older rows). The publisher rebuilds the post caption from
  `spec.cards` when a video is registered for that draft, instead of
  computing fresh; with no registered video it computes at post time as
  before, so the picture and its caption still agree.
- **Where**: the `video` job in `.github/workflows/social-post.yml`, pinged
  from 10:30am ET for the 1pm post (09-27; the `tiktok` job below now makes
  tomorrow's the evening before, so these pings usually find it done)
  (Chromium + ffmpeg do not fit a Vercel function). Secrets
  `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN` are on
  the repo. `--register` parks the MP4 on Vercel Blob
  (`social/video/<game>-<kind>-<day>.mp4`) and writes settings row
  `social_video:<game>:<kind>:<day>` (`videoKey`, kind = `SLOTS[VIDEO_SLOT].kind`, movers);
  `--skip-if-done` makes the second cron ping and the 7am fallback render a
  no-op. Run workflow with `video=1` re-renders today's.
- **Publish**: `publishSocial()` reads that row for each draft, fetches the
  MP4 once, hands it to every site with `postsVideo`, sites run in parallel
  (Meta polls for minutes; route `maxDuration` 300). A video upload that
  throws falls back to the picture in the same run: the slot still counts,
  the report and the board line say `(picture, video failed)`.
- **Adapters**: Bluesky `getServiceAuth` (aud = the account's own PDS) →
  `video.bsky.app uploadVideo` → poll `getJobStatus` → `app.bsky.embed.video`.
  X v2 chunked `initialize → append → finalize → STATUS` (v1.1 command form
  as the fallback), `tweet_video`. Facebook `/{page}/videos file_url=`.
  Instagram `media_type=REELS video_url=` + `share_to_feed`. Threads
  `media_type=VIDEO video_url=`. Meta pulls straight from the Blob URL, so
  nothing is parked for video.
- **Admin**: `/admin/social` shows the registered MP4 in a `<video>` on the
  draft (Video tab, default when one exists).
- **TikTok** (09-26 → 09-30): was a video-only API adapter; it left the
  autopilot on 09-30 and is posted by hand. See "TikTok by hand" below.

## TikTok by hand (Chris 09-30)

TikTok refused the developer app for production ("Applications intended for
personal use or internal company use are not eligible"), so API uploads could
only ever be private (`SELF_ONLY`). Chris declined a paid posting service and
chose to post TikTok himself: THREE videos a day, one per slot, ready as a
package the night before ("basically convert the 7am and 7pm static images to
a video … the night before the next day, you should have all 3 videos for
tiktok with descriptions or any info needed for the post ready for me in a
nice little package").

**The autopilot no longer touches TikTok.** It is not in `SOCIAL_SITES`; the
publisher has no video-only logic left; nothing uploads to it, alerts about it
or writes a `failed` slot row for it. `sites/tiktok.ts` keeps only the OAuth
token for the stats reader (`socialPulse.ts`, `video.list`), which stays quiet
when no token exists. The inbox never read TikTok. The other six sites are
unchanged: pictures at 7:05am and 7:05pm, the movers video at 1:05pm, same
captions, same featured-card filing.

**The package** (`lib/socialTiktok.ts`, `lib/server/socialTiktok.ts`): for one
Eastern day, three 9:16 videos, each registered with its caption.

| Slot | Video | Registered as |
|---|---|---|
| 7:05am | the morning picture post as video: `slotKind("morning", day)`, normally the set spotlight | `social_tiktok:morning:<day>` (TikTok only) |
| 1:05pm | the movers video, the SAME file every site posts at 1:05pm | `social_tiktok:midday:<day>` AND `social_video:pokemon:movers:<day>` |
| 7:05pm | the evening picture post as video: the all-games post, one lead card per public game | `social_tiktok:evening:<day>` (TikTok only) |

- The 7am and 7pm rows live in their OWN namespace on purpose: a row in
  `social_video:` means "every site posts video in this slot", and the other
  six sites keep posting those pictures live.
- A row is the site-video row plus `slot`, `day`, `title`, `caption`, `plan`,
  `kind`, `audio`. The caption (text + hashtags) comes from the publisher's own
  text builder (`applyVideoCards` / `applyGameLeads` → `fitText` at TikTok's
  2200 characters) and the EXACT cards the video drew, frozen at render time,
  so the text always matches the video.
- If a slot's own kind has no draft that day, the video follows the
  publisher's fallback chain (`FALLBACK_KINDS`), like the picture post does.
- **Staleness**: each row stores `plan`, the kind plus the day-plan flags that
  change the video or caption (`planTag`: mixed movers, also-scans, a pinned
  set). A row whose tag no longer matches the current plan (a push before 7am
  changed `DAY_PLANS`) counts as not ready and is remade; so does a 1pm row
  whose file is no longer the one the other sites post.
- **Audio**: the day's tracks rotate by slot (`social-video.mjs`): 1pm keeps the
  plain day rotation (so the shared file sounds as it always did), 7am is one
  track on, 7pm two. With fewer tracks than slots (only
  `cinematic-soul-…511436.mp3` is committed, so production has ONE), the videos
  that land on the same track start 8 bars further in (bar-aligned, still on the
  beat, checked to fit inside the track). Every video note still holds: two bars
  per card, cuts and the price pop on the beat, the green price with its glow
  flare and shine sweep, real MP3s only.

**Schedule** (Eastern; cron is UTC, EDT = UTC-4 until Nov 1, then EST = UTC-5):

| What | When (ET) | Where |
|---|---|---|
| Night render, GitHub cron | 8pm (`0 0 * * *` EDT, `0 1 * * *` EST; the 7pm-EST one exits at once, `--min-hour 20`) | `social-post.yml` job `tiktok` |
| Safety net, tomorrow's package | 9:15pm (`15 1 * * *` EDT, `15 2 * * *` EST; acts from 9pm on) | Vercel Cron → `/api/cron/social-tiktok` |
| Safety net, overnight plan change | 5:45am (`45 9 * * *` EDT, `45 10 * * *` EST; acts before 7am, on TODAY's package) | same route |

The night render is for the day AFTER the ping's Eastern day (`tiktokTargetDay`:
calendar arithmetic on the Eastern date, never UTC's; a ping that GitHub ran
past midnight still means the day that is now today). The job remakes only the
slots with nothing usable registered and is cheap when it is done. The safety
net dispatches it (`tiktok=1`, `tiktok_day=`) when a slot is missing or stale,
gives a dispatch 45 minutes, and mails the failure alert (once a day, through
`sendSocialFailureEmail`) when the package is still incomplete after that or the
dispatch fails; the workflow's failure step mails it too. The 10:30/11:30/12:15
render pings and the 12:40pm safety net (`/api/cron/social-video`) stay as
backstops: they render the 1pm video only when nothing is registered for today.

**Mail**: when tomorrow's three videos are ready the owner (never anyone else,
`OWNER_EMAIL` through `mail.ts`) gets ONE mail per package day, subject
"Tomorrow's TikTok Videos Are Ready": the three post times with their captions
and a link to /admin/social (`notifyPackageReady`; claimed before it is sent).

**/admin/social → "TikTok — Post by Hand"** (`TikTokPackage.tsx`): a Tomorrow and
a Today section, three rows each (7:05am / 1:05pm / 7:05pm ET). Per row: a muted
inline preview, the caption with Copy Caption, **Share Video** (the MP4 is
fetched into a `File` when the row scrolls into view, because on iOS Safari an
await before `navigator.share` loses the tap; the tap copies the caption and
calls `navigator.share({ files })` so the share sheet offers TikTok), Download
Video when the browser cannot share files or the fetch failed, and **Mark
Posted** (`social_slot:tiktok:<slot>` = the Eastern day, the publisher's own key
shape; Undo clears it). A slot not made yet says when it will be. The fetch
tries the Blob URL first and falls back to the owner-only same-origin stream
`GET /api/admin/social/tiktok/video?slot=&day=` (no CORS dependency).

**Render by hand**: `node --experimental-strip-types --no-warnings
--conditions=react-server --import ./scripts/lib/register-next-stubs.mjs
scripts/social-video.mjs --package [--day D] [--register]` (all three),
`--slot morning|midday|evening` (one), no flag (the 1pm movers video).
`SOCIAL_AUDIO_DIR` points at another track folder.

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
   /refresh_access_token before 11-24). FACEBOOK LIVE 09-25 (Page 1314676718400499). 09-29: META_PAGE_TOKEN
   is now a NEVER-EXPIRING PAGE token (debug_token expires_at 0) made from an extended user token via
   /me/accounts; scopes include pages_manage_engagement (self-likes). The 09-28 re-paste was a 1-hour
   user token and Facebook went dark for a day; alertFailures() now mails Chris when a site that used
   to post fails.
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
5. **Pinterest** — adapter DONE 09-26 (`src/lib/server/sites/pinterest.ts`,
   pictures only: every slot's picture becomes a pin on one board with a
   link to cardflip.io; title = first caption line ≤100, description ≤500).
   Same OAuth shape as TikTok: Vercel env `PINTEREST_APP_ID` +
   `PINTEREST_APP_SECRET` from the developer app (redirect URI
   `https://cardflip.io/api/social/pinterest/callback`, scopes boards:read,
   boards:write, pins:read, pins:write), then "connect" on `/admin/social`
   (`api/social/pinterest/connect` → consent → `callback`). Tokens in settings
   `social_token:pinterest` (access 30d, refresh 365d, self-refreshing).
   Board `PINTEREST_BOARD` (default "Pokémon Card Prices") is found by name or
   created public on the first pin; its id is cached in settings
   `social_pinterest_board`. Trial access (own account only) is all it needs.
   CHRIS: business account @cardflipio at pinterest.com/business/create, then
   developers.pinterest.com → My apps → create app → paste id + secret.
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
