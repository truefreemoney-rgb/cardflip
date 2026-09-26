# Did the 7am post go out today? (board task #28, 2026-09-26)

Checked at 8:20am ET from the social-post workflow runs on GitHub. The
production status call (`/api/runner/status`) is blocked from the runner's
environment (proxy 403), so this is from the Actions logs, not the board.

## Short answer

**No. As of 8:20am ET nothing has gone out for the 7am slot yet, and nothing
on our side failed.** GitHub's scheduler has not fired today's 6:50am render
ping or the 7:05am post ping. When it does (or at the 1pm ping at the latest)
the catch-up rule posts the 7am set spotlight first, as the **video**.

## What actually happened overnight

| Time (ET) | Run | What it did |
|---|---|---|
| 9:26pm 09-25 | schedule (the 7:05pm ping, 2h21m late) | Facebook, Instagram, Threads got yesterday's set spotlight + movers (catch-up). Bluesky and X had already posted their evening slot. |
| 12:45am | schedule (the backup 8:05pm ping, 4h40m late) | Every site skipped: "before the 7am window". Correct. |
| 1:00am | Run workflow (#11) | Video render failed: a GitHub secret still held the masked value, not the Turso URL. Fixed straight after. |
| 1:04am | Run workflow (#12) | Video rendered and registered for today: **Base Set 2**, 5 cards, 18.8s, 5.3 MB, the mountain track. Publisher then skipped every site: "before the 7am window". Correct. |
| 6:50am | schedule | **has not fired** |
| 7:05am | schedule | **has not fired** |

## Video or picture?

Video. Today's MP4 is parked and registered
(`social_video:pokemon:set:2026-09-26`), so the 7am slot goes out as the
18.8s 9:16 video on Bluesky, X, Facebook, Instagram, Threads and TikTok
(TikTok still private, sandbox keys). A site only gets the picture if its
video upload fails, and the board's Completed line says
"(picture, video failed)" for that site. 1pm movers and 7pm drops stay
pictures, as planned.

## Why it is late

GitHub cron is "best effort" and right now it is running hours behind:
last night's two pings were 2h21m and 4h40m late, and today's morning
pings are 1h30m late at the time of writing. Nothing in our code decides
when the ping arrives.

## If you want it out now

- `/admin/social` → Post now (or the per-site "post" link), or
- GitHub → Actions → social-post → Run workflow → slot `morning`.

Either way the video is already rendered, so it posts in about a minute.

## Worth fixing (your call, one line back on the board)

Move the three post pings to Vercel Cron (Pro plan, exact to the minute)
and keep only the video render on GitHub, scheduled well before 7am
(say 2am ET) so it has hours of slack. Then "7am" means 7am.
