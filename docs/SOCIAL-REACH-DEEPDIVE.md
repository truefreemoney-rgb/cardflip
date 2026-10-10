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

## 1. Publisher audit (done 10-09 evening, code read: sites/meta.ts, x.ts, bluesky.ts, socialPublish.ts)
Ranked by likely effect on reach:
1. SAME AD LINE OPENS EVERY POST ON EVERY SITE (leadSignOff: "Scan a card, see what it's worth. cardflip.io" first, then the content). On Instagram/Threads/X the first line is the hook the algorithm and the reader judge; ours is a promo + a link. X auto-links cardflip.io, and X demotes posts with external links. Fix: per-site opener (lead with the card/question; sign-off LAST on IG/Threads/X; keep it first only on TikTok where Chris asked for it).
2. FACEBOOK POSTS PLAIN VIDEOS, NOT REELS: meta.ts uses POST /{page}/videos (file_url). Reels need /{page}/video_reels (start → upload → finish, with description). Page reels get non-follower distribution; plain page videos reach ~followers only. Code change.
3. INSTAGRAM REELS HAVE NO COVER: no cover_url / thumb_offset on the REELS container, so the grid shows frame 0 (the intro title card, or the cold-open card). Add thumb_offset (ms) to a card frame, or cover_url. Also no location_id, no collaborators, no audio_name. Code change (small).
4. INSTAGRAM TAG CAP 5 is a self-imposed limit (comment says "Instagram accepts at most five": wrong, limit is 30; Meta's own advice is 3-5 so this is fine, but the 5 come from the END-cut of a 7-tag list, so IG always drops the two optimizer-chosen tags in positions 6-7; order should be: niche first).
5. THREADS TOPIC TAG works as designed: first "#tag" in text becomes the one topic (that is why it shows without #). Only one tag per post is all Threads allows; nothing to fix. The other 6 tags are cut, so Threads carries no discoverable keywords beyond the caption: lean on caption keywords.
6. X: text + media + self-like; 7 tags inline. No community posting, no reply-to-self for the link (the classic X trick: link in the first reply, not the post). Code change: post without the link, reply with it.
7. BLUESKY: link facet + tag facets, langs en, alt text: fine. No custom-feed targeting possible from the API side; account audit item.
8. INSTAGRAM STATS: insights metric "views" then "reach"; 9 zero-view posts are likely real (fresh account, promo opener), not a reader bug.
9. Alt text = "title. first caption line" on every site: fine for IG SEO but the first caption line is the builder's intro, OK.
Not a reach lever but noted: 60-day token refresh, media_publish retry, PNG→JPEG, blob parking all correct.

## 3. Research (Sonnet, 10-09 evening)
### Threads
- Replies first: end with a specific card question, answer every comment in the first hour (vendor guides, not Meta data).
- Caption as a plain search sentence: card name, set, price, "card price scanner"; Threads search indexes the words.
- Video or image, never text-only; video vs image order unsettled.
- One mid-breadth topic tag ("Pokemon Cards" / "Trading Cards"), sent via the API `topic_tag` parameter (developers.facebook.com); first "#" in text also works.
- Link placement unsettled for 2026 (some say links fine now, others 30-50% less reach): test link-in-body vs link-in-first-reply for a week.
- Weekday mornings (Buffer: Thu 9am), weak effect. Profile must be public. No follower threshold for For You. No API penalty found.
- Stagger Instagram cross-posts by 2-4 hours, make the Threads caption its own question.
### Facebook Page
- Page Reels (/{page}/video_reels: start → rupload → finish video_state=PUBLISHED) reach non-followers more per most sources, but one head-to-head test found plain videos got 2x overall reach: unproven, check non-follower share in Insights.
- Watch time / retention + a 2-3 s hook are the ranking signals (vendor blogs).
- Keep the link OUT of the caption, first comment instead (Meta reportedly testing 2 link posts/month cap for Pages without Meta Verified).
- 1-3 hashtags at most; one 40-post test: no-tag posts reached more. Short captions, one hook line.
- No Page country/age restrictions. Category irrelevant to reach. Page must be published. Professional mode = profiles only.
- Groups: API posting gone since 2024-04-22, manual only. Page self-like: no source says it helps; probably noise.
### Instagram Reels (mostly blogs relaying Mosseri; numbers unverified)
- Watch time + sends (DM shares) are the non-follower signals: hook in the first second, end with something a collector forwards.
- Caption keywords beat hashtags: "Pokemon card price checker", "how much is my Lorcana card worth" in caption, on-screen text, alt text.
- ACCOUNT STATUS CHECK (pane): Settings > Account Status > "eligible to be recommended to non-followers". If not, nothing else matters. Account must be public.
- Original only, no watermarks; near-identical templates may read as repetitive.
- Trial Reels: post to non-followers first, promote winners; each needs a different hook/visual.
- On-screen text indexed; keep it in the upper two-thirds.
- Hashtags: cap is 5 now, 3-5 specific tags, they only categorise.
- Audio: no measured difference original vs trending. Keep our track.
- Custom cover (grid crops to square) helps profile conversion, not feed reach. Business vs Creator: no reach difference. Posting time weak; judge at 72 h.
- Link line: not clickable; hook first, URL last (no official source for ad-suppression).
- Collabs reach the partner's followers; only with a different-audience partner. Location tag / share-to-feed: neutral.
- Zero views: recommendation flag, private account, watermark/bot-like automated posting, cold start test pools, or processing/music mute. Check each zero post in the app.
### X
- Link in a REPLY, not the post (blogs: 30-90% reach cut for URL posts, worse on free accounts). Our sign-off has cardflip.io in every post.
- Premium ~10x median reach (Buffer, 18.8M posts; 600 vs <100 impressions). Money question for Chris.
- Replies in the first 30-60 min set the ceiling; be present. 0-2 hashtags (3+ reported -17 to -40%); caption text carries the weight.
- Vary captions; repetition and bot-like behaviour get penalised. Shadow-limit check: logged out, search `from:handle` on Latest.
- No API penalty found. Video vs image unresolved. Communities status unclear. Self-like: no source.
### Bluesky
- Discovery = custom feeds (keyed off hashtags/keywords) + starter packs; get into niche starter packs (ask curators).
- Reply to 6-12 posts a day; reposts/replies carry reach. 1-3 niche tags; search is chronological, so posts sink fast.
- Facets already built. Evening 4-10pm per Metricool (general data). Set the automation self-label? (docs.bsky.app recommends for bots; voluntary.) Labelers can tag accounts spam/bot: avoid mass-follow (our 25/day outreach follows are a risk).

## 4. Ranked changes (draft, pending the account audit)
**Code, in the publisher**
1. DONE 10-09: sign-off last on IG/Threads/X (trial to 10-16).
2. X: drop the link from the post, put the sign-off with the link in a first reply (every source agrees).
3. Threads: send `topic_tag` via the API param; caption = one plain search sentence + a question (not a copy of the IG caption).
4. Instagram: caption keywords ("Pokemon card price checker" style) in the caption + alt text; cut tags to 3-5 niche, niche FIRST in the 7-tag list so the end-cut keeps them; thumb_offset cover.
5. Facebook: 1-3 tags, link in first comment, Reels endpoint (unproven, test).
6. Vary captions per site (same text everywhere today) and per day.
**Chris does once in the app (account audit, pane)**
- Instagram: Settings > Account Status (recommendable?), public, Insights non-follower share, each zero-view post in the app.
- X: shadow-limit check logged out; decide on Premium.
- Facebook: Page published, no country/age restriction.
- Bluesky: ask 2-3 TCG starter-pack curators to add us; reconsider 25/day follows.
**Stop doing**: self-likes (no source says they help).

## 2. Account audit (pane, 10-09 ~9:15pm ET)
- 7pm trial posts verified: Threads and X carry the sign-off/link at the bottom above the tags. Instagram reel DeSpgrdlt_1 at 0 views after ~1 h, Threads 16, X 7.
- **Every Meta account has ZERO followers and follows nobody**: Instagram 0/0 (45 posts), Facebook Page 0/0, Threads 0. X: 6 followers / 30 following. Every post rides cold recommendation only; this is the single biggest fact.
- Instagram: public, Business account (category Product/service), Account Status → "You don't have limits to your account reach". Grid covers are card frames (fine). **No website link in the bio** (links are mobile-only to edit); a street address (6800 Wisconsin Ave, Chevy Chase) shows on the public profile. Threads badge on.
- Facebook: Page is published and visible; our /videos uploads already land as **Reels** (url facebook.com/reel/…, Reels tab), so the video_reels endpoint change is NOT needed. Each reel ~1 view. Page category "App page".
- Threads: profile public; 762 views / 649 viewers / 1 interaction in 30 days per Insights; 0 followers.
- X: free account, 7 tags per post; shadow-limit check not done (needs a logged-out window).
- Bluesky: not audited in the pane (API posts verified by code).

## 4. Ranked changes (final)
**Chris, once, from the phone (2 min each)**
1. Instagram → Edit profile → add website cardflip.io (and consider removing the street address from the public profile).
2. From each account, follow ~20 real TCG accounts/shops (IG, Threads, Facebook as the Page, X) so the accounts stop looking brand-new; a follow-back or two is the first non-zero audience.
**Code (me, one at a time, after the 10-16 trial read)**
3. X: post without the link; sign-off + link in a first reply.
4. Threads: topic_tag via the API param + its own one-sentence caption with a question.
5. Instagram: keyword caption ("Pokemon card price checker" style) + 3-5 niche tags, niche first in the tag order.
6. Drop the self-likes (no evidence they help). Vary captions per site.
**Not needed**: Facebook Reels endpoint (already reels), Instagram cover (grid is fine), account type change.

- 10-10: first signup from X (10:30am ET, t.co → /, US), the morning after the sign-off-last trial started. 12 "search" visitors the same morning hit 7 different nav pages (likely crawler/tool, verify in Search Console).
