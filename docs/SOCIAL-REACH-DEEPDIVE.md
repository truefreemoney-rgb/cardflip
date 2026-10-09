# Social reach deep dive (started 10-09 ~2:20pm ET, Chris: "some of our social accounts seem completely void of views, like Instagram; deep dive on each social, how to get the most exposure from profile posts: hashtags? targeting?")

## Our numbers, last 14 days (social_posts, read 10-09 2:20pm ET)

| Site | Posts | Views | Avg views | Likes | Notes |
|---|---|---|---|---|---|
| TikTok | 61 | 26,585 | 436 | 91 | by hand; only site with real reach |
| Threads | 44 | 797 | 18 | 1 | |
| X | 44 | 531 | 12 | 45 | likes ~ 1 per post (likely family) |
| Instagram | 44 | 251 | 5.7 | 0 | Reels; 9 of 44 posts at 0 views |
| Facebook | 43 | n/a | n/a | 43 | page reels; views not read by the stats reader |
| Bluesky | 44 | n/a | n/a | 80 | no view metric on Bluesky |

By kind (avg views): Instagram best = dips video 18.5, movers 13.8; worst = set/games pictures 0. Threads best = dips 39.6, set video 37. X best = dips video 40. TikTok best = thennow 208, top 203 (question formats lead, see SOCIAL-AUTOPILOT.md results log).

## What our posts look like (latest movers post, 10-09 1pm)
- Same caption on every site: "Scan a card, see what it's worth. cardflip.io" opener, five cards with prices, a question, 7 hashtags (#PokemonTCG #PokemonCards #TCG #TradingCards #CardCollector #Pokemon #PokemonCommunity).
- Instagram/Facebook/Threads captions are the long form with set names + $ prices; X/Bluesky are the short form.
- Instagram posts go out as Reels (good), Facebook as page Reels, Threads as video.
- Threads caption shows "PokemonTCG" without the # on the last line (check: tag lost in the Threads text? verify in the publisher).

## Still to do (the actual deep dive)
1. Publisher audit: `src/lib/server/social/*` (file names differ from sites/instagram.ts; find them) — Instagram: media_type REELS? share_to_feed? cover frame? alt text? Facebook: reel vs video post, is the page's audience/country set? Threads: are hashtags sent as a topic tag (Threads allows ONE topic tag; "#" + spaces behave differently)?
2. Account audit in the pane (Chris signed in): Instagram account type (Business vs Creator), bio link, profile grid covers (black first frames?), reel cover selection, whether posts are reaching "Non-followers" (Insights → Reach), hashtags shown as clickable; Facebook page: is it published/visible, audience restrictions, page category; Threads: profile public? X: account not shadow-limited (search our handle logged out), premium?; Bluesky: feeds/custom feed inclusion, hashtags clickable.
3. Research per platform (Sonnet subagents, one each): what moves reach for a small account in 2026 on Instagram Reels, Facebook page Reels, Threads, X, Bluesky — hashtags (count, niche vs broad), keywords in caption (Instagram SEO), topic tags, posting cadence, first-hour engagement, cover frames, captions on video, trial reels, collab posts, sharing to feed, location tags, audio (trending sounds matter on IG Reels too; our Reels carry our own Pixabay track).
4. Output: ONE page of changes per site, ranked by expected effect, split into "code change in the publisher" vs "Chris does once in the app". Then one gated Chris task at a time.
