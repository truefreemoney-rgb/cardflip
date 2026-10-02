# Social optimization audit (09-30, read-only research; not committed)

Scope: the autopilot as of the 09-30 working tree (src/lib/server/social*.ts, sites/*, scripts/social-video.mjs, scripts/lib/social-scene.mjs, the image route, the inbox robot). Line numbers are 09-30 and will drift with tonight's change. Prod data read from Turso (92 posts, 97 page_views, 1 signup).

**Evidence key:** D = documented by the platform (API docs / official statement); S = published study or vendor benchmark (directional); F = folklore / practitioner consensus; O = our own data (tiny samples, noise).

## Where we actually are (the number that matters)

- Real interaction is ~zero. Likes = 1 on every Bluesky / X / Facebook post is our own self-like (`socialSelfLike.ts`, `x.ts:279`, `bluesky.ts:198`, `meta.ts:250,261`), not an audience. Net of self-likes: Bluesky ~5 likes / 18 posts (2 followers), X 1 like + 1 reply + 1 share / 18, Facebook 0 / 17, Instagram 0 / 18, Threads 0 / 18. `social_comments` is empty: not one comment, ever. (O)
- Views exist only where the API gives them: Threads 379 / 18 posts (median ~9; two outliers 91 and 74), X 140 / 18 (median ~5), TikTok 152 / 3 (movers 109, set 41, all-games 2 at first read). Instagram, Facebook, Bluesky views are not collected at all (`socialPulse.ts:114,217,247`). (O)
- By kind (views): Threads drops 36 / set 24 / gains 9 / games 0; X is the opposite order (gains 14, drops 6, set 5). n = 5-6 each, dominated by 1-2 posts, so no kind or time-slot conclusion is safe. Slot averages overlap too. Do not move 7pm to "biggest jump" because of this (nor refuse to): run it as an experiment. (O)
- The binding constraint is audience, not post details. With 2-ish followers per site, only discovery surfaces (Reels, TikTok FYP, Threads topic/recs, Pinterest search, Bluesky tag feeds) move views; follower-feed tuning (post times, hashtags on a no-feed platform) is second order.
- Site traffic: 97 page_views in 6 days, 35 visitor-days, 0 rows with a referrer host, `src` populated on only 2 rows (the tagging shipped 09-30). No tagged click has landed yet. 1 signup, no source recorded. (O)

---

## 1. Ranked experiment backlog (impact / effort)

| # | Change | Sites | Expected effect | Effort | How to measure | Evidence |
|---|---|---|---|---|---|---|
| 1 | **Fix the video's first frame, cover and hook.** The scene is blank at t=0 (every element fades in from opacity 0; only the footer shows) and the first 2.2 s is a title card with no card or price (`social-scene.mjs:158-165`, `socialVideo.ts:27`). Bluesky's auto-thumbnail of our 1pm video is a black screen with a footer (confirmed by downloading it). Cold-open on the No.1 card with its price already on screen (or a "$X to $Y" teaser), move the title to a 0.3 s lower-third; set Instagram `thumb_offset`/`cover_url` (`meta.ts:300`), Facebook `thumb`, and pick the TikTok cover by hand. Keep the 1pm file on every site (needs Chris's yes: it changes what 6 sites post). | IG Reels, FB, Threads, X, Bluesky, TikTok | Views + watch time on every video post; first-3 s drop-off is the platform's main distribution gate. Largest single lever on 3 of 6 sites. | S-M | IG/FB/Threads insights (item 3), TikTok app analytics (avg watch time, "watched full"), A/B the old vs new file by day | D (cover params, ranking signals: [Meta docs](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media), [Mosseri signals](https://posteverywhere.ai/blog/how-the-instagram-algorithm-works)); S (hook guidance: [opus.pro](https://www.opus.pro/blog/anatomy-of-a-viral-tiktok-2026)); blank frame = O |
| 2 | **X cost check, then stop the bleed.** X now bills $0.015/post, **$0.20 for a post containing a URL** (since 04-2026), $0.015 per like, $0.005 per media-metadata call ([X docs](https://docs.x.com/x-api/getting-started/pricing)). Our X post = text ending `cardflip.io` (auto-linked, probably counts as a URL) + alt-text call + self-like = ~$0.22 each. 18 posts since 09-25 = ~$3.96 of the $5 prepaid; the balance may run out around 10-02. Check console.x.com now. Cut at least the self-like and alt-text call (saves ~$0.02) and decide: keep the URL ($19.5/mo at 3/day) or post `CardFlip` text only on X and use the bio link `/x`. | X | Keeps the channel alive; X is the weakest by views (median ~5), so a decision, not a sacrifice. | S | Console balance; X post-create cost per day | D (pricing page); whether a bare "cardflip.io" triggers the surcharge = unverified |
| 3 | **Collect the numbers we are blind to, and stop self-likes polluting them.** Add Instagram per-media insights (views, reach, saved, shares, total_interactions), Facebook post insights (views/reach; needs `read_insights`), Pinterest saves/outbound clicks, TikTok by hand (no API; one weekly entry from the app). Stop liking our own posts on X (costs money, `x.ts:279`) and drop or flag the Bluesky/Facebook self-like so "likes" means audience. Store `likes_ex_self` or just skip self-likes. | IG, FB, Pinterest, X, Bluesky | None directly; makes items 1, 4-9 decidable. Today the three biggest unknowns (IG reach, FB reach, saves) are literally not recorded. | M | The pulse table fills; per-slot/kind medians weekly | D (insights API); self-like "for the algorithm" = F, no platform documents it |
| 4 | **Per-site hashtag caps instead of one 13-tag list.** `PLAN_TAGS.games` has 13 tags (`socialPlan.ts:82`) and `social.ts:813` sends all of them; only Instagram has a cap (`meta.ts:288`). Facebook, Threads, Bluesky, Pinterest, X, TikTok take them all (X/Bluesky trimmed only for length). Suggested: IG 3-5 specific, X 1-2, Threads exactly 1 (use the API `topic_tag`, put none in text), Facebook 0-2, Bluesky 2-3 niche tags, Pinterest 3-5 as keywords in the description, TikTok 5 (already planned). Add a `maxTags` per site. | All | Cleaner posts, no spam signal, a Threads topic tag that is chosen not accidental, an IG post that is not demoted. | S | Compare the 13-tag all-games post vs a capped one per site (n is small; also read tag-page appearance on Threads/Bluesky) | D (IG hard cap 5, [source](https://multiplayer.it/notizie/instagram-limita-gli-hashtag-se-ne-potranno-utilizzare-massimo-5-per-post.html); Threads one topic tag, [Meta docs](https://developers.facebook.com/docs/threads/posts/)); S (X 1-2 tags: [vendor study](https://metadatareactor.com/blog/twitter-hashtag-strategy-2026/)); F (Facebook, Bluesky) |
| 5 | **Hook-first caption line + one question + a numeric CTA.** Line 1 today is descriptive and identical every day ("Pokémon price gains this week, from CardFlip's own price history.", `social.ts:676`); the mover that earns the click is on line 3. Open with the number ("Gardevoir +41% this week", "Base Set 2: Charizard $493") inside the first ~125 chars (IG/FB/TikTok truncate there), rotate the question you are already adding, end with the free-scan count from `pricing.ts` (the sign-off `social.ts:657` has no number). X/Bluesky short captions (`social.ts:685-691`, `711-719`) print names and % only, no price, set or game; one mixed post printed "Reverse Damage +25%" (a Magic card) beside Pokémon names. Add the price and, in mixed posts, the game. | All | Views via expanded-caption rate, comments via the question; CTA lifts clicks. | S | Alternate hook styles by day, compare per-post views/likes/clicks (item 3) | S/F (hook-first); our caption defect = O |
| 6 | **Source detection that survives in-app browsers.** `/api/visit` uses the referrer host and a UTM only (`api/visit/route.ts:57-60`); Instagram, Facebook and TikTok in-app browsers strip the referrer, so these arrive as "direct" ([why](https://www.makeinfluence.com/en/academy/why-influencer-sales-dont-show-up-in-google-analytics)). Add a UA-token classifier when ref and utm are both empty (Instagram, FBAN/FBAV, musical_ly/Bytedance/TikTok, Pinterest tokens; keep only the token, not the UA). Stage the `/i`, `/tt`, `/x`, `/f`, `/th`, `/b` bio paths as the primary read, UA as a fallback. | IG, FB, TikTok, Threads | Turns "direct" (33 GA sessions) into per-site clicks without changing a caption. | S | `page_views.src` split; compare to GA "direct" over a week | D (referrer stripping reported widely); UA tokens = well-known, verify on own traffic |
| 7 | **Portrait image variants (4:5 IG/FB, 2:3 Pinterest).** All six picture sites get the 1080x1080 square (`socialPublish.ts:506-507`, `social.ts:69`). Instagram's profile grid is now 3:4, so the square is centre-cropped in the grid and the right-hand price column (x 870-990 of 1080) is clipped; 4:5 (1080x1350) is the feed ratio, with key content inside the centre band. Pinterest wants 2:3 (1000x1500). `story` already exists as a size (1080x1920), a portrait layout does not. | IG, FB, Pinterest | More feed area, readable grid tile, better Pinterest placement. | M | IG/FB reach and likes per reach, pre vs post | D (IG grid 3:4 / feed 4:5: [guide](https://planoly.com/blog/guide-to-instagrams-new-vertical-grid)); S (Pinterest 2:3: [guide](https://mergeimages.net/blog/pinterest-pin-size-guide-2026)) |
| 8 | **Carousels (and TikTok photo mode).** The set spotlight and movers are lists: ship a 4-6 slide carousel (slide 1 = the hook/lead card + price, one card per slide, last slide = scan CTA). Instagram `media_type=CAROUSEL` and Threads carousels are in the APIs; Chris can post the same slides as a TikTok photo-mode post by hand. | IG, Threads, FB (multi-photo), TikTok | Saves + engagement rate; carousels beat single images in a 35M-post benchmark (0.55% vs 0.35% engagement). | M-L | Saves and shares per reach (item 3) | S ([Socialinsider 2026](https://www.socialinsider.io/blog/instagram-benchmark-report/)); TikTok carousels S/F ([vendor](https://alici.ai/blog/tiktok-carousel-2026-make-money)) |
| 9 | **Participation posts: "check your binder", price polls, predictions.** One a day replaces a list post on Threads/X: "Own any of these five? They moved 25%+ this week" (list is the same data), or a poll "Higher next week: Charizard or Blastoise?" (Threads API has `poll_attachment`; X polls). The robot already answers questions. These are the formats most likely to earn the first comment, which we have never had. | Threads, X, FB, IG (question stickers not via API) | Comments, sends/shares ("tag the friend who has it": sends per reach is Instagram's heaviest non-follower signal). | M | Comments / replies per post vs list-post baseline | D (ranking signals); S (reply velocity on Threads: [Metricool](https://metricool.com/threads-algorithm/)); TCG-specific = F |
| 10 | **Threads: `topic_tag` + hidden-URL link card.** Put the one topic tag in the API field, text without hashtags; test `link_attachment` carrying a UTM URL so "cardflip.io" stays plain in the caption yet the click is tagged (the doc does not restrict it by media type; reports say text posts only; test). Threads has no other way to tag a link today. | Threads | Clean attribution for Threads (our best-reach site so far); possible CTR from the card. | S-M | utm_source=threads rows vs referrer-only | D (params); text-only restriction unverified |
| 11 | **Fix Pinterest, then use it as a search channel.** 403/401 since 09-26: Pinterest's own forum shows trial-access apps returning "consumer type not supported" on pin create ([threads](https://community.pinterest.biz/t/your-application-consumer-type-is-not-supported-please-contact-support/39321)); the fix is a support ticket / Standard access, not code. Then: 2:3 pins with keyword titles ("Base Set 2: most valuable Pokémon cards and prices"), one board per game, tagged `link` (already done, `pinterest.ts:248`). | Pinterest | Pinterest is the only site with a native clickable destination per post and evergreen search traffic (set-price queries). | S (ticket) + M | Pin outbound clicks (add to pulse) + utm_source=pinterest | D (error); S (SEO) |
| 12 | **Bluesky hygiene.** Add `langs:["en"]` to the post record (absent, `bluesky.ts:186-192`), 2-3 niche tags max, include prices in the 300-char caption, set a pinned post (writable via the profile record), build a TCG starter list / follow relevant collectors (2 followers today; Bluesky has no ranking algorithm, discovery = custom feeds that filter by tag, language and follows). | Bluesky | Eligibility for tag/language feeds; first real followers. | S | Followers, reposts (Bluesky has no views) | D (lexicon); S ([feeds use tags](https://socialk.it/en/blog/do-hashtags-work-on-bluesky)) |
| 13 | **TikTok hand-posting tactics.** Chris posts by hand, so he can do what the API could not: choose the cover, add a trending sound at ~5-10% under our track (only on a Personal/Creator account; Business accounts see the Commercial Music Library only, [source](https://www.soundstripe.com/blogs/tiktok-music-licensing-rules)), paste the first line as on-screen text, and try 4-5 pm ET instead of 1pm. 24-32 s videos (`social_tiktok` rows: 24.0 / 26.1 / 31.7 s) are fine; the all-games 31.7 s video (2 views) has no ranking hook. | TikTok | Views (the most data-rich channel so far: 109 on the movers video). | S (Chris, 2 min/video) | TikTok analytics | D (music rules); S (hook/length: [opus.pro](https://www.opus.pro/blog/anatomy-of-a-viral-tiktok-2026)); timing F |
| 14 | **One evergreen "scan a card" demo reel, pinned.** Nothing we post shows the product working; the pictures are price lists. A 10-15 s phone screen capture (photo of a card, price in 2 s) is the strongest CTA asset and can be pinned on Bluesky/X/Threads/TikTok/IG. | All | Clicks and sign-ups (highest intent), follower conversion. | M (one capture) | Profile-visit and click rate | S/F ("lead with the product": [opus.pro](https://www.opus.pro/blog/anatomy-of-a-viral-tiktok-2026)) |
| 15 | **Posting-time test.** 7:05am ET is the weakest-evidence slot: published windows put Instagram at 11am-1pm, TikTok 2-5pm, Facebook 12-8pm ([Sprout 2026 summary](https://sproutsocial.com/best-times-to-post)). Test 7:05am vs 12:05pm vs 8:30pm on alternate weeks (not just the post, the TikTok drop too). Our own slot data cannot answer this yet (item 3 first). | All | Small, uncertain; reach per post. | S | Per-slot median views, 2+ weeks | S (generic, not TCG); O inconclusive |

Not ranked: first-comment link tactics. X/Meta no longer need a link-in-reply: X's product head said on 07-28-2026 "you do not need to put the links in replies anymore" ([PPC Land](https://ppc.land/x-drops-year-old-link-penalty-musk-tells-zuckerberg-on-platform/); mechanism disputed in the same article). Instagram comment links are not clickable and the 5-tag cap covers caption + comment together. Not worth building.

---

## 2. Measurement gaps and the fix

| Gap | Why it hurts | Fix |
|---|---|---|
| Referrer lost in in-app browsers (IG, FB, TikTok, often Threads) | GA "direct" 33 sessions vs 2 facebook referrals; our `page_views.ref` is empty on all 97 rows | UA-token fallback in `/api/visit` (#6); bio paths `/i /tt /b /x /f /th` stay the clean read; reconcile one week against GA |
| X, Facebook, Threads links cannot carry UTM (plain "cardflip.io") | These three sites are told apart by referrer only | Threads `link_attachment` UTM (#10); Facebook: no hidden-URL field on a photo post, use `/f` path only in the bio and the UA/referrer fallback; X: decide the URL fee first (#2) |
| IG and FB views/reach/saves/shares never read (`socialPulse.ts:217,246-247`) | Biggest two Meta channels are unmeasured; saves and shares (strongest signals) appear nowhere | Per-media insights call after each post and daily (#3) |
| Self-likes inflate likes by 1 on X/Bluesky/Facebook | "17/17 Facebook posts have a like" is us | Stop self-likes or store a `self` flag; compute rate on net |
| Pinterest saves/clicks, TikTok (hand-posted) not recorded | Nothing says which TikTok slot works | TikTok: one weekly entry from the app into a settings row; Pinterest pin analytics call |
| Per-day visitor hash (`day|ip|ua|salt`) | "35 visitors" is visitor-days; no multi-day returning users | Fine for source mix; do not quote as people. GA is the user count |
| `INSERT OR IGNORE` unique (day, visitor, path) | A second visit that day from another source is dropped | Keep first-touch (it matches `chooseTouch`) but note it |
| Zero signups with a source (1 signup, null src) | Cannot close the loop to sign-up | Wait: shipped 09-30; check `/admin/analytics` signup-by-source after 7 days |
| Per-post unit economics | $ per view / per click unknown (X costs real money) | Log X API spend per post once #2 is decided |

---

## 3. Per-site quick findings

**Bluesky** (2 followers, handle cardflip.bsky.social, no views API)
- Captions carry up to 13 hashtags on the all-games post (`social.ts:813`); Bluesky's feeds filter by tag but hashtag stacking is read as spam. Cap at 2-3.
- Short caption (300 limit) lists names and % only; no price/set/game (`social.ts:685-691,711-719`).
- No `langs` field; image alt text is the generic first caption line (`socialPublish.ts:508`).
- Link facet carries the UTM URI (`bluesky.ts:190`): the one site with exact click attribution already.
- Video thumbnail is blank (see #1); growth needs follows/starter lists, since there is no algorithm.

**X** (median ~5 views, $0.22/post, see #2)
- Real constraint is money. 257-char text leaves little after tags; 13 tags trimmed only by length.
- Image-only with plain domain; native video is posted with no first-frame hook (#1).
- Self-like costs $0.015 and adds nothing documented; drop it.
- Link penalty: the platform says it ended (07-2026) but also bills URL posts 13x, so "link or not" is now a cost decision, not a reach decision.

**Facebook** (17 posts, 0 real reactions, no views collected)
- No `maxTags` (`meta.ts:231-237`); 13 tags on the all-games post. Use 0-2.
- Photo post, plain "cardflip.io" in message (clickable); Meta is reportedly limiting link posts for some accounts ([source](https://posteverywhere.ai/blog/how-the-facebook-algorithm-works) - S/F), so image-with-link-in-text is fine, link posts are worse.
- All video on Facebook now publishes as Reels ([Meta change 06-2025](https://www.tubefilter.com/2025/06/17/meta-facebook-reels-all-videos-update/)); we use `/{page}/videos` with `file_url` (`meta.ts:244-246`), no title or thumbnail; check it lands in the Reels tab.
- Page has no cover/pinned-post/CTA button status verified (bio is written by `/api/ops/social-bio`).
- Square image is fine here; 4:5 gains feed area.

**Instagram** (0 likes / 18, views unknown)
- Square 1:1 image: grid crops it to 3:4, losing the price column (#7). Reels use `share_to_feed` with no cover (`meta.ts:300`).
- Hashtag cap handled (5) but the all-games 13 list is cut to the first five (one per game; fine).
- Caption link not clickable (expected); the bio path `/i` is the click route; confirm the owner set it.
- Carousels are in the API (#8); Trial Reels are exposed through `trial_params`, a free way to test video hooks on non-followers first.
- Alt text sent for images only; make it describe the cards and prices.

**Threads** (best reach so far: 379 views / 18 posts, 0 replies)
- All 13 tags are in the text; only the first is a topic, the rest read as clutter (`social.ts:813`). Use the API `topic_tag`.
- Conversation is the ranking signal here: nothing we post asks for a reply (#9); `poll_attachment` exists.
- Best two posts were the price-drops lists (91, 74) and set spotlights (45, 43): loss/valuation framing may travel. Do not generalise from n=2.
- No tagged link possible today; `link_attachment` is the test (#10).

**Pinterest** (not posting since 09-26)
- Blocked by trial access, not by our code (#11). When fixed: 2:3 portrait, keyword title (title is the first caption line now, `pinterest.ts:241`, which is descriptive but generic), description 3-5 tags, tagged link already in place.
- It is the only site where a single evergreen pin (set price lists) can keep sending clicks for months.

**TikTok** (by hand; 3 videos 109 / 41 / 2 views)
- Captions are the full multi-line post with 13 tags on the all-games video (`socialTiktok.ts:108`, the 5-tag cap you are adding tonight fixes it); line 1 is descriptive, so the feed preview shows no hook.
- Videos run 24-32 s; cut or hold the best card first (#1). Footer and progress bar sit at y~1776-1850, under the app UI on every platform (`social-scene.mjs:104-106`).
- One track baked in; he can layer a native sound at low volume if the account is Personal/Creator (#13).
- Photo-mode carousels are a second format he can post from the same data (#8).

---

## 4. In the code today that likely hurts reach

1. **Blank first frame + 2.2 s title intro** on every video: `scripts/lib/social-scene.mjs:158-165` (all elements start at opacity 0), `src/lib/socialVideo.ts:27` (`intro: 2.2`). No cover set on Reels: `src/lib/server/sites/meta.ts:300`. Confirmed with Bluesky's auto-thumbnail.
2. **13 hashtags to every site except Instagram:** `src/lib/socialPlan.ts:82-86` + `src/lib/server/social.ts:813`; only Instagram has `maxTags` (`sites/meta.ts:288`); Facebook (`:231`), Threads (`:354`), Bluesky, Pinterest, X and TikTok have none.
3. **Hashtags typed into Threads text** instead of its single topic tag: `social.ts:813` -> `meta.ts:365-369` (`text: p.text`, no `topic_tag`).
4. **Square image for the Instagram grid and every feed:** `src/lib/server/socialPublish.ts:506-507`, `social.ts:69`; the price column falls outside the 3:4 centre crop.
5. **Self-likes:** `x.ts:279` (paid, $0.015), `bluesky.ts:198`, `meta.ts:250,261`, `socialSelfLike.ts` (retries). Contaminates the only engagement numbers we have; no platform documents a benefit.
6. **Every X post is billed at the URL rate if "cardflip.io" is detected:** `x.ts:272` posts `p.text`, and every caption ends on `cardflip.io` (`social.ts:657`); X docs list $0.20/URL post.
7. **Alt text is the generic first caption line:** `socialPublish.ts:508`. It should name the cards and prices (accessibility, and Pinterest/Instagram/X search read it).
8. **Short caption drops price, set, game:** `social.ts:685-691`, `711-719` (Bluesky/X); a mixed post can list a Magic card beside Pokémon names with no game label.
9. **Caption line 1 is generic and the same every day:** `social.ts:676,703,723,776`; the number and the hook sit on later lines, which is where Instagram/Facebook/TikTok fold the caption.
10. **Footer/progress bar under platform UI:** `social-scene.mjs:104,106` (y ~ 1776-1850 of 1920); the doc already notes the 1pm price line sits under TikTok's overlay.
11. **Pulse blind spots:** `socialPulse.ts:114,217,246-247` (views null for Bluesky, Facebook, Instagram; Instagram shares null); no saves anywhere.
12. **Robot reply lag and thresholds:** the inbox runs about an hour after each slot (`vercel.json` social-inbox crons); on Instagram/Threads/Facebook the first 30-60 min is when replies help ([S](https://posteverywhere.ai/blog/how-the-facebook-algorithm-works)). Moot until comments exist; relevant once #9 produces some. Praise gets a reply 1 in 4 (`socialModeration.ts:110`); consider replying to every early comment while volume is tiny.
13. **Tonight's change, notes:** the 7pm "biggest jump per game" leans on gains; our gains posts are the lowest-viewed kind on Threads (9 avg vs 36 drops) and highest on X (14 vs 6). The data cannot settle it; treat it as an A/B (alternate with drops) and watch the price guard, since big jumps are where junk prices live. Five tags on TikTok is consistent with TikTok's own guidance; vendor studies range higher (S, mixed), so test 3 vs 5.

## What is folklore vs documented (short list)

- Documented: Instagram 5-tag cap; Instagram ranking signals named by Mosseri (watch time, sends per reach, likes per reach); Threads one topic tag; Instagram cover params; X/Meta per-request API prices; Pinterest trial-access error; Facebook videos publish as Reels.
- Vendor/benchmark studies: carousel vs image engagement; X 1-2 hashtags; TikTok hook/length; timing windows (generic, not TCG).
- Folklore: self-likes help the algorithm; link-in-first-comment (retired on X); optimal minute of the day; emoji vs no emoji in captions (no evidence either way for our audience; test arrows ▲/▼ before any emoji).
- TCG-specific content behaviours (check-your-binder, nostalgia, before/after, pulled-vs-worth, polls): practitioner consensus only; I found no study. Treat all of #9 and #14 as hypotheses and read item 3's numbers before scaling any.
