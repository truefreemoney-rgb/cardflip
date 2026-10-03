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

1. **Kinds + drafts + captions + pictures** (`social.ts`): `PostKind` + 5, `QUESTIONS` pools, caption
   builders, `socialDrafts` emits the new kinds with `game` = the day's rotation pick (data helpers:
   `topByPrice(game)`, `sleepers(game)`, `thenNow(game)`, `pair(game)`, `guessCard(game)`; 3 TCG games
   read `tcg_cards` via `getGameStageCards`, catalogRows needs a `tcg_cards` branch), `kindOfCaption`
   prefixes (`socialPosts.ts:119`), image route branches (`api/social/image/route.tsx:134`: guess/thennow
   = card picture, top/sleepers = list picture, versus = two-card picture), `KIND_LABEL`, `KIND_ROTATION`,
   `FeaturedKind` + filing, `SocialPreview.tsx` kind union. Tests: test-social (drafts per kind, captions
   print the right prices, versus same game), test-social-posts (kindOfCaption).
2. **Video** (`social-video.mjs` + `social-angles.mjs` tracked): `build()` branches per kind calling the
   same helpers; `VIDEO_KINDS` + 5; frozen rows: `VideoCard.thenDay?` (thennow) + validator, versus = two
   cards in order; `applyVideoCards` branches; register uses the draft's game (not `TIKTOK_GAME`) so the
   shared row key matches. Tests: test-social-tiktok (plan tags, candidateKinds order), test-social-video.
3. **Rotation + optimizer** (`socialOptimize.ts`, `socialSchedule.ts`, `socialPlan.ts`): weighted daily
   rotation above, game dimension, admin page shows the day's picks and each kind's score. Tests:
   test-social-optimize rewritten for the pool (seeded, deterministic). This is the phase that turns the
   rotation on; until then the standing schedule stays set/movers/games.
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
