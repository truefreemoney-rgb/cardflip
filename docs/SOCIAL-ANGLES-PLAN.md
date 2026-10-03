# Social angles: five new video kinds, game rotation, optimizer-driven choice

Chris 10-03: all five sample angles approved ("put all 5 in rotation"); rotate GAME too, not just Pokémon,
"sometimes all 5 game types in 1 video"; head-to-head NEVER pits cards of different games; the optimizer
makes the choices. Samples: `scripts/.angle-samples-tmp.mjs` (generator) + `scripts/lib/social-angles.mjs`
(scene, screen types reveal / thennow / versus / beat; both untracked until phase 2). Verdict wording for
head-to-head (Chris: "stood still" is weird): "Charizard climbed 7.6% this week, Emolga held at $87.03"
(climbed / slipped / held at $X). Then-vs-now labels are the size of their amounts.

## The five kinds (PostKind additions)

| kind | video | data | games it can run for |
|---|---|---|---|
| `guess` | one card, "What's it worth?" two bars, price pops, week move | one card + price (+ pct when history) | all 5 (3 TCG games: current price only, no pct line) |
| `thennow` | one card, price N months ago struck through, today's pops, "+X% since May" | series start price vs today, Cardmarket referee | pokemon, mtg (90-138 days); the other 3 from ~2027-01 (history began 09-30) |
| `versus` | two cards SAME game, prices up front, week move reveals, winner tag + verdict | two cards from one set/game | pokemon, mtg (move); other 3 as "Which is worth more?" (prices reveal) |
| `sleepers` | 3 cards under $5 with the biggest weekly gains | movers pool with minPrice 1, to < 5 | pokemon, mtg |
| `top` | the five dearest cards priced today, counted down | top by latest price, dedupe by name | all 5 |

"All five games in one video" = `mixed` mode for guess / top / sleepers: one card per public game (the
games-kind pattern, `POST_GAME_ORDER`). versus is never mixed.

## Where the choice is made (the real work)

Today: `SLOTS` = 7am set / 1pm movers / 7pm games; the optimizer (`src/lib/socialOptimize.ts`, job
`src/lib/server/socialOptimize.ts`, runs once a day from the 8am inbox ping) only swaps ONE benched kind into
the 7am or 7pm slot via a 7-day trial; `ScoredKind` is hard-coded to set/movers/games/dips; the schedule is
`social_schedule` settings JSON `StandingEntry[] {from, morning?, evening?}` whitelisted by
`OPEN_KINDS` in `socialSchedule.ts:22`. No game dimension anywhere.

Plan: replace the one-bench trial with a WEIGHTED DAILY ROTATION for the two open slots (midday stays
the movers video for now: it is the shared file every site posts and the best-measured post; revisit after
the new kinds have scores):
- Pool = every kind with a draft that day (9 kinds). Weight = the kind's optimizer score (site-normalised
  views, `normalize`), unknown kinds get the mean (optimistic prior so every new kind gets aired).
- Pick 7am and 7pm by seeded weighted draw (`dayShuffle`-style seed on the day), never the same kind in
  both slots, never the kind that sat in that slot yesterday, never a kind posted in the last 2 days.
- Game per kind: rotate across the games that have data for that kind (table above), seeded by day,
  `mixed` counts as one entry in guess/top/sleepers' rotation. Score per (kind, game) once there are
  MIN_POSTS; until then the kind score applies.
- The schedule row grows: `StandingEntry {from, morning?, evening?, morningGame?, eveningGame?}`; the
  optimizer writes one entry per day (keep `KEEP` = 8 → raise to 30). `parseSchedule` whitelist gets the
  new kinds. The Optimizer Off switch pins yesterday's entry.
- `planTag` gains the game (`guess@mtg`, `top@mixed`) so a changed choice remakes the video.

## Phases (one per session; each ships green and is live only as far as it goes)

