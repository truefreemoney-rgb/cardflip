# Did all the 1pm posts go out? (board task #30, 2026-09-26)

Checked at 1:45pm ET. The production status call (`/api/runner/status`),
the board and the social sites are all blocked from the runner's
environment (proxy 403), and the 1pm post now fires from Vercel Cron, whose
log I cannot read. So this is what the code and the GitHub Actions logs
prove, and where to look for the rest.

## Short answer

**I cannot see the 1pm post itself from here.** Nothing on our side is in
the way of it: the Vercel Cron for 1:05pm ET has been deployed since 8:57am,
its auth matches, and at 1:05pm the publisher owed every site exactly one
post (the 1pm slot; the 7am slot is marked done). GitHub's backstop ping for
1pm has not fired yet at 1:45pm (GitHub is running 3 to 5 hours late on
every ping today), so there is no run log for it yet.

**Check it in ten seconds:** `/admin/social` shows each site's last post
with a link, or open the board's Completed tab and look for the line
`Social autopilot 2026-09-26 1pm set spotlight — …`. A line with six links
= all out. No line = it did not post; press Post now on `/admin/social`,
or wait for GitHub's late backstop, which posts the 1pm slot as soon as it
lands.

## What the 1pm post should be today

Not the Mysterious Treasures set spotlight, even though that is the 1pm
kind now. That set spotlight already went out at 8:55am as the 7am post
(by hand, on the old schedule), and Chris's desktop session marked it as
posted for today by hand (`social_kind:*:set`). So at 1:05pm the publisher
rotates to the next kind that has not gone out today:

- **Price drops picture** (the 7pm kind) if there were at least three drops
  worth posting today, otherwise
- **the Movers video** (Tyranitar +59.3% and four others, rendered at
  11:00am, 31.7s at the slower cut).

Then tonight's 7pm post takes whichever of those is still unposted (movers
video if 1pm was drops, and the other way round). Tomorrow the rotation is
back to normal: 7am movers video, 1pm set picture, 7pm drops picture.

TikTok (still private, sandbox keys) does not rotate because it can only
post video, so it gets the Mysterious Treasures set video at 1pm.

## What I could see (GitHub Actions, all times ET)

| Time | Run | What it did |
|---|---|---|
| 8:55am | Run workflow, slot `morning` (the by-hand 7am post) | **Set spotlight: Mysterious Treasures** posted on X, Facebook, Instagram and Threads as the **video**. Bluesky got the **picture**: its video upload was refused, `unconfirmed_email` (Chris has since confirmed the Bluesky email, so tonight's video should land there). TikTok skipped: the 1am test post counted as its 7am. |
| 9:18am | Run workflow, render only | Re-rendered the set video at the slower cut (31.7s) and registered it. |
| 10:55am | schedule (the 7:05am ping, 3h50m late) | Rendered and registered the **movers video** (Tyranitar +59.3%). Publisher: every site "morning slot already posted today". Correct. |
| 12:16pm | schedule (the 8:05am ping, 4h11m late) | Video already registered, nothing to render. Publisher: every site "morning slot already posted today". Correct. |
| 1:05pm | Vercel Cron `/api/social/publish` | **Not visible from here.** This is the run that posts the 1pm slot. |
| 1:05pm | GitHub backstop ping | **Has not fired** as of 1:45pm. When it does, its log says "midday slot already posted today" per site if Vercel posted, or posts the slot itself if not. |

## Why I cannot say yes or no

The runner's environment is denied outbound access to `cardflip.io` (the
status endpoint) and to the social sites. Allowing `cardflip.io` for the
`cardflip-runner` environment (environment settings → Network access →
add the domain) would let the next status question be answered from the
board in one call instead of from GitHub logs.