1. **DONE 10-03 (session 102).** Kinds + drafts + captions + pictures. What shipped and where it differs from the sketch:
   - `socialPlan.ts`: `ANGLE_KINDS`, `ANGLE_GAMES`, `angleGameOrder(kind, day)` = one strict cycle per kind, offset per kind
     (phase 3 replaces this with the optimizer's pick); `QUESTIONS` + 5 pools.
   - `social.ts`: `topByPrice`, `sleepers` (freshSeries takes a price `band`, $1–<$5, Magic's band read dearest first),
     `thenNow` (90+ days, Cardmarket/Scryfall referee within 3x, 1.8x–6x, flat last five days), `pair` (closest prices,
     one card moved, weeks ≥ 2 points apart; TCG games: two price-guarded stage cards ≥ 10% apart, the dearer wins),
     `guessCard` (the riser no gains post shows, else the card of the day; TCG: a stage card by day), `mixedAngle`,
     `angleData(kind, day)` = the rotation's game or the next with data, `angleDraft`. Drafts ride the Pokémon loop with
     their own `game`; `withSeriesCache` memoizes freshSeries inside one drafts build (ten kinds no longer re-read the pool).
   - **"Most valuable" is Pokémon + Magic only** (`TOP_GAMES`): the first Yu-Gi-Oh render was TCGplayer placeholders
     ("Genex Ally Axel $213,589"), and nothing referees Lorcana's or One Piece's dearest rows. `mixed` top needs three
     games, so it falls through to Pokémon until a third game has a referee. Magic's history also began in May, so
     then-vs-now runs for it today (first draft: Rain of Riches $5.94 → $25.43).
   - Pictures: `route.tsx` kinds + 5 (guess = card of the day frame with a kicker, thennow = the same with the old price
     struck through, versus = new `Versus`, sleepers/top = `Movers`, three-row lists drawn larger). Captions tagged by
     `kindOfCaption` (top says "across every set" / "in each game" so it is never read as the set spotlight).
   - No-repeat: `FeaturedKind` + 5, the publisher files angle posts under their kind once they land.
   - Nothing posts yet: the publisher posts a slot's kind + `FALLBACK_KINDS`, the schedule whitelist (`OPEN_KINDS`) and
     `VIDEO_KINDS` do not know the angles. /admin/social shows them as "Not Posting This Day".
   - Tests: test-social (the angles block at the end), test-social-posts (tagger), test-social-tiktok (fixture count).

   Original sketch: `PostKind` + 5, `QUESTIONS` pools, caption
   builders, `socialDrafts` emits the new kinds with `game` = the day's rotation pick (data helpers:
   `topByPrice(game)`, `sleepers(game)`, `thenNow(game)`, `pair(game)`, `guessCard(game)`; 3 TCG games
   read `tcg_cards` via `getGameStageCards`, catalogRows needs a `tcg_cards` branch), `kindOfCaption`
   prefixes (`socialPosts.ts:119`), image route branches (`api/social/image/route.tsx:134`: guess/thennow
   = card picture, top/sleepers = list picture, versus = two-card picture), `KIND_LABEL`, `KIND_ROTATION`,
   `FeaturedKind` + filing, `SocialPreview.tsx` kind union. Tests: test-social (drafts per kind, captions
   print the right prices, versus same game), test-social-posts (kindOfCaption).
2. **DONE 10-03 (session 103).** Video. What shipped:
   - `scripts/lib/social-angles.mjs` tracked (screens reveal / thennow / versus / beat; the versus ask is per screen:
     "Which is worth more?" for a TCG pair). `scripts/social-video.mjs`: `buildAngle(kind)` draws from `angleData(kind, day)`
     (the draft's own pick), every card must have art (a short list is not that post), `makeSlot` times the video by the
     screens' holds (`beatsOf`, a reveal = two BEATs), the all-games outro on every angle. `--kind <kind> --out x.mp4`
     renders one video of any kind by itself (how the angles are eyeballed; no slot, no register).
   - `VIDEO_KINDS` + 5. Frozen rows: `VideoCard.thenDay`, `VideoSpec.winner` (head to head), both parsed; `TiktokSpec.game`.
     `registerTiktokVideo` keys the shared row by the DRAFT's game (`videoKey(draft.game, kind, day)`, the key the
     publisher reads), `sharedVideo(slot, day, game)`, `readSlot` compares under the row's game.
   - `applyVideoCards` rebuilds an angle draft whole from the frozen cards through `angleDraft` (`pairFromCards` for versus,
     the winner from the row), so title, both captions, tags and the no-repeat list say what the video shows.
   - Caption copy: "Pokémon then vs now: Rain of Riches (…)" (was "Then vs now: Magic: …", a double colon).
   - Tests: test-social-tiktok (phase 2 block: kinds, script pins, scene, rebuilds, register under the draft's game, the
     winner), test-social-video (parser extras), test-social (then-vs-now pin).
   - Still nothing posts an angle: no slot names one until phase 3 (`candidateKinds` leads with it the day one does).

   Original sketch: `build()` branches per kind calling
   `angleData(kind, day)` (the same pick the draft and the picture use); `VIDEO_KINDS` + 5; frozen rows:
   `VideoCard.thenDay?` (thennow; `Mover.thenDay` already exists) + validator, versus = two cards in order and the
   winner; `applyVideoCards` branches (`angleDraft` rebuilds a caption from `AngleData`, so freeze cards → rebuild
   through it); register uses the draft's game (not `TIKTOK_GAME`) so the shared row key matches (`videoKey(d.game,
   kind, day)`; a mixed post's game is "pokemon" with cards carrying their game, as mixed movers today). Note the
   publisher's `draftsForKind` matches `d.game === g` over the games seen in the drafts, so an `mtg-guess` draft is
   found once a slot names `guess`. Tests: test-social-tiktok (plan tags, candidateKinds order), test-social-video.
3. **DONE 10-03 (session 104).** Rotation + optimizer. The rotation is ON: the first 8am run (10-04) writes 10-05's picks.
   - `lib/socialOptimize.ts` rewritten: `SCORED_KINDS` = 9, `POOL_KINDS` = 8 (movers pinned at 1pm), `scoreKinds` (the old
     scoring, unchanged rules), `weights` (score; unknown = mean of the known, FLOOR 0.25 of the mean), `rotate` (mulberry32
     seeded by day + slot; rules: not the other slot's pick, not yesterday's kind in that slot, not a kind from the last
     NO_REPEAT_DAYS = 2; relaxed in turn when they leave nothing), `gameFor` (angle game = `angleCycle` pick), `step` →
     `{report, entry}`. The trial machinery (judgeTrial, Trial, explore, failed, cooldown) is GONE. LEAD_DAYS = 1: the 8am
     job writes TOMORROW's entry, tonight's render reads it.
   - `StandingEntry` + `morningGame` / `eveningGame`; `DayPlan` carries them; `angleGameOrder` leads with the plan's game
     (`angleCycle` is the raw cycle); `plannedGame(kind, day)`; `planTag` = `guess@mtg` for an angle in a slot.
     `socialSchedule.ts`: OPEN_KINDS + the angles, a game parses only with an angle kind that runs for it, KEEP 30.
   - Job (`lib/server/socialOptimize.ts`): yesterday / recent from `slotKind` over the schedule itself (no DB read), Off =
     nothing written (the entry in force stays), report keeps `forDay`, `picks`, `scores`, `weights`; no board line (one a
     day would be noise); hashtags unchanged. `optimizerStatus` returns picks + scores; `SocialOptimizer.tsx` shows
     "<day>: 7am guess the price · Magic · 7pm head to head · Pokémon" and a score chip per kind.
   - Tests: test-social-optimize rewritten (scoring pins kept, weights, the draw, step); test-social-publish (angle entry,
     plan tags with the game, parse drops a game that does not fit, the job end to end writes tomorrow's entry).
   - NOT done, next in this area: per-(kind, game) scores need a `game` column on social_post_log + social_posts and the
     tagger (socialPosts.ts tagPost) to carry it; until then the game is the cycle. `available` (kinds with a draft) is not
     passed: the publisher's FALLBACK_KINDS and the render's candidateKinds cover a pick with no draft.
5. **Format dimension** (Chris 10-03 evening: "mostly videos … occasional static images, put it in the optimizer and let it
   optimize itself"): a per-slot video-vs-picture choice the optimizer draws and scores (video weighted high by default,
   static a minority option it trials), on the sites that take both. Today every slot shares its video, which already
   satisfies "mostly video"; this phase adds the static minority as a measured option. After phase 4.
4. **Visual templates** (separate ask, Chris 10-03 "bored of the same template"): 3 looks for the scene,
   rotated by `dayShuffle` with another salt; `classic` stays byte-identical for the CSS-substring pins.

## Gotchas already found
- `socialGames()` = ["pokemon"] gates drafting; the new kinds carry their own `game` on a Pokémon-keyed
  draft loop, or the loop widens. videoKey / applyVideoCards / currentVideoFor read `d.game`.
- Three TCG games: `freshSeries` never reads them; current prices only (`tcg_cards.price_usd/_foil`).
- Sleepers need their own pool query: `freshSeries` floors at $5, `MOVER_MIN_PRICE` at $10.
- Then-vs-now must keep the Cardmarket referee (sample: Rillaboom $6.35 → $148 was junk without it) and a
  1.8x–6x band.
- The dip rule (10-03, social.ts fromSettled) runs inside `freshSeries`, so every kind built on it is covered.
