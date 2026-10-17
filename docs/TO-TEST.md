# To test later
- [ ] HALF 10-14 ~11:00pm ET (raw card: the Search/Watchlist sheet "View Sold on eBay" and "Buy on eBay" links carry -psa -bgs -cgc -sgc -graded -slab; /admin/prices half needs your /admin sign-in): After push: /admin/prices 'eBay sold' and a raw card's 'check sold listings' open eBay with '-psa -bgs -cgc -sgc -graded -slab' and no slab titles; a slab item's eBay link still searches its grade (e.g. PSA 9).
- [x] PASS 10-16 (curl: $939.50, no "looks off") 10-15: /cards/pokemon/crystal-guardians/charizard--ex14-4 shows $939.50 (hand keep POSTed 10-14 ~2:45pm ET; page copy was still "looks off" right after, cache).
- [x] PASS 10-16 (curl: no $968.91, no self-link) Card page "Other printings" strip: on /cards/pokemon/base-set/charizard--base1-4 it lists the page's own card and shows the HIDDEN $968.91 (seen 10-14 ~2:45pm ET). Fix = strip honours hides + skips self; recheck after the fix is pushed.
# To test later

## 10-17 ~7:45pm ET: nightly catalog push sends only changed rows (A-H #23, LIVE tonight: Task Scheduler runs the working copy)
- 10-18 morning: backups/catalog-sync.log has "pushing N changed of M rows" lines (tonight N = M: no fingerprints yet, the last full push), "done (failed:)", and data/catalog-push-state.db exists (~190k rows in `pushed`).
- 10-19 morning: the same lines show small N (new cards / changed pictures only, e.g. en_cards a few dozen, not 22,195), "catalog push finished in" well under the old 446 s, and remote counts still >= local (no "remote count ... < local" error).
- Prod spot check 10-19: a card added by the 10-19 sync (any new set) is on cardflip.io.

## 10-17 ~6:15pm ET: Pokémon scan reads the reverse-holo pattern and preselects it (#11 step 2, NOT PUSHED; screenshots owed before push)
- After push, phone: scan a Prismatic Evolutions Master Ball reverse -> Printing shows "Master Ball Pattern" and its price (not the plain reverse). A Poké Ball one -> "Poke Ball Pattern".
- Ascended Heroes theme-ball reverse (e.g. Erika's Oddish with the big Poké Ball behind the attack) -> that card's ball pattern; the big leaf/flame one -> "Energy Symbol Pattern".
- A plain card (no symbol) -> Printing unchanged from before (default line). Magic foil scan -> the saved Inventory price is the FOIL price straight away (scan-time quote now uses the picked printing).
- Admin scan ledger / logs: no new vision errors (Pokémon now uses POKEMON_READ_SCHEMA; a schema 400 would show as every Pokémon scan failing).

## 10-17 ~6:30pm ET: art versions are their own cards (#11 step 1; DATA LIVE on prod, code 47114b62 + 2109fd54 NOT PUSHED)
- Now (data live): /cards/pokemon/xy/vivillon--xy1-17 $1.85 (was High Plains' $9.40); /cards/pokemon/xy/vivillon-high-plains-orange--xy1-17-highplains $9.40; /cards/pokemon/base-set-1st-edition/pikachu-red-cheeks--base1-58-redcheeks-1st $429.98; /cards/pokemon/pokemon-go/bidoof-peelable-ditto--swsh10.5-059-peelable $17.30. All PASS by curl 10-17.
- OPEN until the push: /cards/pokemon/base-set-1st-edition/pikachu--base1-58-1st shows "This price looks off" because its series restarted today (1 priced day, vintage $187 = thin sign) and live code still blanks thin-only verdicts; the few-sales commit 2b43c844 turns that into "$187.13 + Few sales". Red Cheeks low/eBay rows already moved off it; prod has only the [187.13] series. After the push: curl it -> ~$187 with "Few sales", no "looks off" (deploy resets ISR; per-page refresh = POST api.vercel.com/v1/edge-cache/invalidate-by-tags with tag `_N_T_<path>`, worked 10-17).
- Morning after (nightly 09:45 UTC): prod SELECT price_series for xy1-17 / xy1-17-highplains / base1-58-1st / base1-58-redcheeks-1st / swsh10.5-0xx(-peelable) each get today's point with the SAME values as TCGplayer (Meadow ~$1.85 holo, High Plains ~$9.40, 1st Ed yellow ~$187, Red Cheeks ~$430, Peelables $14-17, plain PoGO reverse ~$0.3-0.7). No card takes the other's price.
- After push, scan: Vivillon 17/146 orange -> High Plains card; pink -> Vivillon. A plain reverse-holo Spinarak 006 -> plain Spinarak first, Peelable only offered in the list.

## 10-17 ~5pm ET: Ascended Heroes pattern reverses priced on their own (#11 part 1, 828b91b5, NOT PUSHED; screenshots still owed before push)
- Morning after the push: /cards/pokemon/ascended-heroes/rayquaza--me02.5-153 lists 'Friend Ball Pattern' (~$0.45) and 'Energy Symbol Pattern' (~$2.22) rows, no plain 'Reverse Holofoil'.
- Prod SELECT: `SELECT variant, COUNT(*) FROM price_series WHERE card_id LIKE 'me02.5-%' AND source='tcgplayer' GROUP BY variant` -> energySymbolPattern 140, poke/friend/love/dusk/quick/teamRocket ~140 together, reverseHolofoil gone.
- Editor Printing dropdown on an Ascended Heroes card offers both patterns.

## 10-17 ~5:15pm ET: last Art Series prices (task #46, NOT PUSHED)
- Morning after the push (nightly Magic refresh): `node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_art-fill-dry.mjs` shows gaps 8 (5 Karlov Clues TCGplayer doesn't sell + Nefarious Imp, Treasure Keeper, Harness Infinity 27s); was 32. E.g. Gnoll Hunter aafr 11 ~$0.20, Aurelia amkm 46 ~$0.15.

## 10-17 ~5:30pm ET: thin-market cards show their price with "Few sales" (task #1, NOT PUSHED; shots docs/shots/few-sales-1..2)
- After push, phone: open /cards/pokemon/arceus/shinx--pl4-SH12 -> big price $165-ish, amber dot "Few sales · check eBay sold" under it (was "This price looks off").
- /cards/magic/limited-edition-beta/volcanic-eruption--leb-89 -> same note under ~$120.
- A hard-flagged card still shows "This price looks off" (any spike/Cardmarket-gap card from `node ... scripts/_few-measure.mjs pokemon out.json`, kind "blank hard").
- Inventory with a few-sales card: price shown with "Few recent sales. View Sold on eBay" under it, and it counts in the total.

## 10-17 ~3:35pm ET: "Price looks wrong?" on card pages (A-H #9, NOT PUSHED; shots docs/shots/price-report-1..3)
- After push, phone: open any priced card page -> grey "Price looks wrong?" under the price -> tap -> "Too high" -> "Thanks. We'll check it against real eBay sales."
- /admin/prices -> "Readers flagged" lists that card with "1 too high", the price it saw and an eBay sold link (not yet seen rendered: local console sign-in skipped).
- Tap again from the same phone -> still 1 vote (it changes, never stacks). Prod SELECT: `SELECT * FROM price_reports` has the row.

## 10-17 ~3:05pm ET: 15-minute uptime ping (A-H #57, NOT PUSHED)
- After push: Vercel dashboard -> Settings -> Cron Jobs lists /api/cron/uptime every 15 min; its log shows runs at :00/:15/:30/:45 with `"ok":true` (the GitHub smoke only managed every 2-4 h).
- Without the key: `curl https://cardflip.io/api/cron/uptime` -> 403.
- Alert path is the same mail as the smoke failures ("CardFlip: Uptime failed"), at most once an hour; it now also sends when the database itself is down (test:uptime).

## 10-17 ~4:45pm ET: admin Sign Out really ends the session; 7-day limit (A-H #32, NOT PUSHED)
- Right after push: the admin console asks you to sign in ONCE (old cookies have the old format; email code as usual).
- Then: sign in, copy the cardflip_admin cookie value (pane devtools), Sign Out, put the copied value back -> /admin goes to the login page. Your PC and phone sign-ins are separate: signing out on one leaves the other in.
- Prod SELECT: `SELECT COUNT(*) FROM admin_logouts` goes up by one per Sign Out and old rows drop off after a week.

## 10-17 ~4:15pm ET: other devices signed out on 2FA / email changes; sessions end after a year (A-H #31, NOT PUSHED)
- After push, two browsers signed in to a TEST account (phone + pane): turn two-step on in Account on the phone -> the pane's next page load goes to /login, the phone stays in. Same for turning two-step off, and for changing the sign-in email (code typed on the phone). Your own account: you stay signed in on the device you did it on.
- Prod SELECT after a day: `SELECT COUNT(*) FROM sessions WHERE created_at < strftime('%s','now','-365 days')*1000` = 0 once those rows are next used (old ones are refused and deleted on use).

## 10-17 ~3:30pm ET: refunds, chargebacks and failed payments (A-H #28, NOT PUSHED; Paywall copy changed, screenshot before push)
- After push (Stripe TEST mode only, never a live card): subscribe a test account with card 4242..., then in the Stripe test dashboard refund that payment in FULL -> within a minute the subscription shows Canceled in Stripe and /app shows the paywall. A PARTIAL refund on another test subscription: still Active, scans drop by that share. A test dispute (card 4000 0000 0000 0259) -> subscription Canceled.
- Failed renewal: a test subscription on card 4000 0000 0000 0341 goes past_due -> prod SELECT sub_past_due_at is set; it still scans for 14 days, then the paywall says "Your last payment didn't go through." with Update Card on top and no Subscribe button.
- Prod SELECT after deploy: `SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'sub_past_due_at'` = 1.

## 10-17 ~2:45pm ET: eBay selling checks (A-H #27, NOT PUSHED)
- After push: a trial (unpaid) test account gets "Publishing on eBay starts with a Booster or a subscription" on Send Offer / auto-offers on / reprice of a live eBay listing; End listing still works. Your own paid account: Send Offer + reprice still work on a live listing. The 2am daily job log (`autoOffers`) shows `unpaid` counted, nothing sent for unpaid sellers.
- Connect eBay on a second CardFlip account with an eBay login that is already linked to another CardFlip account -> /connect-ebay says "That eBay account is already linked to another CardFlip account..." (prod had 2 links, none shared, 10-17). A normal reconnect on the same account still works.

## 10-17 ~6:30pm ET: no account lookups through login/sign-up (A-H #30, NOT PUSHED; shot docs/shots/login-failed-message.png)
- After push: cardflip.io/login with a made-up email and a wrong password shows "Incorrect email or password. Signed up with Google or X? Tap that button instead." Same words for a real email with a wrong password. Real login and Google sign-in still work on the phone. Sign up with your own existing email once: still "An account with that email already exists."

## 10-17 ~6pm ET: input checks (A-H #33, NOT PUSHED)
- After push: one real scan in the app on the phone and one free scan on cardflip.io/scan both read a card (photo check lets real phone JPEGs through). Turn phone notifications off and on in Account: still works. curl -X POST https://cardflip.io/api/vision/trial -d '{"image":"hello"}' -H 'content-type: application/json' = 400 "That isn't a picture", no free scan used.

## 10-17 ~5pm ET: per-account row caps (A-H #26, NOT PUSHED)
- After push: scan-save, add to watchlist and a Search price check still work on prod (phone, one each). Prod SELECT: `SELECT name FROM sqlite_master WHERE name = 'idx_price_checks_user'` returns a row (made at deploy). Nothing in the error mail about rowCaps.

## 10-17 ~4pm ET: app pages ask /api/auth/me once (A-H #24, NOT PUSHED)
- After push, pane signed in on cardflip.io/app/collection: performance resource entries show /api/auth/me 1 (was 2) and /api/watch/pending 1. A "Watch this price" from a public card page while signed out, then sign in: the card is on the watchlist with the "Added to your watchlist" toast.

## 10-17 ~3pm ET: Pokémon price limit has no cliff (A-H #22, NOT PUSHED)
- After push + the next nightly price run: /cards/pokemon/boundaries-crossed (Cresselia-EX 143) shows about 1.45x its cheapest TCGplayer copy (~$103 on 10-17, was $122.05), Victini-EX Plasma Storm 131 ~$167 (was $201.35). A card under 1.45x its cheapest copy keeps TCGplayer's number. No new "looks off" on those pages.

## 10-17 ~2pm ET: set lists never wait on a rebuild (A-H C0, NOT PUSHED)
- After push: the 2am + 7am ET Production smoke ("set lists load") stays green for 2 days (`gh run list -R truefreemoney-rgb/cardflip -w prod-smoke.yml`). `curl -w '%{time_total}' https://cardflip.io/api/sets` under 3 s every time, including the first call after 6 hours.

## 10-17 ~1:30pm ET: Watchlist picker counts + empty game (NOT PUSHED; shots docs/shots/wish/, Chris OK 10-17)
- Phone: Watchlist > the game pill says "Pokémon ·N"; pick a game with no cards -> "No Magic cards on your watchlist" + a "Show Pokémon (N)" button that switches back; "Name or number" fits in the search box; open the totals bar -> Alerts not under the arrow.

## 10-17 ~3:30am ET: exchange rates never go blank (A-H #16, NOT PUSHED)
- After push + the next nightly price run: prod settings fx_rates (SELECT only) has rateAt for all 5 currencies dated today and triedAt set; Black Lotus page still shows a dollar price. Nothing new in the error mail unless a rate is over 2 days old.

## 10-17 ~2am ET: unsubscribe needs a tap (A-H #24, NOT PUSHED)
- After push: open a real digest/update mail unsubscribe link on prod with a TEST account (owner): page says "Stop These Emails?" and the account is still subscribed (SELECT digest_off); tap Unsubscribe -> "You are Unsubscribed", digest_off = 1; set it back. Next campaign mail in Gmail shows its own Unsubscribe button at the top (List-Unsubscribe-Post header).

## 10-17 ~midnight ET: made-up card/set links = real 404 (A-H #21, NOT PUSHED)
- After push: curl -s -o /dev/null -w "%{http_code}" https://cardflip.io/cards/pokemon/base-set/not-a-card--zzz9-999 (and /cards/pokemon/no-such-set, /cards/notagame) = 404 with title "Page not found"; a real card, set, game and movers page = 200. Phone: tap into a few card pages from a set, they still open quickly (the loading skeleton is gone).

## 10-16 ~11pm ET: no built-in admin/password (A-H #23, NOT PUSHED)
- After push: the admin console still signs in on cardflip.io (uses ADMIN_PANEL_PASSWORD from Vercel, unchanged); /login shows no "Log In as Admin" button; no console banner about missing password.

## 10-16 ~10pm ET: privacy policy A3 (NOT PUSHED; shots in docs/shots/privacy-*.png, need Chris yes before push)
- After push: cardflip.io/privacy shows effective date October 17, 2026 and the new lines (Google/X sign-in, help chat, phone notifications, email, Delete account path, what stays after a delete, Fastmail).

## 10-16 ~9:30pm ET: account delete takes the mail log + card-removal log (5299b9fe, NOT PUSHED; local test:deletesocial PASS)
- After push: on prod, run (SELECT only) `SELECT COUNT(*) FROM email_sends WHERE user_id NOT IN (SELECT id FROM users)` once a deleted account exists, expect 0 for accounts deleted after the push. No phone test needed (the delete button itself is unchanged).

## 10-17 ~1am ET: price guard 1c, week's climb eBay asks don't back (b2a51efb, PUSHED 10-16 ~8:08pm ET; PASS ~8:20pm ET by curl: 3 hidden, Latias + Mewtwo shown)
- After push, curl each and expect "This price looks off": /cards/pokemon/lost-thunder/lugia-gx--sm8-227, /cards/pokemon/hidden-legends/regice-ex--ex5-97, /cards/pokemon/delta-species/tyranitar--ex11-16. Still a price (fair climbs): /cards/pokemon/celestial-storm/latias--sm7-107, /cards/pokemon/team-rocket-returns/rockets-mewtwo-ex--ex7-99. Lugia Secret Wonders + Tyranitar H28 stay shown (admin 'keep').
## 10-16 ~4pm ET: no extra rows sitewide (NOT PUSHED)
- Phone: Watchlist tab tiles, Search > My Watchlist, Inventory summary bar ("Show" stays; only the arrow when the totals are too long for it), homepage game tiles, a card page's price chart (date buttons always under the price on phones). Prices and the ▲/▼ % all stay on one line. Local check: iPhone WebKit shots at $99,999.99.

## 10-16 ~2:30pm ET: Watchlist price pill on one line (NOT PUSHED)
- Phone: Search tab > My Watchlist. Every tile shows the price and the ▲/▼ % on ONE line (Charizard $134.86 ▼ 5.0% was 2 rows). Tiles are a bit wider (142px). Local check done with test tiles up to $99,999.99.

## 10-16: FLIPBACK code + come-back mail (NOT PUSHED, b9ba3bd2..8cbfbacb). Local pass: link signed-out -> login -> +10 scans; Account box "already used"; header "10 free scans"; full npm test green
- [ ] 10-17 morning: how many redeemed (SELECT COUNT(*) FROM promo_redemptions WHERE code='FLIPBACK') + returning visits in admin Analytics; tell Chris.
- [x] DONE 10-16 ~12:10pm ET: preview 16, two [TEST] mails read by Chris (subject "Your CardFlip code is inside: 10 scans on us", no "free"), SENT 16/16, 0 failed; preview after = 0 (no repeats).
- [ ] Prod: password reset mail arrives (forgot-password) — local has no SMTP, unchecked.
- [ ] Prod: a returning trial user taps the mail button -> lands on scanner with N+10 free scans (watch promo_redemptions + admin Users).
- [ ] Prod: Inventory tiles load the ?w=400 copy (Network: ~20-40 KB each, not 300+ KB) on a real scanned photo.
- [ ] Prod: a Google sign-in of an existing account still lands signed in (b1190519 only touches unproven-email links).
- [x] PASS 10-16 local: /api/ebay/comps with id base1-4 + name "Magikarp" searches "Charizard 4" (audit #1).
- [x] PASS 10-16 local: /api/cron/emails?force=1 and /api/cron/social-video without a key -> 403 (audit #4).

## 10-16 ~1:30pm ET: junk "this week" moves (1pm head to head printed Alpha/Beta parked listings as -69%/-79%)
- [ ] 7pm post (all sites + TikTok 7pm video): no Magic "+x% this week" card; Magic shows at today's price only. Pause lifts 10-21 (MTG_CAP_DAY_END in social.ts: remove the check after).
- [ ] 10-17 1pm post: any card's "this week" old price is not a 30+ day flat number (read its series with scripts/_peek-series.mjs).
- [ ] Delete route: the 5 junk 1pm posts (Bluesky/X/Facebook/Instagram/Threads) are gone; Instagram may need the app by hand.

## 10-16: Inventory speed (NOT PUSHED, 2b110bac price guard "+game"; a6313308 folders once)
- [ ] After push, mine: pane signed in on cardflip.io/app/collection, performance entries: /api/cards/live-prices and /api/cards/value-history under ~1 s each (were 5.7 s / 5.3 s), /api/cards/categories once. Also a card page + /cards/pokemon set page still load (same guard code).

## 10-16: cookie bar above the phone tab bar (NOT PUSHED, 605458fe; Chris approved the screenshots)
- [ ] After push: only UK/IE visitors see it, so mine: pane at 375px on cardflip.io/app with sessionStorage cf_geo="GB" and no cf_consent cookie → bar sits above the tabs, tabs tappable.

## 10-16: number keypad on price boxes (NOT PUSHED, d326a66b)
- [ ] Chris, phone, after push: 1. Open Inventory. 2. Tap a card's "What did you pay?" (cost) box. You should see a number keypad with a "." key, not the letter keyboard. Same for the sold-price box.

## 10-16: duplicate-email fix, audit #9 (NOT PUSHED, eb95dd75). Local: test:campaigns + test:digest green incl. two overlapping runs
- [ ] After push: next Sunday 10-18 digest + 6:30pm ET week mail: /admin/emails log shows one "sent" per person, no repeats; `SELECT COUNT(*) FROM email_claims` > 0. (Mine.)

## 10-16 ~9:30am ET: site-audit fixes (NOT PUSHED, ddea8db2..36c2e6a5; docs/AUDIT-2026-10-16.md)
Mostly server guards, proven by local tests; these are the prod checks after the push.
- [ ] eBay comps (#1): on a card page / scan result, "eBay listings" still loads comps for a Pokémon and a Magic card (catalog lookup in front of the cache). (Mine, pane.)
- [ ] Cron routes (#4): `curl -s -o /dev/null -w "%{http_code}" https://cardflip.io/api/cron/emails` → 403 even when signed in to /admin in the pane (open it in the pane: 403). The 10am/6:30pm mail sweep and the 9:15pm TikTok net still run (Vercel cron with the key): check /admin Log next morning. (Mine.)
- [ ] Stripe $0 (#7): no live check needed unless a 100%-off code exists in Stripe; next real renewal still credits scans (watch the Errors page / stripe log). (Mine.)
- [ ] eBay quantity (#10): next real card push lists Quantity 1 on eBay. (Mine, eBay Seller Hub view.)
- [ ] Login lockout (#5): 11 wrong passwords for a test email from one network → 429; the same email from another network still answers "Incorrect email or password". (Mine, curl with two IPs is not possible on prod; trust tests unless a lockout ticket shows up.)
- [ ] Google/X link (#3): nothing to see; tests only.
- [ ] Scan give-back cap (#6): a normal seller's "No match found" still gives the scan back (watch the header counter go back up after a miss). (Chris, phone, next scan session; just notice.)
- [ ] Inventory thumbnails: /app/collection on a phone, tiles show the seller's photos sharp at tile size; DevTools/network shows card-image?…&w=400 at ~20-40 KB each; tapping a card still opens the full photo; eBay push still sends the full photo (no w). (Mine, pane at 375px, SCREENSHOTS TO CHRIS BEFORE THE PUSH.)
- [ ] Inventory chart: one /api/cards/value-history request per visit (was two). (Mine, pane network.)
- [ ] Trial ration: a normal new signup still gets the 5 free scans (watch the next real ad signups in /admin funnel: trial_scans_used 0 on fresh accounts). If several real signups from one carrier land on the Booster wall, raise TRIALS_PER_BLOCK_DAY (signupGuard.ts, now 5). (Mine, /admin.)

## 10-16 ~3:05am ET: scanner screen + earlier unpushed batch (PUSHED 3f3ba57f 10-16 ~3:05am ET)
- [ ] Scanner (phone, cardflip.io/app, Scan): corner brackets only, no moving box, no green; above them "Line the card's edges up with the corners". Too dark / glare shows the amber hint there instead.
- [ ] Scanner: a binder card in its pocket scans as the card (no "slab"), three times in a row. (Tap crop grows at most 8 % past the guide now.)
- [ ] Scan result facts panel: label reads "List it at", link "vs N listings" (shows after a real scan + "Yes, this is my card").
- [~] CODE-CHECKED 10-16 (SessionProvider keeps window.location.search; live run needs a sign-out, skipped) Login keeps the link's query: open cardflip.io/app?x=1 logged out, sign in, you land on /app?x=1 (15698b36). (Mine, pane.)
- [ ] Emails with card pictures (price alert, digest): pictures load from cardflip.io/pics, not Scryfall / tcgdex (dcc21110). (Mine, /admin emails test send.)
- [ ] /admin emails: the test button counts seconds while a slow email builds (f08f46b7). (Mine, pane.)
- [x] PASS 10-16 (curl 404) /api/dev/outline-dump answers 404 on cardflip.io. (Mine, curl.)

## 10-15 ~2:00pm ET: fixes found while working the open-tests list (in the 10-15 batch push)
- [ ] Ad signup (A36): from cardflip.io/scan, Sign Up, finish: you land in the app with the SCANNER OPEN (it landed shut since 10-06). Close it, go to Inventory and back: it stays shut. (No new account for Chris and none made by me on prod: proven on local dev; on prod watch the next real ad signups reach a scan in the /admin funnel.)
- [ ] Insights (A10): your Magic Insights headline equals the chart's last number; Opposition Agent shows its foil price there too. (Mine, pane.)
- [ ] /scan used visitor (A1): no flash of the Scan button before "Your free scan is used". (Mine, headless on prod.)
- [ ] Failed scan message reads "Couldn't read this card — retake..." with no "(0% sure)".
- [x] PASS 10-16 (curl 404) /api/dev/outline-dump answers 404 on cardflip.io. (Mine, curl.)

## 10-15 ~9:45am ET: scanner options button, game + card + scanner options in ONE sheet (NOT PUSHED, 3e8e0caa; Chris: keep them combined)
Phone steps: 1) Open the scanner. 2) Tap the "..." circle top right. You should see "Scanner options": Game chips (all five fit), New scans start as (5 conditions), Camera (Light on phones with one, Tips switch), Share, Help. 3) Tap Lightly Played, Done, scan a card: it starts as Lightly Played. 4) Tap Share: the phone share sheet opens with cardflip.io. 5) Help > Open lands on the help page.
- [ ] Sheet opens from the "..." button, nothing cut off at phone width
- [ ] Starting condition sticks on the next scan; Light switch turns the light on; Tips switch brings the tips back
- [ ] Share opens the phone share sheet; Help opens the help page

## 10-15 ~9:00am ET: scanner "Select Your Card" picker restyled (NOT PUSHED, 69f340c5 on top of the 5 scanner commits)
Phone steps: 1) Scan any card. 2) On the result card tap "Not this card?". You should see a sheet titled "Select Your Card" with a "Find matches" box and a Search button on top, then two columns of big card pictures with the name, set and number under each. 3) Tap one: the sheet closes and the result card swaps to it. 4) Open it again, type a name (e.g. "charizard"), tap Search: the grid fills with that name's printings. 5) Swipe the handle down: it closes.
- [ ] Picker opens, pictures big and sharp, names/sets wrap (no cut-off text) at phone width
- [ ] Tap a picture swaps the card; search by name fills the grid; swipe-down closes

Things that shipped but were never exercised on a real phone or with real
traffic. Tick when tested; note what you saw. Newest batch first.

## 10-14 ~11:35pm ET: Magic hub phone overflow + Yu-Gi-Oh! tile alt text (NOT PUSHED, 7528e5ec + the next commit)
Found while ticking A22 in the pane at 375px: /cards/magic measured 386px wide (11px sideways scroll) because the Sets list's single phone column is auto-sized and the nowrap name "Teenage Mutant Ninja Turtles Source Material" widened it; /cards/pokemon was 375. Fix: grid-cols-1 on the list (minmax(0,1fr)); the same class change proved 375 live in the pane DOM. Also the homepage games strip Yu-Gi-Oh! tile alt text now drops "(Worldwide English)" like the visible name.
- [ ] PROD after the push, phone: /cards/magic Sets list, no sideways scroll, long set names end in "…"; /cards/pokemon unchanged.
- [ ] PROD: homepage HTML has no "(Worldwide English)" anywhere (curl).
## 10-14 ~9:00pm ET: robot upgrade (Sonnet 5.5, objections sheet, escalation, 3 actions, thumbs, /admin/robot, replay test) + price-page links in the app (PUSHED 1eb76012 10-14 8:58pm ET after Chris approved the screenshots)
Chris: "do them all and push" on the six robot ideas, then "if you can fit it without causing row and overlapping issues" on the card-page links, then "can i get screenshots before you push". Code: HELP_MODEL claude-sonnet-5-5, effort low, max_tokens 1500; OBJECTIONS sheet (10 lines) as a cached system block; rule: first unhappy money/limit message = heard + free path + offer the human, no second explanation; actions {{giveback}} (re-checks the last 15 min of scans with giveBackNoMatchScan, result line replaces the tag), {{resend_code}} (issueAndDeliver, only when unconfirmed), {{card:Name}} (button "Find <name> in Inventory" -> /app/collection?q=<name>, Inventory reads ?q= on mount); account facts now list the 8 newest cards + removals in 7 days; help_messages.rating + POST /api/help/chat/rate + Helpful/Not helpful under each robot reply; /admin/robot lists 7 days of chats (thumbs-down first, then stuck, then newest) with the thread, linked from the overview's Help chat tile; scripts/test-help-replay.mjs replays scripts/help-replays/*.json against the real model when ANTHROPIC_API_KEY is set (SKIPs otherwise; not in npm test). Search: "Want to wander by set? Browse the Card Prices pages." under the set tiles; card sheet (Search, Inventory, Watchlist): "Full price page →" beside MARKET -> the public card page. Tests: helpchat (pins updated + 14 new checks), apiauth, emailconfirmui green; tsc + eslint clean.
- [x] PASS 10-14 9:05pm ET (pane, Chris's account, 1eb76012 live): Jenny's words -> "Seeing prices is free: type a card's name in Search Cards ... scan only the ones you can't." + Open Search Cards button; "but why" -> "That's fair: you want to find out what your cards are worth without spending anything, and Search Cards still does that for free. If you'd like a person to hear this, I can open a support ticket ... Want me to open one?" + ticket button. No second price explanation, no "other apps".
- [x] PASS 10-14 9:06pm ET: "my last scan found nothing, did it count against me?" -> explains the auto give-back, then "I checked: no scans in the last 15 minutes to give back." No {{ }} shown. Chat cleared after.
- [x] PASS 10-14 9:35pm ET (pane: "where did my Sylveon ex go" named all three copies + the button). FOUND: the button value carried the set ("Sylveon ex (30th Celebration 153)"), so the Inventory filter would miss; fixed locally (name only in splitReply + prompt), NOT PUSHED, batch with the next push. Recheck after: the button reads "Find Sylveon ex in Inventory" and Inventory opens filtered.
- [ ] PROD, phone: Helpful / Not helpful under every robot reply; tapping sticks (reload keeps it); /admin/robot shows that chat first with "1 not helpful".
- [ ] PROD: /admin overview Help chat tile "read the chats" link -> /admin/robot; threads expand/collapse; times ET once (no "ET ET").
- [ ] PROD, phone: Search tab idle: the Card Prices pages line under the sets, nothing clipped; opened card: "Full price page →" sits right of MARKET on one line, opens the public page for that printing (308 to the exact set is fine).
- [ ] PROD, phone: Inventory, open a card: same "Full price page →" link; Watchlist sheet too.
- [ ] Local with a key some day: `npm run test:helpreplay` (Jenny replay, ~3 model calls) passes.

## 10-14 ~8:50pm ET: "Prices are free" on the out-of-scans wall, Search Cards open after the trial, robot says it first (PUSHED 6714a500 10-14 8:33pm ET)
Jenny's ticket #1001 ("why do we all need to buy it if we just want to see the prices"): she hit the wall after 5 scans and nothing told her lookup by name is free; the robot repeated the prices three times and said "same model most apps use". Chris: "make your recommended changes also". Code: SubscriptionGate opens /app/price-check for a walled account (server still 402s a save); Paywall (trial, not lapsed) gets a "Just want a price? That's free." box with a Search Cards button above the plans; robot rule: prices free / scans paid, say once, link Search Cards, never argue or compare to other apps; scan-limits help article gets the same sentence. Tests: emailconfirmui (gate pin updated), helpchat, quota green; tsc + eslint clean.
- [ ] PROD after the push, phone, an account with 0 trial scans (Jenny's view): /app shows the wall with the "Just want a price? That's free." box first; Search Cards button opens Search and it works (name search, prices); Scanner still walled.
- [ ] PROD: the same wall for a LAPSED subscriber has no free-price box (plans only).
- [ ] PROD: robot, as a 0-scan trial account, "why can't I just have free scans": first reply says lookup by name is free and offers Search Cards, no second price list, no "other apps" line.
- [ ] Jenny: watch for a reply on ticket #1001 (Chris answered 8:29pm ET; mail goes out on reply, she is Google-verified).

## 10-14 ~8:20pm ET: scanner Xs redesigned: row "Clear" keeps the card, delete only in the card view, top X is "Done" (PUSHED c787d5b0 10-14 8:23pm ET)
Chris (phone screenshot, Sylveon rows): the × on each scanned row deleted the card from Inventory with a 5-second Undo, and sat under a top × that just leaves the scanner; Jenny tidied her list with them and lost all 5. Chris: "let's go with your picks". Now: (1) the row control is a small "Clear" pill (list row, the reveal chip after a scan, Verify All rows); it only takes the row off the list, the card stays in Inventory, toast "Cleared <name> — still in your Inventory" with Undo; a row cleared before its save landed still saves. (2) The only delete is the card view's "Remove from Inventory" button, which opens the in-app confirm "Remove <name> from your Inventory? Scanning it again uses another scan." / red "Remove card"; toast "Removed <name> from your Inventory" with Undo. (3) The top-right × (went to Inventory) is now a "Done" pill, same action. First version (confirm on the ×, f024dbd6) was replaced by this in the same evening.
- [ ] PROD after the push, phone: scan a card; the row's right side reads "Clear" (no ×); tap it: row gone, toast says still in Inventory, Inventory shows the card.
- [ ] PROD, phone: open a card, "Remove from Inventory" at the bottom: the sheet names the card; Cancel keeps it; Remove card removes the row and the Inventory card (Undo toast, 5 s).
- [ ] PROD, phone: the reveal chip right after a scan and the Verify All rows show "Clear", same behavior.
- [ ] PROD, phone: top right of the scanner reads "Done" next to Connect eBay / Send to eBay and lands on Inventory; nothing wraps at 375px.
- [ ] PROD: a "No match found" row's Clear just clears, toast "Cleared".

## 10-14 ~8:15pm ET: removal log in the admin console + save-failed line (PUSHED c787d5b0 10-14 8:23pm ET)
Chris: "why 5 trial scans but 4 cards" (Jenny jporter1421) -> later "why did her cards go to zero". Prod card_removals (live since 10-13) answered it: she deleted the Umbreon at 7:58pm ET and the other four at 8:05pm ET herself (bulk, after tapping Looks right on each). Code: /admin/users Cards cell shows "N removed" (grey) and "N save failed" (amber) under the count, phone row too; new POST /api/cards/save-failed writes a card_removals row (how = 'save-failed', card_id = the scan id) when both tries at POST /api/cards came back empty after the card showed. Charge rule unchanged. Tests: test:cards (4 new checks), test:apiauth, test:adminroutes, test:admin green; tsc + eslint clean.
- [ ] PROD after the push: /admin/users, Jenny's row reads 0 cards with "5 removed" under it; the phone layout shows "5 removed" in the small line.
- [ ] PROD: an account that never deleted anything shows only the count (no extra line).
- [ ] Later: first "save failed" line on any account -> open that user's card_removals row and the matching scan_usage id; decide the refund-unkept question after a week of rows.

## 10-14 ~4:15pm ET: page review fixes (chart label, printings strip, set names, homepage Card Prices block, game tabs) (PUSHED c787d5b0 10-14 8:23pm ET)
Chris asked for a review of the homepage, /cards/pokemon and the 1st Edition Charizard page, then "yes on everything". Code: chart header prints the variant through formatVariantLabel ("Market · 1st Ed. Holofoil", was "1stEditionHolofoil"); the "Other <name> cards" strip is cached per name WITHOUT the page's own card excluded and filtered at read time (the old v2 memo excluded only the page that built it, so every sister page listed itself); a hand call on /admin/prices now drops that card's cached lists (set top, other printings, game top: dropCardLists) so a hide shows on the next page build; set names print "Trainer Kit" / "Best of Game" (tidySetName, sets memo bumped to v4); homepage games strip drops the Yu-Gi-Oh! "(Worldwide English)" qualifier; new homepage section "Know the card? Look it up." with the five game hub pills + All Card Prices + Price Movers, between Every game and Built for the pile; game hub pages get a game tab row (current lit) above the search. Local: tsc + eslint clean, cardpages 288/288, listcache, adminroutes green; pane desktop + 375px checked.
- [x] PASS 10-14 8:30pm ET (curl: "1st Ed. Holofoil" in the page, no raw 1stEditionHolofoil in text): PROD after the push: /cards/pokemon/base-set-1st-edition/charizard--base1-4-1st chart header reads "Market · 1st Ed. Holofoil"; a reverse holo card reads "Reverse Holofoil".
- [x] PASS 10-14 ~10:10pm ET (curl: 12 sister links, no self, no Base Set link, no $968.91): PROD: same page, "Other Charizard cards" no longer lists the 1st Edition itself and no longer shows the hidden Base Set $968.91 (first visit rebuilds the v3 memo with the hide applied).
- [ ] PROD: /admin/prices, hide any cheap card, then open its set page + a sister printing's page: the number is gone right away (not a day later).
- [x] PASS 10-14 8:30pm ET (curl: both names present; H1/breadcrumb not yet eyeballed): PROD: /cards/pokemon sets list reads "SM Trainer Kit (Alolan Raichu)", "Best of Game"; the set page H1 + breadcrumb match; links still open (slug unchanged).
- [ ] PROD, phone: homepage section after the games strip: eyebrow Card prices, "Know the card? Look it up.", five pills (Pokémon ... Yu-Gi-Oh!), "All Card Prices · Price Movers" line; pills open the hubs.
- [ ] PROD, phone: /cards/pokemon shows the five game tabs under the intro, Pokémon lit; tapping Magic opens /cards/magic with Magic lit.
- [x] PASS 10-14 ~10:10pm ET (curl: visible text clean; only the picture alt text still had it, fixed locally, not pushed): PROD: homepage games strip Yu-Gi-Oh! tile set name has no "(Worldwide English)".

## 10-14 ~4:10pm ET: phone nav shows How It Works / Features / Card Prices (PUSHED c787d5b0 10-14 8:23pm ET)
Chris (phone, logged out): the top nav was missing the three page links; they were hidden under sm on purpose. Now every link shows on phones and wraps into two rows (search + the three pages, then Pricing / Log In / Get Started); header about 40px taller. Pane 375px: no sideways scroll, rows balanced.
- [ ] PROD after the push, phone, logged out: home nav row 1 = search, How It Works, Features, Card Prices; row 2 = Pricing, Log In, Get Started; nothing clipped; same on /features and a /cards page.
- [ ] Phone, logged in: row 2 reads Pricing, Log out, Open the App.

## 10-14 ~3pm ET: suggested price follows the seller's shipping pick everywhere (PUSHED c787d5b0 10-14 8:23pm ET)
Chris on his phone: Sylveon ex 30th Celebration showed eBay asking $50.26 in the scanner but eBay Suggested Price $55.75 in Inventory ("we can't have mismatch prices"). Cause: the scanner priced the Envelope pick (stamps $1.31), while the Inventory live refresh, alerts, weekly digest, insights, inventory value, reprice nudges and the public collection all called askingPriceFor without the row's shipping_method, so they priced the tracked default ($6.07) and the refresh overwrote the scanner's $50.26. Fix: lib/fees.ts shipMethodOf(row) threaded into all seven + the Inventory cost note. Tests: liveprices (3 new checks), cardalerts, digest, inventoryvalue, profit, publiccollection, pricing green; tsc clean.
- [ ] PROD after the push, phone: Inventory, open the Sylveon ex (Envelope pick): eBay Suggested Price reads $50.26 (same as the scanner's eBay asking) and the note says "$1.31 envelope postage".
- [ ] PROD: a card with NO pick yet over $20 still reads the tracked number (unchanged), under $20 the $0.78 envelope number.
- [ ] PROD: Inventory total / Market value chart (asking basis) still adds up after the refresh (sum of the rows).
## 10-14 ~11am: 22-commit batch (hand calls, eBay slab-free links, flaky test fix, OP SAMPLE re-check) PUSHED d3a938f2 (+ 01aa52f2 test fix)
- [x] PROD: /cards/pokemon lists each Trainer Gallery set ONCE (10-14 10:35am: curl, 0 duplicate set links, 4 TG sets x1).
- [x] CI: main went RED on d3a938f2 (test-social-publish-csrf still sent ?key=, dropped by 84467a80) -> fixed 01aa52f2, CI + smoke green 10:33am. test-campaigns Thursday check passed in the same run.
- [x] PROD: hand-call keep on a card the referee never read returns 200 (0e48b666): 128/128 PriceCharting keeps POSTed 10:30am, all 200; /admin/prices tile "382 called by you", 0 to check.
- [ ] 10-15 2am log: One Piece SAMPLE-stamped pictures re-checked daily (45ee7180), line present.
- [x] PROD: Search "Buy" link excludes slabs (-psa -bgs -cgc -sgc -graded -slab) (10-14 10:40am, /app/price-check "Charizard 4").

## 10-13 (added to this list 10-14 9:15pm ET, was missing): Yu-Gi-Oh exact-printing pictures + Magic TCGplayer-only run + backup during writes
Commits 4057fc76 (1,426 Yu-Gi-Oh rows TCGplayer has no scan of get exact-printing pictures from Yugipedia + CardTrader, screened by eye; PUSHED 83ddd479 10-13), d92fd959 (189 more, 44 still borrow a sibling's picture and retry nightly; PUSHED 30615a64 10-14 ~5:20am), ca474dfe (the Magic picture run is TCGplayer-only, no Scryfall fallback; PUSHED 83ddd479), cd3b08ff (the nightly backup survives live writes during the copy; PUSHED 83ddd479).
- [x] PASS 10-14 ~10:25pm ET (5 random sets, 284 tiles keyed to their own id, 20 eyeballed, no SAMPLE): PROD: open 5 random Yu-Gi-Oh set pages (/cards/yugioh/...): every tile is a picture of THAT printing (set code on the card matches the set), none a SAMPLE stamp or a sibling's art.
- [ ] 10-15 2am log: the nightly run's Yu-Gi-Oh line shows the 44 borrowers retried (count went down or "0 failed").
- [ ] PC backup log (nightly): one run completed while the catalog run was writing, no "database is locked" line.

## 10-13 ~6:45am ET (added to this list 10-14 9:15pm ET, was missing): asking-only TCGplayer prices over $20 blank; serial-numbered cards skip the 15x guard (4d494331, PUSHED 83ddd479 10-13)
Chris's rule (memory cardflip-odd-prices-check-ebay): a price that is only an asking price, over $20, shows nothing rather than the ask. Applied to the Yu-Gi-Oh daily + weekly fills and the Magic fill; serial-numbered Magic cards (1/500 style) are allowed to be 15x their printing without being blanked.
- [x] PASS 10-14 ~10:25pm ET (Hamon Unlimited, TCGplayer ask $350 no market, and B.E.S. Covered Core $99.99: no price; Uria 1st keeps $999.97, real market price): PROD: a Yu-Gi-Oh card with no sold data and a TCGplayer ask over $20 shows no price (card page says the price is unsure / blank), under $20 still shows the ask.
- [x] PASS 10-14 ~10:25pm ET (Bitterbloom Bearer Lorwyn Eclipsed #352 serialized foil $2,964.84 vs $13-31 normal): PROD: a serial-numbered Magic card (e.g. a 1/500 Secret Lair serialized) keeps its high price instead of being blanked by the 15x guard.

## 10-13 ~3pm: every card picture from our storage (PUSHED 83ddd479)
Chris saw blank One Piece hub tiles: the hubs' "most valuable" lists were cached 10-12 7pm ET (before pictures) with optcgapi links, which lists hide. Fixed: 22,946 stale card_cache tile lists deleted on Turso (seo:top/settop/printings/movers/namelist); 3,636 One Piece prod rows still had the optcgapi image_url (10-12 twin-first change was local only) -> copied from local; code (ee70b040): set completion, Magic big picture (scanner tiebreak keeps Scryfall via mtgReferenceImage), homepage featured card + wall, scan stage cards, email movers; 83ddd479: saves (cards, edits, watchlist, price checks) store our copy (ownPictureUrl); 143 old prod user rows rewritten to cardflip.io/pics (12 left: 11 blank no-id rows, 1 Japanese card). Dev: hubs, homepage, /scan, movers = 0 outside pictures, 0 blank; 100/100 tests.
- [ ] PROD after the build: /cards/one-piece, /cards/pokemon, /cards/lorcana: 12 of 12 tiles show, all src cardflip.io/pics (curl count of outside hosts = 0).
- [ ] PROD: homepage hero card + wall + games strip all /pics.
- [ ] PROD: Chris's Inventory + Set Completion + Watchlist pictures all load (right-click = cardflip.io/pics).
- [ ] PROD: scan a Magic card: the tiebreak still identifies (now reads mtgReferenceImage).
- [ ] Open: One Piece top tiles are SAMPLE-stamped alt-art scans (TCGplayer has nothing cleaner); retry for clean scans in the auto new-cards job.

## 10-13: nightly eBay referee + /admin/prices "Price checks" (PUSHED 83ddd479 10-13 ~1:30pm ET)
Chris 10-13: "make the daily price check against eBay automatic". Every $100+ printing (4,550 on 10-13: Magic 1,801, Pokemon 1,527, YGO 640, One Piece 424, Lorcana 158) is read against eBay's ACTIVE fixed-price listings (Browse API; sold data is denied) up to 900 calls a night, 8:15am + 8:45am ET (cron /api/cron/ebay-referee, 12:15 + 12:45 UTC). lib/ebayReferee.ts = printing-aware matcher + rule (hide at 1.5x the upper NM asks with 3+ asks; vintage pre-2010 needs 3x; 100x one ask); table ebay_asks; priceTrust test 0 (admin call) + 1b (eBay high). Prize sets, unknown rare tags, One Piece special versions and Lorcana/OP promo sets are never auto-hidden (>= $2,000 they go to the hand-check list). Calibrated on 58 eBay-SOLD-checked cards: 4 of 17 bad caught, 0 of 27 good hidden. Local run (366 read, 500 calls, 85 s): 13 hidden (Genex Axel $213,589, Bujingi Crane $199,379, Green Baboon $194,450, Tower of Babel $5,020, foil Llanowar Elves $954 ...), 91 to hand check. Pane: /admin/prices renders desktop + phone (folds, no side scroll); "Right, keep" moved Mewtwo Star to Your calls and the guard showed it; Undo put it back.
- [ ] PROD after the push: Vercel cron list shows /api/cron/ebay-referee twice; the next morning /admin/prices says "Last run ... read" with ~400-450 cards and ~900 calls, 0 failed.
- [ ] PROD: the /admin Overview "eBay API limits today" tile stays under the Browse cap (referee 900 + comps).
- [ ] PROD: a hidden card (e.g. search "Genex Ally Axel" Starstrike Blast) shows "This price looks off, check sold listings", not $213,589.
- [ ] PROD: on the phone, /admin/prices > Hand check: tap "eBay sold" (opens sold listings), then "Right, keep" or "Wrong, hide" on one row; it moves to Your calls; Undo returns it.
- [ ] After a week: every $100+ card has a reading (counts line: fine + check + hidden + not on eBay ~ 4,500).

## 10-12 night: marketing nav hydration error fixed (LOCAL, NOT PUSHED)
Since 10-08 the nav read the signed-in hint from localStorage while rendering, so for a signed-in visitor the server HTML said "Log In" and the browser's first paint said "Log out": React threw a hydration error on every marketing page and rebuilt the page in the browser (slower first paint, console error; new prod errors in OPEN-TESTS E #73 may include it). Now read through useSyncExternalStore with a server snapshot of false. Pane 10-12: fresh tab, signed in, card page: no console errors, nav shows Log out at once.
- [ ] PROD after the push, signed in on the phone: open cardflip.io and a /cards page: nav shows Log out + Open the App with no flash of Log In; error digest shows no new "Hydration failed" lines.

## 10-12 ~11:20pm: card pictures served from cardflip.io/pics + hotlink firewall rule (LOCAL, NOT PUSHED; rule is on Vercel in LOG mode)
Chris: "put in some safeguard so people cant use images hosted on our website". lib/pics.ts toPics() at the 4 readers, next.config rewrite /pics/* → Blob cards/, proxy.ts skips pics/, vision + ogArt fetch the store directly (fromPics). Local proof: Charizard 1st Ed page 19 of 19 card pictures on /pics, 200 image/webp, storage address 0 times in the HTML. Firewall rule "Card pictures: other sites' hotlinks" (Referer present and not cardflip.io/google/bing/ddg/yahoo/ebay/pinterest/facebook) added via API, action LOG.
- [ ] PROD after the push: a card page's pictures come from https://cardflip.io/pics/..., and view-source shows no "blob.vercel-storage.com/cards".
- [ ] PROD: `curl -I -H "Referer: https://example.com/" https://cardflip.io/pics/<a tile path>` → shows in Vercel Firewall as a LOG hit for the rule; `curl -I` with no Referer → 200 and no hit.
- [x] DONE 10-14 ~6:40am ET (rule switched to DENY, curl verified; OPEN-TESTS 10-13 E77): After ~1 day of LOG with no false hits (our own pages, Google Images, eBay): switch the hotlink rule to DENY.
- [x] Rate-limit rule ADDED 10-13 ~8:45am ET (Chris yes after the price check: $0.50 per 1M allowed /pics requests, us ~75k/month = ~$0.04): "Card pictures: bulk download rate limit", path pre /pics/, fixed window 60 s, 600 per IP, deny for 10 min (scripts/_fw-ratelimit.mjs, untracked). Read back active via the API.
- [ ] 10-14: game hub "most valuable" tiles and card-page "Other printings" strips still showed outside links (lorcast) on 10-13 after the push: they are 24 h DB-cached tile lists (cardPages cachedTiles, TOP_TTL_MS = 1 day) built before the deploy. Confirm they switched to /pics (curl /cards/lorcana and a Lorcana card page, count "lorcast").
- [ ] Scan a Pokémon card on prod: the picture tiebreak still identifies (it fetches our copy straight from the store via fromPics).
- [ ] A social/share picture (Share card) renders card art (ogArt fetches via fromPics).

## 10-12 late night: One Piece + Pokémon pictures self-hosted (LOCAL, NOT PUSHED; runs done on Blob + Turso)
One Piece 5,546 of 5,549 (3 have no picture anywhere, BACKLOG), 4,249 sourced from TCGplayer per Chris. Pokémon 22,315 of 22,315 (TCGdex high.webp; en_cards own_* columns; scanner + card/list pages read them). Local = Turso for both. Local proof: /cards/pokemon 24 of ours, 0 tcgdex; 1st Ed Charizard page 42 of ours, 0 tcgdex.
- [ ] PROD after the push: cardflip.io/cards/onepiece, open a set: tiles now SHOW (the optcgapi list-page block no longer applies, our copies are on our store) and right-click → ...blob.vercel-storage.com/cards/onepiece/...-tile.webp.
- [ ] PROD: cardflip.io/cards/pokemon → a set → a card page: picture from ...blob.vercel-storage.com/cards/pokemon/, sharp.
- [ ] PROD: scan any Pokémon card: candidate thumbnails load (now our store); identification unchanged.
- [ ] PROD: /app/collection sets page set logos still show (derived from en_cards.image_url, untouched).

## 10-12 night: Lorcana pictures self-hosted (LOCAL, NOT PUSHED; the run itself IS live on Blob + Turso)
Chris 10-12: "find card, save to our database and everything pulls from there." scripts/save-pictures.mjs --game lorcana --prod saved every Lorcana picture (3,469) to our Blob as cards/lorcana/<id>-<hash>.webp (500px page copy ~47 KB) + -tile.webp (240px ~15 KB) and wrote own_image_url / own_tile_url / own_image_src on the rows, local and Turso. Readers (tcgCards.ts, cardPages.ts, movers) prefer own_* and fall back to image_url; set-rank list cache bumped to v4 so lists switch at deploy. Nothing on the live site changes until this code is pushed.
- [ ] PROD after the push: cardflip.io/cards/lorcana, open a set, right-click a tile → the picture URL is mlwovvakovcpakbr.public.blob.vercel-storage.com/cards/lorcana/...-tile.webp (not cards.lorcast.io); a card page shows the ...webp page copy, sharp, not blurry.
- [ ] PROD: search "Elsa" from the header on a Lorcana page: result thumbnails come from our store too.
- [ ] PROD: Lorcana scanner candidates (scan any Lorcana card): the printing thumbnails load from our store; the scan still identifies the card (tiebreak still reads ref_image_url / image_url, unchanged).
- [ ] Weekly catalog sync (Sunday 10:30): sync:lorcana overwrites image_url but not own_*; a re-run of pictures:save --game lorcana afterwards saves only NEW or changed pictures (count printed on the first line, should be small).

## 10-12 ~3:30pm: Inventory summary postage = each copy's real rate (LOCAL, NOT PUSHED)
Was a flat $0.78 per copy everywhere (a $1,178.52 card read "Postage · 1 × $0.78"). Now salePostage (fees.ts): over $100 tracked $6.07 whatever was picked; otherwise the row's pick at its price (envelope $0.78 up to $20, stamps $1.31 to $100; tracked $6.07); no pick = the label up to $20, tracked above. Same rule in saleNet/saleBreakdown (sales report, CSV), the reprice sheet's "you keep", and the Listed panel. Pane 10-12: $41.12 no pick → "Postage · 1 × $6.07", fees $5.85, You Keep $29.20; hand-sold → "Postage $0.00".
- [x] (10-12 ~3:15pm ET Chris on the tunnel: passed) Tunnel, Seller mode, Inventory summary: the $1,178.52 Pikachu (svp-085) reads "Postage · 1 × $6.07" and You Keep on eBay ≈ $1,015.90 (was $1,021.19).
- [x] PASS 10-14 (Chris phone; OPEN-TESTS 10-13 A1): Mixed rates (one card under $20 with Envelope + one over $100): the line is plain "Postage" with the summed total, fees line still adds up to You Keep.
- [ ] Earned ledger after a real eBay sale over $20: postage shows the sold row's pick ($1.31 stamps or $6.07 tracked), the sales report page says the same in its footnote.

## 10-12 afternoon: Inventory Market Value = chart, Sales Report moved to Account (LOCAL, NOT PUSHED)
- [x] (10-12 ~2:45pm ET Chris on the tunnel, screenshots) Tunnel, Collector mode, Inventory: the big Market Value and the Inventory Value chart's last point are the SAME number (was $1,015.89 vs $1,178.52: the chart drew asking prices when it loaded before the Collector switch had saved; the page now sends ?basis= itself).
- [x] (10-12 ~2:45pm ET Chris on the tunnel, screenshots) Switch Seller -> Collector -> Seller on Account, back to Inventory each time: Collector chart says "market" and matches Market Value; Seller chart says "asking".
- [x] (10-12 ~2:45pm ET Chris on the tunnel, screenshots) Inventory summary has no "Sales Report for Taxes" link; Account > Selling has a "Sales report for taxes" row whose Open goes to the report.

## 10-11 night Shipping: envelope up to $100, real eBay prices (LOCAL, NOT PUSHED)
Prices from eBay's own calculator (ebay.com/shp/calc/rates) 10-11 and USPS Notice 123: eBay envelope label $0.78 (1 oz), stamps $0.82 + $0.49 nonmachinable = $1.31, Ground Advantage $6.07 (Miami → Seattle, same at 1 and 3 oz; nearby $5.38). Floor $1.25, a $0.25 card lists at $1.54.
- [x] (10-12 ~2:40pm ET Chris on the tunnel: "looks fine") Tunnel, scan a card under $20: Envelope tile reads "$0.78 · eBay Standard Envelope, tracked"; Tracked mailer "$6.07". (The "$" was missing on these tiles since 10-08, fixed here.)
- [x] (10-12 ~2:40pm ET Chris on the tunnel: "looks fine") Card between $20 and $100 (or type a price in that range): Envelope tile reads "$1.31 · Plain envelope with stamps" (no warning line, Chris 10-11); both tiles clickable.
- [x] (10-12 ~2:40pm ET Chris on the tunnel: "looks fine") Type a price over $100: Envelope greyed out, "Over $100, use a tracked mailer".
- [x] PASS 10-14 (Chris phone; OPEN-TESTS 10-13 A2): "How to ship" sheet on a $20-$100 card: stamp steps (Forever stamp plus 49¢, mark shipped in eBay).
- [x] PASS 10-14 (Chris phone; OPEN-TESTS 10-13 A3): Before any pick, a card priced over $20 is suggested as Tracked mailer (the no-tracking envelope is never the default).
- [ ] PROD, first real $20.01-$100 envelope publish: eBay accepts the new "CardFlip letter" policy (Standard Shipping, free) — only tested against a fake eBay so far; if eBay refuses it the card lists on the tracked policy.
- Known, not fixed: repricing a live envelope card across $20 keeps its original eBay policy (policy is picked at publish only; true before tonight too).

## 10-11 Sign-in code "Send a New Code" link after the code expires (prod /login, admin account)
- [x] (10-14 3:55pm ET Chris phone: pass, countdown then new code worked) On cardflip.io/login as truefreemoney, let the 6-digit code expire (or type a wrong one) so the red "didn't match or has expired" box shows, then tap the blue "Send a New Code" link under the code box: a new email arrives and that newest code logs in. Chris 10-11 ~8:30pm ET didn't see a button at first (the link sits small at the end of the "works for 10 minutes" line); if it does nothing on tap, that's a bug. Open question for Chris: make it a full-size button under the red box (visible change, screenshot + yes first).

## 10-11 Every empty scan given back + no category sheet with nothing scanned (9fc403ff, pushed 10-11 night as 5e4d662b)
- [x] 10-11 8:35pm ET, local dev with the real reader, driven from the pane: a drawn floss box read at 10% ("Couldn't read"), scans used went 0 → 1 → 0 after the give-back (POST /api/vision/scan/giveback answered refunded). Same path on prod after the push.
- [x] Tap Done on the camera after only that bad scan: NO "Which category?" sheet. Inventory has no new row. PASSED 10-11 ~8:45pm ET, Chris's phone on the tunnel: floss box = no match, counter stayed 0, Done opened no sheet.
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #1): Scan a real card, then tap Done: the "Which category?" sheet DOES open as before.
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #2): Scan a Magic card with Pokémon selected: "That looks like a Magic card" and the scan is given back too.

## 10-11 Game pills centred in the phone header (26e22043, pushed 10-11 night as 5e4d662b)
- [x] PASSED 10-11 ~8:45pm ET (Chris, tunnel). After a scan, on the phone: the Pokémon / Magic / Lorcana / One Piece / Yu-Gi-Oh! row sits centred in the header card, not hugging the left edge; all five still fit on one line on your iPhone.

## 10-11 Faster scans: tiebreak off the critical path, price wait 2.5 s → 1.2 s (PUSHED to main 10-11 ~9:10pm ET as a40dddb4, build ~2 min)
- [ ] Scan a card with two near-identical printings (a Trainer Gallery card like Eevee TG11, or any card with a 1st Edition twin): the card shows within ~3 s instead of waiting on the picture check; if the tiebreak later disagrees, the card swaps and a Check-match line says "the photo looks more like this printing than <set>".
- [ ] Verify a card quickly after it shows: a late tiebreak must NOT change it afterwards (verified wins).
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #8): Scan 5 cards in a row and time it against yesterday: the "Reading the card" wait feels shorter; prices still appear on the card (held price first, live price fills in).
- [x] /admin log: no new "scan: slow read" warnings beyond what was there before. (closed 10-11 ~10pm ET by Claude: PASSED, last slow-read warning 11:41am ET 10-11, none since the scanner pushes)

## 10-11 No-match scans given back (PUSHED to main 10-11 ~9:10pm ET in a40dddb4)
- [x] PASS 10-14 by prod data (brian: 4 no-match reads all given back, 1 of 5 used): Trial account: scan something that is not a card (a book cover, a receipt) so the queue says "No match found — search by name": the header scan counter does NOT go up (or goes up and comes back within a second), and /app/account shows the same trial count as before.
- [x] PASS 10-14 by prod data (Jenny: 5 matched reads = 5 of 5 used): Scan a real card right after: it still counts (the counter rises by one and stays).
- [x] CLOSED 10-12 (rule changed 10-11: refusals are given back too; OPEN-TESTS 10-11 #5 PASS): A token or an art card (Magic) says "not accepted" and DOES still count (that is a refusal, not a miss).
- [x] /admin > the user's row after a no-match scan: trial scans used did not rise; scan_usage keeps the row with refunded_at set (the vision bill is still real money). (closed 10-11 ~10pm ET by Claude: PASSED, prod scan_usage keeps both 10-11 7:50pm no-match rows with refunded_at set, draw trial:1)

## 10-11 Scanner post-scan header (9665f726, PUSHED to main 10-11 ~9:10pm ET in a40dddb4)
- [x] (10-12 ~2:45pm ET Chris on the tunnel: "fine") Phone, after a scan: the header card has no Seller · Collector switch; Add Cards and Inventory → are two equal-width pills on one row; Inventory → opens Inventory.
- [x] (10-12 ~2:45pm ET Chris on the tunnel: "fine") Phone: "1 card · $0.85" and "1 ready · 0 live · 0 pending" sit on one line each, Connect eBay (or Send to eBay) and the X beside them, nothing cut off.
- [x] (10-12 ~2:45pm ET Chris on the tunnel: "fine") Pre-scan screen, Account and Inventory still show Seller · Collector; the tour "Your switch" step still lands on it.

## 10-08 Pokémon hand map (dc9c0337, built by the first cloud session): 10 unpriced cards get a TCGplayer product
- [x] After the 10-09 5:25am ET Pokémon run: /admin price job result shows no error, and these have a USD series: Mewtwo Star ex13-103, Registeel Star ex12-92, Mudkip Star ex7-107, Deoxys ex pop4-17, Espeon Star pop5-16, Skyridge Gengar H09, Tropical Wind DP05/DP25/DP48, Tropical Tidal Wave np-27. Check /pokemon/mewtwo-card-value shows the Star with a price. (closed 10-11 ~10pm ET by Claude: DONE, Mewtwo Star ex13-103 and Lotad pl3-SH9 have USD series; the other 9 products are mapped but TCGplayer itself has no price for them (tcgcsv checked), nothing to fix our side)

## 10-08 real postage (Chris: "something tells me it's not a flat $5"): Envelope $1.11, Tracked $7.00, envelope only at $20 or less (eBay's rule)
- [x] (SUPERSEDED 10-12: replaced by the 10-11 night block, $0.78 / $1.31 / $6.07, envelope up to $100) Scan editor tiles read Envelope $1.11 / Tracked mailer $7.00; Envelope greys out above $20 (a $20.00 card still allows it, $20.01 does not); the note says "$20 or less".
- [x] Home page and /pricing fee math say $1.11 postage, not $0.75; a $0.25 card's suggested price is about $1.92 (floor $1.63). (closed 10-11 ~10pm ET by Claude: PASSED, prod home x6 and /pricing x4 say $1.11 postage, no $0.75 anywhere; $0.25 -> $1.92 is a CI check in test-card-pages)
- [ ] A real eBay Standard Envelope label at $1.11 or less buys for a card sold at $20 or under; Ground Advantage label through eBay for a 3 oz mailer lands near $7 (zones 1-5).

## 10-08 Mark as Sold asks once more (c35b831c; Chris: a sold record can't be undone)
- [x] (10-11 Chris, phone, new One Tap account: worked on the second scan; the first card had been deleted by an X tap before the save, which the old banner blamed on the connection, fixed bf433106) Inventory, a draft or ended card > Mark as Sold > price > Mark as Sold: the sheet turns into "Are you sure? This marks it sold for $X. It can't be undone." with Cancel (back to the price) and Yes, Mark as Sold. Yes records the sale.
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #25): Inventory bulk: select live cards > Mark sold (N): the same Are you sure sheet with the count; Cancel leaves them live; Yes marks them sold at asking price.

## 10-08 TikTok caption opener rotation (10b680b3; Chris: no more exact copies of previous posts' text)
- [x] 10-09 captions.txt (night render ~9:15pm 10-08): the three captions open with three DIFFERENT first lines, each still saying type cardflip.io in your browser; 10-10's 7am opener differs from 10-09's 7am. (closed 10-11 ~10pm ET by Claude: PASSED, 10-09 and 10-10 captions.txt: six different openers, each says type cardflip.io in your browser)
- [x] 10-09 posts with a new library sound each (not Funk it up, not Pokemon Theme Song): views in the first hour back above ~50 like the 7am/1pm posts, no repeat of the 10-08 7pm dead post. (closed 10-11 ~10pm ET by Claude: PASSED, TikTok Studio: every post since 10-09 7pm got 116-296 views, no dead post)

## 10-07 /admin/analytics chart redesign (tiles pick the one big chart)
- [x] (10-08 pane prod 375px: tapping Page views switches the chart to Page views / 154 before and scrolls to it; tooltip tap not tried) Phone: tap each headline tile; the big chart below switches and scrolls into view; tap/drag the chart shows the time, value and "Before".
- [x] (10-08 pane prod: ?from=2026-10-08&to=2026-10-08 → hourly axis 12 AM / 5 AM / 10 AM / 1 PM) Prod, a one-day custom range (both dates today) draws 24 hourly points, not one bar.
- [x] (10-08 pane prod: Visitors tile "38 before" = chart legend "The 1 day before · 38") The faint dotted "before" line matches the "N before" number under each tile.

## 10-08 Publish screen + Public pages blocks (TODAY-10-08.md 11:30 + 11:45) — checked 10-08
- [x] (Chris) Delete-account form warns about live cards. Email change on the Ben account: trial, no Stripe customer, nothing to follow (code updates Stripe on both paths; real proof needs a paid account — parked).
- [x] (pane, prod, 375px) /pokemon/charizard-card-value: title right, Scan → /scan?game=pokemon, tiles → card pages, Start Your Free Trial → /signup, no sideways scroll. Home Yu-Gi-Oh! pill one line.
- [x] (pane) Set with 300+ cards: /cards/magic/commander-masters/page/2 renders 249 cards, pager fine (no set has more than 2 pages at 300 a page, so wrapping never comes up).
- [ ] OPEN: Search page (/app/price-check) on a made-up name says "No cards matched that search." with NO "Card Missing? Tell Us" — the report button only lives in the scanner pick-by-name list and the card editor. Chris to decide whether it belongs on the Search page too.

## 10-08 Inventory 2 block (TODAY-10-08.md 11:10) — Chris 10-08: all 6 pass
- [x] Delete one card → Undo; delete again + leave → gone. Bulk delete keeps the live card, toast counts. Remove while saving → nothing left. Empty game copy. Set Completion "✓ Watching". Sold tile net = sticker.

## 10-08 shipping pick (seller picks Envelope or Tracked mailer before an eBay post)
- [x] Scan editor on the phone: "Shipping · pick one to post on eBay" with two tiles (Envelope $0.75 / Tracked mailer $5.00); Envelope greys out at a $100+ sale price; "? How to ship" opens the two-way sheet. (closed 10-11 ~10pm ET by Claude: OUTDATED, the $0.75/$5.00 tiles and $100 rule were replaced by $1.11/$7.00 and $20, see the real-postage block)
- [ ] No pick → the eBay post button shows "🔒 Pick a shipping option to publish"; after a pick the confirm line says free shipping for the buyer, postage already in the price.
- [x] (10-08 Chris: picked envelope, listing shows free shipping) First REAL publish with Envelope picked: eBay accepts the "CardFlip envelope" policy (service code US_eBayStandardEnvelope is unverified); if eBay refuses, the listing should still go out on the tracked policy.
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #32): Inventory: a live or sold card shows "How to ship it · <pick>" with the 4 steps; "Both ways" opens the sheet.
- [ ] After a real sale: the "Your card sold" push AND an email with the mailing steps land (daily sweep); check the email reads right on the phone.

## 10-08 scanner + inventory fixes from the test day
- [x] PASS 10-12 (Chris, tunnel; OPEN-TESTS 10-11 #12): Trial account on its LAST scan: scan it, close the camera → the out-of-scans wall shows right away, no page reload (867a4b69).
- [ ] Inventory with a card open: the round X next to Subscribe Now closes the card and shows the plain list; the Share button sits inside the card panel, not on the footer note (2fe6a947).
- [x] PASS 10-12 (Chris; OPEN-TESTS 10-11 #13): Scanner result: no "Check the art … Switch" banner on a card with a pricier twin (b23829db).
- [x] (10-08 prod HTML: Search icon comes before How It Works) Marketing nav on desktop: the search icon sits left of How It Works (abe7e70c). Phone: first in the second row (Chris 10-08: leave it there for now).

## 10-08 weekly emails rebuilt (/admin/emails), SHIPPED SWITCHED OFF, nothing to users until Chris approves
- [x] (10-08 pane: three sections, 5+3+1 versions each with preview + Send Test To Me, Scans versions show due counts) Prod /admin/emails loads: three sections (Scans · Tuesday 10am, Your cards · Thursday 10am, This week in cards · Sunday 6:30pm), every version has a preview + "Send Test To Me"; the Scans versions show how many people are due.
- [ ] Each "Send Test To Me" lands a [TEST] mail at truefreemoney@gmail.com; check on the phone: pictures load, prices read right, buttons open the right page, Stop link works.
- [x] (10-08 pane: subjects come from live data (Samurott mover; binder/never-scanned versions present); Chris eyeballed the versions 10-08 ~10am) Thursday previews come from live data: "No cards: binder list" shows three Pokémon or Magic cards $15-$200; "Never scanned" shows one card per game.
- [x] (10-08 pane: subject "This week in cards: Magic up, One Piece down" from live data; Chris reviewed 10-08 ~10am) Sunday preview: a line per game, biggest jump, set to watch, sleeper, scans this week (prices tracked since 09-30 note on the three young games is expected).
- [x] (10-08 /admin/system lists the four slots; OFF guard is in the route) Vercel cron list shows /api/cron/emails at 14:00 + 15:00 UTC Tue/Thu and 22:30 + 23:30 UTC Sun; a cron hit while OFF logs nothing and sends nothing.
- [x] (10-08 code: dailyJobs.ts no longer calls digest/campaigns) The old Sunday digest no longer sends from the daily job (Sunday 10-11: only the owner-copy of the week mail, if ON).
## 10-07 signup email typo hint (an ad signup typed @iclod.org and had to sign up twice)
- [x] (10-08 Chris, phone: works) Real phone: type name@gmial.com, tap Password → yellow "Did you mean name@gmail.com?"; tap it → box fixed, hint gone.
- [x] (10-08 covered by test:emailtypo (green)) A correct gmail/icloud address and a @hotmail.co.uk address show no hint.
- [ ] Fewer "Undelivered Mail Returned to Sender" bounces at support@ from signup welcome emails.

## 10-07 out-of-scans wall: quick-buy box at the top (first ad signup ran out of free scans in an hour)
- [x] (10-08 Chris, phone: "Your 14 cards are saved." + both buttons on the first screen) Real phone, trial account with 0 scans left: "Your N cards are saved." + "Buy 100 Scans · $4.99" + "Subscribe · $9.99/mo" all on the first screen, nothing behind the tab bar.
- [ ] Booster button opens LIVE Stripe checkout for $4.99 (local can't: local Stripe price ids don't match; passed at 375 px in pane otherwise).
- [ ] Subscribe button opens LIVE Stripe checkout for $9.99/mo.
- [ ] /admin: first Booster or plan purchase from an ad signup.

## 10-07 Continue with Google on /signup and /login (dark until GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are on Vercel)
- [x] Before the keys exist: n/a now, keys went live 10-07.
- [x] (10-08 Chris, phone) With keys, real phone, signed out: /signup shows the white "Continue with Google" button at the top, "or", then Username / Email / Password.
- [x] (10-08 Chris, phone: You're in, Chris; events + welcome mail not checked) Sign UP with a Gmail never used here: lands on "You're in, <first name>" with the free-scan count; TikTok + Google Ads each log ONE CompleteRegistration (refresh the page: no second one). Welcome email arrives. Account page shows Password as "Set" (no current-password box).
- [x] (10-08 Chris, phone: straight to /app) Sign IN again with the same Google account from /login: goes straight to /app (or the page you were sent from), NO signup event, no second welcome email.
- [ ] LINK: sign up with email + password first, log out, tap Continue with Google with the same address: same account, same scans and cards, password still works afterwards.
- [x] (10-07: prod callback with error=access_denied → /login?google_error=1; message itself seen in local test only) Cancel on Google's screen: back on the page with "Google sign-in didn't finish. Try again or use email."
- [ ] A Google-only account typing a password on /login sees the "signs in with Google" message; Forgot Password lets it set one.
- [ ] Second Google signup from the same phone/network starts with the free scans already used (same rule as email signup).
- [x] /admin and /admin/login look and behave exactly as before (code email, no Google button). (10-07 prod: no Google button on /admin/login)

## 10-07 signup: "First name" box renamed "Username" (4 of 6 Google Ads visitors left the signup form)
- [x] (10-08 Chris, phone: works) Signed out on a phone: /signup shows Username / Email / Password; empty Username says "Enter a username."
- [ ] /admin/adtest over the next days: Google Ads "Opened the signup page" → "Made an account" rate improves.

## 10-07 7 hashtags on X / Facebook / Bluesky (was 2/2/3); Instagram 5 and Threads 1 are platform limits
- [x] Next 7am post: open the live X, Facebook and Bluesky posts — 5 to 7 tags, each a working link (Bluesky = facets), caption still reads OK. (closed 10-11 ~10pm ET by Claude: PASSED for X (7/7/6 tags on the three 10-11 posts) and Bluesky (7 tag facets on the last six); Facebook not read)
- [x] X (257 chars) and Bluesky (300): tags are never cut below 5 on a long caption; if they are, raise fitText's floor. (closed 10-11 ~10pm ET by Claude: PASSED, Bluesky posts at 280-291 chars still carry 7 tags, X 6-7)

## 10-07 "Start Your Free Trial" button on /pokemon/<name>-card-value pages
- [ ] Real phone: button sits under "Scan Your X Card Free", tap lands on /signup.
- [x] Google Ads: signups from name pages show up in the 10-08 review. (closed 10-11 ~10pm ET by Claude: PASSED, 4 signups landed on /pokemon/charizard-card-value on 10-08)

## 10-07 "Works best on your phone" line on /scan and /app scanner
- [x] (10-07: on prod /scan; /app not checked) Desktop: line shows under the /scan headline and at the top of the empty /app scanner, one line.
- [x] (10-08 pane mobile emulation: hint is display:none on /scan; real phone still worth a glance) Real phone (iPhone + Android): line does NOT show on either page (checked only in pane emulation).

## 10-07 frozen-price guard (12297c12): cheapest-listing check + dead stale filter fixed
- [x] (10-07 0b35cbad, prod fetch 2:45 PM ET: "This price looks off, check sold listings", no $2,500; the card page never read listing_lows) /cards/pokemon/unseen-forces/lugia-ex--ex10-105 no longer headlines $2,500.00.
- [ ] Scan Lugia ex Unseen Forces 105 on a real phone: shows the "looks off, check sold listings" note, not $2,500.
- [x] Tomorrow's 09:45 UTC (5:45 AM ET) Pokemon run and 09:00 UTC (5 AM ET) Magic run write listing_lows for today (backfill wrote 2,837 rows on 10-07; readings older than 3 days stop counting). (closed 10-11 ~10pm ET by Claude: PASSED, listing_lows written every day 10-08..10-11, today 1,505 Pokemon + 394 Magic rows)
- [x] /pokemon/lugia-card-value, /pokemon/charizard-card-value, /pokemon/mewtwo-card-value: no frozen ($100+, flat 45d+) card in the tiles once the 1-day tile cache turns over. (closed 10-11 ~10pm ET by Claude: PASSED, prod top tiles: Lugia $531, Charizard $939, Mewtwo $824; no $2,500 frozen Lugia)

## 10-07 Charizard ad landing page + Skyridge headline fix
- [x] (10-08 pane 375px on prod: passes) /pokemon/charizard-card-value on a real phone: title, Scan button opens /scan with Pokémon picked, card tiles open their price pages.
- [x] (10-07 0b35cbad test 3b, prod fetch 2:45 PM ET: top, Holofoil and Reverse Holofoil rows all "looks off", no price) Skyridge Charizard 146/144 card page no longer headlines $2,999.99 (shows the "looks off" note instead, once its cache turns over).
- [x] First Google Ads click on the Charizard ad group lands here (admin attribution shows the path). (closed 10-11 ~10pm ET by Claude: PASSED, page_views has a googleads / signup-search visit on /pokemon/charizard-card-value)

## 10-07 phone fixes (d852a6c8) — passed in pane at 375 px, real phone not yet
- [x] (10-08 pane 375px: one line) Home game pill: "Yu-Gi-Oh!" never splits across lines.
- [x] (SUPERSEDED 10-08: the Active chip was removed in 09fff364; the status line under the price says it, seen on prod 375px) Inventory > View card: Active chip sits in the Market Price box corner (no own row).
- [x] (10-08 pane prod 375px: Added "Sep 29, 2026" whole on two lines, Change ▼ $0.18 one line) Inventory > View card: Added date not cut off; Change arrow + amount on one line.
- [x] (10-08 local pane: $48.00 = $48.00) Collector mode: Collection Value hero equals Summary Market Value (pane: Magic $111.78 = $111.78).

## 10-07 Google Ads tracking (campaign "Signup Test - Search")
- [ ] First real sign-up from an ad click shows under Google Ads Goals > Sign-up (label HuHPCKCx7JMdELLo2tVE) within ~48 h. Tag AW-18433356850 verified loading on prod 10-07.
- [ ] First Stripe purchase shows under Goals > Purchase (page-load rule on /app/account/welcome?billing=success, fixed 10-07 from the wrong /app/account?billing=success).
- [x] /admin attribution shows the sign-up as "Google Ads" (utm_source=googleads suffix). (closed 10-11 ~10pm ET by Claude: PASSED, signup_log has googleads signups on 10-07, 10-08, 10-09, 10-11)

## 10-08 game row
- [x] (10-12 ~2:40pm ET Chris on the tunnel, screenshot: no Collection value box) Collector mode Inventory: no "Collection value" box above the Market Value line (parked 10-08, Chris). The collection Share picture went with it; Insights page still has its own Share.
- [x] (10-12 ~2:50pm ET Chris on the tunnel: fine on Inventory + Set Completion; Packs ran 4px past its box border, fixed with GameToggle inCard, measured in the pane at 375px) Game row on Inventory, Set Completion, Packs and /scan (Chris 10-08 "hate the look of the bar"): one line of small chips, no box, scrolls sideways on the phone, a 0 count not printed. Check it on the iPhone in Inventory and on /scan.
- [x] (10-12 ~2:55pm ET Chris on the tunnel: "looks fine now") Packs page on the phone: the game chips row stops at the box border (Yu-Gi-Oh! no longer pokes past it); still scrolls sideways.

## 10-06 new features (audit section G)
- [x] 10-08 PASS iPhone (Chris: "share card feature works"; Android not checked) Phone: Share on a found card opens the share sheet with the picture; falls back to a download elsewhere.
- [x] 10-08 PASS iPhone (Chris: "share works on inventory") Inventory card sheet (tap a card): Share sits in the title bar beside the X and makes the same card picture (Chris 10-08 "inventory card should have a share also"). Not on sealed product.
- [x] (10-08 pane prod 375px: $111.90, ▼ $0.67 over 7 days, three movers, Share button present = Market Value $111.90; the picture itself is a phone check) Collector mode Inventory: value header shows total, 7-day change, top movers; Share makes the collection picture.
- [x] 10-08 PASS iPhone (tips line gone after the first opens; "Keep going for a whole stack" in its place; Got It itself not tapped) Camera tips line shows the first 3 opens, "Got It" hides it for good.
- [x] (10-08 added to the Search page too (49575e22), seen locally; prod report landing in /admin/support still to confirm) Search with no match shows "Card Missing? Tell Us"; the report lands in /admin/support as "Missing Card: …".
- [x] A card with a pricier twin in the candidates shows "Check the art…" and Switch swaps it. (closed 10-11 ~10pm ET by Claude: OUTDATED, b23829db (10-08) removed that banner on purpose; the 10-08 check "no Check the art banner" replaces this)
- [ ] Airplane mode on the phone inside the app shows the No Signal page; push still works after the worker update.
- [ ] Home-screen icon long-press shows Scan and Inventory shortcuts (Android; iOS ignores them).
- [x] (10-07) /cards/pokemon/movers and /cards/magic/movers listed in pages.xml after the sitemap cache turns over.

## 10-06 behind the scenes (audit section F)
- [x] (10-08 ~1:35pm ET: /admin overview shows no backup alert, so the stamp landed) **10-07 FAIL:** backup ran fine but the stamp died on "fetch failed" (not a read-only token). Stamp now retries 4 times (backup-turso.mjs) — recheck 10-08. 10-07 morning: /admin overview no longer says "No database backup on record yet" (tonight's 10:10 PM ET cloud backup should stamp backup_last_ok; if it still shows, the backup repo's Turso token is read-only — the backup log says "could not stamp").
- [ ] TikTok Ads Manager still records ViewContent / ClickButton from /scan after the pixel moved to load after first paint (events queue up to 15 s).
- [ ] Vercel logs: any "?key=" warning means something still sends the cron secret in the URL; once none for a week, drop ?key= support.
- [x] First Sunday digest after this still sends (prod mail env must be set; not checked). (closed 10-11 ~10pm ET by Claude: PASSED, Sunday "week" mail sent to 11 accounts (all made 10-07 or later) 10-11 6:30pm ET + owner copy)
- [x] (10-08: not readable from /admin; the daily result keeps logCleanup but no page shows it — needs a settings read; weekly rule = skips when last < 7d) **10-07 FAIL:** log_cleanup_last not set after the 10-07 daily run (4 expired password_resets still there). Daily result now records logCleanup — read daily_last_result 10-08 to see why. Weekly log cleanup ran: settings key log_cleanup_last set after a daily run. (closed 10-11 ~10pm ET by Claude: PASSED, settings log_cleanup_last = 10-08 9:01am ET; weekly, next run ~10-15)

## 10-06 TCGdex price referee (56bb80f)
- [x] (10-07: 192 rows, last day 10-07) After the 10-07 nightly run: tcgdex-cm rows exist (~200 Pokemon cards).
- [x] (10-07: $61.39) Cresselia LV.X (dp4-103) card page shows $61-ish with no "looks off" note.
- [x] (10-07) Rayquaza col1-20 still shows the "looks off" note, not $1,013.
- [x] (10-08 prod Base Set Charizard page: no EUR or € anywhere in the HTML or rendered text) A card page chart shows no extra EUR line from the new source.

## 10-06 look and feel (audit section E)
- [x] 10-08 PASS from Chris iPhone screenshots (Inventory, scanner, /scan: tab bar clear of the home bar; sticky price bar on card pages not checked) Real iPhone: bottom tab bar sits above the home bar, nothing hidden under it.
- [x] (10-08 local pane 375px: End listing confirm is a bottom sheet pinned to the bottom edge with Cancel / End listing; Cancel closes it. Back gesture = real phone only) Confirm pop-up (e.g. bulk delete) slides up as a bottom sheet on phone, Cancel/Confirm both work, Back gesture cancels.
- [x] 10-08 PASS iPhone (Chris: swipe closes it) Swipe the sheet handle down closes the card peek on the home page.
- [ ] (Chris 10-08 7:02pm "good enough for now": third fix f3d54a0c shipped, NOT retested on the phone; check it in passing next time a card peek is opened.) (10-08 THIRD round: after e4fd6830 both X and drag jumped to the TOP, because the fresh scrollY read was 0 for a beat on iOS; now the scroll lock records the offset it restored and both the unlock and the history pop pin that value over 300 ms with scrollRestoration manual. Retest X AND drag.) (10-08 retest: X fixed, handle drag still jumped; second fix turns history.scrollRestoration to manual for the pop and re-applies the offset over 300 ms; retest the DRAG) Home page card peek: closing it (X or swipe) leaves the page where it was, not at the bottom (Chris 10-08 iPhone: "shoots me to the bottom of the page"; the sheet's history pop let Safari restore a scroll position saved while the body was pinned; useBackToClose now re-applies the real offset on that popstate).
- [ ] Loading skeletons show on slow 4G for Inventory, card pages, set pages.
- [ ] Grey text is readable in sunlight (contrast lift on zinc-500/600).
- [ ] Google shows the new home title "Pokémon & Yu-Gi-Oh! Card Scanner and Prices | CardFlip".

## 10-06 audit fixes (docs/AUDIT-2026-10-06.md)

### Scanner (needs a real phone + a real scan)
- [ ] A scan that times out ("Took too long") can be scanned again, and picking the card by name works on that row.
- [ ] No ghost card in Inventory after a "Took too long".
- [ ] A slow server scan says "Took too long — tap Capture again" right away (no ~14 s wait, no "brighter shot" message).
- [ ] Double tap on Capture takes one photo, charges one scan.
- [ ] Trial account using its last free scan mid-session keeps its queue (paywall only on next visit).
- [ ] Out of scans: red note shows inside the camera.
- [x] (Chris 10-08 Inventory 2) Removing a card while it's still saving leaves nothing behind in Inventory.

### Inventory
- [x] (10-12 Chris on the tunnel) Opens on a game that has cards when the last-used game has none.
- [x] (Chris 10-08 Inventory 2) Empty game says "No <game> cards yet" (not "Nothing matches").
- [ ] Load failure shows Retry (Sales Report and Set Completion too).
- [x] (Chris 10-08 Inventory 2) Set Completion: cards already on the watchlist show "Watching".
- [x] (Chris 10-08 Inventory 2) Sold tile shows the same net as the sticker.
- [x] (Chris 10-08 Inventory 2) Bulk delete with live/sold cards selected says how many were left alone.
- [x] (10-08 code: collection page sorts by shownPrice × copies (sold row = 1)) Price sort orders by price × quantity.
- [x] (10-08 code: AppTabs marks Inventory active for any /app/collection/* path; Insights, Report and Sets all live there) Inventory tab stays highlighted on Insights / Report / Sets.

### Public pages
- [x] (10-07: Holofoil row shows the note with no price) Skyridge Charizard page no longer shows a price beside "this price looks off" (was still the cached page at 11:40 AM ET 10-06).
- [x] (10-07) Cavern of Souls ($10,000, stale) gone from Magic top cards.
- [ ] Yu-Gi-Oh / Lorcana / One Piece $1,000+ cards appear in top lists from ~10-14 (14 days of history).
- [x] Friendly "Something went wrong" page on a crash (can't force one on prod; check if one ever shows up in /admin/errors). (closed 10-11 ~10pm ET by Claude: MOVED to a fix task: /admin errors show "Page changed from static to dynamic at runtime /cards/magic/..." x6 to 10-09 and "fx: rate refresh failed ... Dynamic server usage" x6 to 10-11)
- [x] (10-07 0b35cbad + d90a8315, prod fetch 2:50 PM ET: header "Preorder · out Nov 2026", About "out Nov 13, 2026", table "Out") Star Trek (Magic) card pages show "Preorder · out Nov 2026", not "released".
- [ ] (10-08 code: the server renders the start screen and a 0 ms timer after hydration swaps to the used screen, so any flash is one paint; phone check still the proof) /scan doesn't flash the camera button for someone who already used the free scan.

### eBay (needs a real listing / sale)
- [x] (SUPERSEDED 10-08: shipping pick + free shipping replaced this line) Publish screen shows "$4.99 flat shipping, 30-day returns" line; on a UK/IE/AU/CA account the amount is that site's.
- [x] (10-08: only shows on a needs_policies failure; Chris's account has policies, so never seen; link target is the seller's site domain in code) "Set up policies" link opens the seller's own eBay site.
- [x] (10-08 code: ebaySell.ts treats an offer already PUBLISHED as live and records it instead of re-publishing) Publishing a card that's already live on eBay marks it listed instead of erroring.
- [x] (10-08 code: publishDraft holds a per-card lock; the second tap gets 409 "already being published"; covered by test:ebaysell) Two quick Publish taps make one listing.
- [ ] A real sale is recorded once (two tabs open at the time of sync).
- [ ] Seller with 26+ live listings: an eBay-side end on listing #26+ shows up in Inventory.
- [ ] Reconnect warning shows 30 days before the eBay link expires (first ones ~2028).
- [x] (10-08 local pane 375px, trial account: Unlock Selling in the scan editor after verify, Unlock Selling → on the open Inventory card; both go to /pricing) Trial user sees "Unlock Selling" on the scan page editor AND in Inventory (was "Booster or Plan to Sell", Chris 10-08); both go to /pricing.

### Account / billing
- [x] (10-08 code: both paths call updateCustomerEmail; Ben account has no Stripe customer so nothing to see; real proof needs a paid account) Changing email (both ways: Account page and code-confirmed) updates the email on the Stripe customer.
- [x] (Chris 10-08) Delete-account form warns "You have N cards live on eBay".
- [x] (prod 10-06) Invite a friend hidden everywhere; /app/rewards goes to Account. (checked on prod 10-06)

### Ad funnel (needs a logged-out phone, ideally inside TikTok)
- [ ] TikTok Events Manager shows ViewContent and ClickButton events from /scan.
- [x] 10-08 PASS (Chris iPhone, Okidogi $0.15): pinned "Your card is waiting" bar, own photo next to the price, nothing behind the home bar.
- [x] 10-08 PASS: coming back shows "Your Okidogi is worth $0.15".
- [x] 10-08 PASS (Chris iPhone, "scanner works") Free scan on /scan: after Capture the camera stays open with the IDENTIFYING sweep, then the MATCH FOUND chip (chime, price counting up) for ~1.6 s, then the result page. A miss still leaves the camera and says why on the page.
- [x] 10-08 PASS (Maractus Black Bolt 093 rescanned, $6.81) /scan free price never says "No trusted market price" for a card whose series holds a price (10-08 Maractus Black Bolt 093 showed it while prod held $6.81): search-card name path now falls back to the held price, and the result page re-reads by id once. Scan the Maractus again on /scan and expect $6.81.
- [ ] Miss / busy panels show the sign-up link.
- [x] (10-08 prod HTML: Magic placeholder + game=magic) /scan?game=magic opens the scanner on Magic.
- [x] (Chris 10-08 5:39pm iPhone private tab: Charizard ex $39.42 on Pokémon, Sol Ring $38.93 on Magic; "gone once a price shows" not yet seen) /scan logged out on a phone: example card (picture, name, set, price, "Example") under "135,000+ cards"; switches with the game; gone once a price shows.
- [ ] Ad signup (from /scan) skips "How will you use it?", lands in the scanner as Seller.
- [ ] Organic signup still gets the question.
- [ ] Admin funnel shows ad-page signups as landing /scan.
- [x] (10-08 code: signup + Google callback pass the first name to sendSignupWelcomeEmail) Signup with a first name only: welcome email greets them by it.

## 10-06 quality-of-life batch (section D)

### Catalog
- [x] (10-08 pane prod 375px: tap opens the field, Charizard results list with prices, input is 16px so iOS will not zoom) Nav search icon (phone): opens a field, results readable, iPhone doesn't zoom on tap.
- [x] 10-08 PASS after fix (card on the watchlist from the confirm link). (10-08 FAIL on Chris iPhone private tab: signup OK, confirm link opened elsewhere → nothing on the watchlist; the watch lived only in localStorage. Fixed same day: parked on the server at the confirm screen, pending_watches + /api/watch/pending, claimed on the first signed-in page. Retest: private tab → card page → Watch this price → sign up → open the confirm link anywhere → toast "Added to your watchlist", card on /app/wishlist.) Watch this price, signed out: goes to signup, and after signing up the card lands on the watchlist with a toast.
- [x] 10-08 PASS (Chris: third run landed on the watchlist, card added ~2-3 s after landing; "consider this a pass". Speed-up shipped after: the confirm page adds the watch inside its 1.2 s beat, lands on /app/wishlist?watched=1, the page toasts once. Not re-tested.) (10-08 second run: landed on the watchlist, PASS, but the list showed empty although the card was on the account, and the confirm page said "Opening your scanner". Both fixed: the list reloads when the parked watch lands; the confirm line says "Opening your watchlist". Retest once more with a fresh email.) Confirm link after a "Watch this price" signup (no card scanned) lands on /app/wishlist WITH THE CARD SHOWING and the toast, confirm page says "Opening your watchlist". A signup from /scan still lands in the open scanner.
- [x] (10-08 pane prod 375px, owner account: tap → "Watching. See your watchlist", item on /api/wishlist; removed again after) Watch this price, signed in: adds to the watchlist.
- [x] (10-08 pane: Commander Masters page 2 fine; no set has more than 2 pages) A set with 300+ cards: page 2 link works, pager wraps on a phone.
- [x] (10-07: /app/zzz = 404) Mistyped /app/... address shows a 404 (root one is fine; app one only appears for missing cards/pages inside the app).
- [x] (10-07 0b35cbad: the reverse is now hidden too, test 3b) Skyridge Charizard still headlines $2,999.99 "Reverse Holofoil" beside a doubted Holofoil — the 10-06 fix did not change it (needs a look at what the doubted price is).

### Inventory
- [x] (Chris 10-08 Inventory 2) Delete one card → Undo brings it back; delete again and leave the page → it's gone for good.
- [x] (Chris 10-08 Inventory 2) Bulk delete including live cards: those stay, toast says how many.
- [ ] Bulk Set condition / Set price on a few cards (price skips live/sold).
- [ ] 60+ cards: "Show more" appears; Select all says the full count.
- [ ] Duplicates and Missing price chips; Name A–Z and Set sorts.
- [x] (10-08 local pane 375px: no eBay anywhere in Collector Inventory text) Collector mode: Help chips and bulk bar never mention eBay.

### Set Completion
- [x] (10-08 pane prod 375px: Pokémon + Magic list sets; Lorcana/One Piece/Yu-Gi-Oh show the "No <game> sets started yet" empty state — One Piece gap FIXED 10-08: promo/DON ids end in #promo/#don and the variant filter dropped the whole set; now allowed, cache key bumped to v2, test:setcompletion green; prod shows the promo set after deploy) Each of the five games opens and lists sets (Magic first load ~10 s, then cached a day). Magic totals count every printing (borderless etc.) so % looks low — Chris to say if base cards only.

### Scanner (real phone)
- [ ] "Not this card?" on the camera chip: other candidates + search by name; picking one updates name and price, no extra scan charged.
- [ ] Verify all sheet after a stack scan: doubtful ones first; Confirm marks the rest verified in Inventory.
- [ ] Too many scans fast → "wait N seconds" message; daily limit → "try again tomorrow".
- [ ] At 375px the "Not this card?" and Verify buttons fit side by side.

- [ ] Account > Selling > Accept Offers (G10): turn on, push a card, confirm in Seller Hub the listing shows Best Offer with auto-accept 90% / auto-decline 70% of price; reprice and confirm the thresholds moved. Tracked Shipping (G9) only after EBAY_VALUE_SHIPPING=1 is set: card over the threshold shows the tracked postage price.

- [ ] Packs (G8), real phone at 375px: scanner "Open a Pack" > pick game, name, price > scan 3 cards > banner shows pulls and value > Done opens the pack page (cost, value, profit, ROI, best pull, list with art). Share makes a 1080x1920 "My Pack" picture. Inventory > Packs shows past packs and the all-packs ROI. Delete a pack: its cards stay in Inventory.

- 10-07 admin: /admin/analytics second funnel now follows the date range ('Everyone, last 7 days': had an account / scanned / listed / sold in range). /admin/social opens fast from the last saved build and rebuilds stale drafts in the background (check 'Drafts built N min ago' drops on the next visit).
- [ ] (10-10 evening, me) TikTok question-format test: read views/likes of the three 10-09 posts (7am Guess Pokémon, 1pm Movers control, 7pm Head to Head Pokémon) into docs/SOCIAL-AUTOPILOT.md results log; decide the 7pm weighting from that.

- [ ] 10-16 evening: REACH TRIAL REVIEW (2c23d2a4, 10-09). Instagram/Threads/X avg views per post 10-10..10-16 vs the 14-day baseline in docs/SOCIAL-REACH-DEEPDIVE.md (IG 5.7, Threads 18, X 12). First 10-10 7am run: open one IG/Threads/X post, confirm the sign-off is at the bottom above the tags, TikTok/Facebook/Bluesky unchanged. If no lift, revert signOffLast on the three sites.

- [ ] Sign in with X (10-10, me; keys set, live on prod c70f4279, start endpoint and button verified by curl): test on prod: (1) /login shows "Continue with X" right under Continue with Google; (2) /signup shows it too; (3) an X account that shares an email goes straight in and lands on the welcome step (new account made, no code asked); (4) an X account with NO shared email lands on /signup?x=email "One more thing", typing an email and Finish signup sends the confirmation code, and the code lets you in; (5) an X login whose email matches an existing email+password account links to it and logs in (password still works if that email was already confirmed); (6) an account with authenticator (or the admin) is refused with "That account has extra security. Log in with your email and password."; (7) typing an email that already has an account on the no-email step says "That email already has an account. Log in with it instead."; (8) with the keys removed the button is gone.

## 10-11 Google One Tap on public pages (dark on prod until Chris adds https://cardflip.io to Authorized JavaScript origins on the Google client id)
- [x] (10-11 Chris, phone: worked after the eaaaeb23 fix) Phone, signed OUT of CardFlip, signed IN to Google in the browser: open cardflip.io/?onetap=1 (the ?onetap=1 forgets the once-only flag; Chris 10-11 saw nothing because the flag had been set while signed in, fixed same day). Google's "Continue as <name>" sheet appears once. Tap it: new Gmail → "You're in, <first name>" welcome step with the free-scan count; existing Google account → the home page reloads signed in (nav shows the app).
- [ ] Close it with the X, then open /pricing and reload the home page: it never comes back on that device (localStorage cardflip.onetap = done).
- [ ] Signed IN to CardFlip: no prompt on any public page. /app, /admin, /login, /signup: never a prompt (the button pages keep their white Continue with Google button).
- [ ] An admin account's Google identity: tap → lands on /login with "That account has extra security..." and is NOT linked.
- [ ] Android Chrome: the prompt is the FedCM account chooser (browser-styled), not Google's iframe; same behaviour.

**10-12 (s148, local, Chris passed on tunnel) Base Set unstamped pictures + verify count**
- AT PUSH: run `node scripts/sync-first-edition.mjs --prod` (re-photographs 101 plain Base Set cards + purges stamped card_cache answers on Turso). Then on cardflip.io: search Charizard Base Set 4/102 → picture has NO 1st Edition stamp.
- Passed on tunnel: scanner green button counts only unverified scans (4da784ee); category sheet one centered button (eeaa21cf); Inventory/scanner game rows mirror (e50a9198).
- Passed on tunnel 10-12: pack bar counts saved pulls (ebaef239); pack value = market the scanner showed, new cards.scan_market column (97c60b14). AT PUSH: confirm Turso got the scan_market column (app adds it at startup) and a new pack pull on cardflip.io stores it.
- Passed on tunnel 10-12: Magic card under Pokémon = bad scan, not saved, given back (6baaa844); any 504 = Took too long (6eb614a6); bulk verify Confirm removed (d2a3e96c).

## Magic Art Series prices (10-13, commit after push)
- [x] PASS 10-16 (Turso: 32 English Art Series unpriced, target ~31) Morning after the push: the 56 Art Series cards from the 10-13 dry run have a price (e.g. Avatar Eternal Art Series 1-12 ~$0.25-0.84, Marvel Thanos 1c-9c ~$3-4, Avatar Yue 41 ~$11). Query: Art Series unpriced count should drop 87 -> ~31.

## Magic cheapest-listing cap + listing beats Cardmarket (10-13)
- [ ] HALF 10-16: 10-15 run cappedToListing 2,579 (not hundreds, but 2% of 116k; mtg step fine, whole run 200 s). cardmarketFilled was never saved: dailyJobs.ts dropped it, fixed 10-16; read it after the next push. Morning after the push: daily_last_result mtg.cappedToListing is in the hundreds (not 0, not tens of thousands); mtg step still finishes under the 800 s cap.
- [ ] Magic "This price looks off" count drops from ~837 toward ~83 (rerun the sweep script pattern, s154 scratchpad).
- [x] PASS 10-14 ~10:25pm ET (Cromat $57.30, Spiritmonger $57.65, Vindicate $163.20): Spot-check 3 capped foils on the card page (e.g. Cromat Apocalypse foil ~$57, not $155).

## 10-13 ~2:30pm ET: US tracked = Ground Advantage (USPSParcel), eSE carrier EBAY_SEND
- [ ] First real US publish after the push: the seller's "CardFlip shipping" policy reads USPS Ground Advantage (not Priority), still free (Seller Hub > Business policies).
- [ ] First real envelope (≤$20) publish creates "CardFlip envelope" with eBay Standard Envelope (carrier EBAY_SEND) and the listing shows Free eBay Standard Envelope.


## 10-13 ~3pm ET: nightly new-cards run (PC, 2am ET)
- [ ] 10-14 morning: (LOG PASS 10-14 7:40am ET: done 2:33am, failed: empty, all 5 games 0 failed, 44 YGO stand-ins; /admin/prices tile PASS 8:25am: last run 6 h ago, all steps fine) backups\catalog-sync.log ends with "===== done ... (failed:)" and nothing after failed:; /admin/prices shows "New cards ... last run" ~2am, all steps fine.
- [x] PASS 10-16 (60,196 of 60,196 own pictures; Lorcana 3,505/3,505, One Piece 5,546/5,549) Yu-Gi-Oh saved pictures intact on Turso after the push (count own_image_url<>'' for yugioh >= 59,969); the 22 new rows got pictures.
- [x] PASS 10-16 (yugioh 28,141, lorcana 2,624) After the code push: cardmarket_map rows on Turso (yugioh ~28k, lorcana ~2.6k) and the 5:25am tcg-prices run still green.

- [ ] Stand-ins: a new card with no scan shows another printing's picture (own_image_src 'standin:<id>'), and the night its own scan appears it switches (tested on a DB copy 10-13: borrow, keep on retry, replace, stand-in's files kept). /admin/prices lists cards still borrowing 2+ weeks after release.

- [ ] Old Yu-Gi-Oh borrowers retry nightly (sync-yugioh no longer repoints dead links, 10-13): first run already swapped 186 to real TCGplayer scans (99 from the old dead list, sheet checked by eye, all clean BETB scans); 233 still 403 keep their borrowed copy. After tonight /admin/prices Yu-Gi-Oh "borrowing" ~233 and falling over time.


## 10-13 ~7pm ET: Magic euro fill + One Piece reprints (PUSHED 30615a64 10-14 ~5:20am ET)
- [x] PASS 10-14 (list item 63: Black Lotus Alpha $37,780.37 from EUR): Next 5am mtg-prices run: cron result shows cardmarketFilled ~400; Black Lotus (Alpha) card page shows a dollar price labeled Cardmarket; /admin/prices eBay check reviews the new $100+ ones over the week.
- [x] PASS 10-14 (list item 64: ST30-ST36 all priced): One Piece ST31-36 reprints (e.g. OP12-090_r1 Belo Betty) show their original's price after the 5:25am tcg-prices run.



## 10-13 ~7:45pm ET: Send a New Code button + Verify label (76660b68, PUSHED 30615a64 10-14 ~5:20am ET)
- [x] PASS 10-14 ~3:55pm ET (Chris phone, sign-in code + Send a New Code): Phone, /login with an emailed code: under the code box a full-width outline 'Send a New Code' button (not a small blue link); tapping it mails a new code. Same on /admin/login.
- [x] PASS 10-14 (Chris phone, list item 35): Phone scanner after a scan with 'Not this card?' showing: green button reads 'Verify 1 Scan  $0.85' in full, no 'Ver...' cut.


## 10-13 ~7:45pm ET: scanner match tile + card removal log (PUSHED 30615a64 10-14 ~5:20am ET; the log answered Jenny's case 10-14 8pm)
- [ ] /admin analytics Scanner 'Matched a card' = paid scans not given back / paid scans (tiebreak calls no longer count). Today's 6 scans read ~33% (2 of 6: the 4 refunded by hand count as given back), not 25%.
- [x] PASS 10-14 8:10pm ET (Jenny's 5 bulk rows with name/set/status/match_doubt/created_at; 'one' path untested on prod): Turso has table card_removals after deploy; remove a test card on prod (one, then a bulk select) -> two rows (how one/bulk) with name, set, status, match_doubt, created_at.


## 10-13 ~7:50pm ET: fx fetch no longer no-store (PUSHED 30615a64 10-14 ~5:20am ET)
- [x] PASS 10-14 (list item 65: Vercel logs past day 0 static-to-dynamic, 0 fx): Vercel logs / /admin errors for 24 h after the push: no 'fx: rate refresh failed ... Dynamic server usage' and no 'Page changed from static to dynamic at runtime /cards/magic/...'. If the static-to-dynamic one remains, it has a second cause: find it with a local next build.

## 10-14 ~4am ET: code wait, envelope wording, no confidence %, backup fix (PUSHED 30615a64 10-14 ~5:20am ET)
- [x] (10-14 3:55pm ET Chris phone: pass) Phone, /login (or /admin/login) with an emailed code: right after the code mails, the button reads 'Send a New Code (60s)' and counts down, greyed out; at 0 it works again. Email-confirm wall on signup counts 60s too.
- [ ] A scan the AI was unsure of: Scanner list and Inventory show 'Verify match' but NO 'low-confidence read (40%)' text anywhere.
- [x] (10-14 2:17pm ET Chris phone: pass) 'How to ship' on a $20-$100 envelope card, step 3 reads: 'Postage is $1.31 total. Use $1.31 in postage stamps, or hand it in at the post office counter and they'll stamp it for you.'
- [x] (10-14 3:50pm ET Chris phone: pass, Best Match both places) Search: every result tile has a 'Buy on eBay' button under the price, and the opened card has one under Share; both open eBay on Best Match (not cheapest first) for that card. Watchlist's Buy on eBay is Best Match too.
- [x] PASS 10-16 (10-15 run green after red 10-13/10-14) Nightly backup (cardflip-backups repo) goes green the night after the push (foreign keys off in the copy; local run 10-14 passed, 552,343 rows).

## 10-14 morning: set pages show under-$1 cards, Buy above Watchlist, duplicate Trainer Galleries gone (PUSHED 30615a64 10-14 ~5:20am ET)
- [x] (10-14 ~5:30am ET applied on Chris's yes: 18 statements, re-run dry = 0; backup backups/dup-tg-sets-prod-1791970155907.json) RIGHT AFTER THE PUSH (me): `node scripts/drop-duplicate-tg-sets.mjs --prod` (dry run: 1 customer card moved to swsh9tg, 120 en_cards + 144 price_series + 120 tcgplayer_products + 5 listing_lows deleted, 119 saved searches cleared) then the same with `--apply`. Not before the push: live code has no redirect for the old ids yet.
- [x] (10-14 10:35am ET after the d3a938f2 push: /cards/pokemon lists each Trainer Gallery once, curl 0 duplicates; earlier 6:30am: search PASS, 4 results, TG23 once in swsh9tg. Game page + redirect was NOT yet: /cards/pokemon still lists each Trainer Gallery twice and the -brs slug serves the 30 cards; seo:sets:v1/v3:pokemon card_cache rows deleted, the 48 h page copies clear on the NEXT PUSH -> recheck then) PROD: Search "Umbreon VMAX" = 4 results, TG23 once. /cards/pokemon lists each Trainer Gallery once; /cards/pokemon/brilliant-stars-trainer-gallery-brs redirects to /cards/pokemon/brilliant-stars-trainer-gallery; an old swsh9.5tg card link redirects to the swsh9tg page.
- [x] (10-14 curl: Evolving Skies 276 sub-$1 prices, no '1.00 and up' on game/set pages, Surging Sparks Drasna sub-$1 page = noindex, follow) PROD: a set page (e.g. /cards/pokemon/surging-sparks) lists cards down to a few cents; no "$1.00 and up" wording on /cards, the game pages or set pages; a sub-$1 card page still has robots noindex.
- [x] (10-14 2:33pm ET Chris phone, Pikachu 30th 023/128: Buy on eBay + Watch pinned side by side at the bottom) Phone: Search, open a card: Buy on eBay sits ABOVE Add to watchlist.

## 10-14: Search redesign A-F (PUSHED 30615a64 10-14 ~5:20am ET; all 16 phone checks PASSED by Chris 10-14 ~2:30pm, see the s165 note in STATE)
- [x] (10-14 2:40pm ET Chris phone: pass) Phone, Search before typing: game pill + big "Name or number" box pinned under the header; My Watchlist swipe row (price now, % since saved, bell when an alert is set, "See all N"); "Open a whole set" tiles with set logos (newest 6). No intro text, no Recent lookups.
- [x] (10-14 2:34pm ET Chris phone, "pikachu": 200 cards, Best match pill, list/grid switch, rows with picture/name/set+number/rarity chip/price/star/Buy, round x in the box) Type a name: a "Search" button shows inside the box until you search, then a round x clears. Results: "N cards", one "Sort" pill, list/grid switch; rows show picture, name, set and number, rarity chip, price, star and Buy.
- [x] (10-14 2:40pm ET Chris phone: pass) Sort pill opens the Sort & filter panel from the bottom: Card name / Whole set, sort list, rarity chips, "Narrow these results"; "Show N cards" closes it.
- [ ] Sort & filter sheet, phone: drag the grab bar down about a finger's length: the sheet closes (Chris 10-14: it got stuck; the bar was drawn, not wired. Fixed locally, not pushed: shared drag-to-close, closes past 56 px on release or at once past 120 px; a short drag snaps back. Pane 375px pass 10-14 3:05pm ET). Also try the home page card peek and any other sheet's bar once: same rule now.
- [x] (10-14 3:10pm ET Chris phone: pass) Tap a star: it turns gold and the card is on the Watchlist; tap again removes it.
- [x] (10-14 2:33pm ET Chris phone: $0.76 in foil colours, Buy on eBay + Watch pinned) Open a card: smaller picture, the market price in foil colours, Buy on eBay + Watch pinned at the bottom while the chart scrolls.
- [x] (10-14 3:15pm ET Chris phone: pass) 24 cards per page with "Show 24 more"; the commission line sits in small print at the very bottom of the results.
- [x] (10-14 3:20pm ET Chris phone: pass) Watchlist page: same new search box (game pill + field) inside its panel; adding from a search still works.
- [x] (10-14 2:40pm ET Chris phone: pass, all games) Search, before typing, for EVERY game (switch the game pill): six "Open a whole set" tiles
- [ ] Search before typing: switch the game pill: the My Watchlist row shows ONLY that game's watched cards (Chris 10-14: the Pokémon row stayed put on Magic; fixed locally, not pushed: rows saved without a game count as Pokémon). "See all N" counts that game's cards; a game with none shows the "Tap ☆" line., each with a picture (Pokémon logo when TCGdex has one, else the set's most valuable card art). One Piece (no release dates) shows its top-value sets with "N cards".
- [x] (10-14 2:33pm ET Chris phone) Search, open a card: the card picture is big (about two thirds of the phone width).
- [x] (10-14 3:25pm ET Chris phone: pass) Watchlist: Total value starts as a one-line bar (tap to open, the arrow folds it again); "Add a card" panel has Hide / Show; both remembered after a reload.
- [x] (10-14 2:53pm ET Chris phone: $1,574.99 reverse holo, eBay sold raw $700-3,500 since late Aug so the number stands) Watchlist: Legendary Collection Pikachu 86 shows $1,574.99 "steady" (was "$6.62, down 100%": the Watchlist read a different printing than the one saved).
- [ ] Card detail (Search/Watchlist), the Source/Variant/Low/Market table: a "low" above the market shows "—" (Chris 10-14: Legendary Collection Pikachu reverse holo read Low $19,999.99 beside Market $1,574.99, a joke listing; fixed locally, not pushed). The Normal row still shows its real low.
- [x] (10-14 3:40pm ET Chris phone: pass) Search: 'All sets' opens a full panel of every set with pictures (newest first; One Piece by value), a 'Find a set' box narrows it, tapping a set opens all its cards.

## 10-14 ~6:30am ET: owner eBay reconnected (link dropped 10-13 10:10pm ET by invalid_grant 'issued to another client', cause unknown)
- [x] PASS 10-14 ~8:50am ET (s163: still connected, no new refresh rejected): After ~8:30am ET (first token refresh on prod): /api/ebay/status from the pane still connected:true, and /admin/errors has no new 'eBay refresh rejected'. NEVER verify via a local script calling ebayAuth (deletes the link: local key).

## 10-14 ~7am ET: eBay links leave slabs out (Chris: 'any title with PSA is a slab')
- [ ] After push: /admin/prices 'eBay sold' and a raw card's 'check sold listings' open eBay with '-psa -bgs -cgc -sgc -graded -slab' and no slab titles; a slab item's eBay link still searches its grade (e.g. PSA 9).

## 10-15 ~7:05am ET — scanner live outline (local, UNPUSHED)
- [ ] Scanner: a blue line hugs the card's edges as soon as it is in front of the camera; green (with green brackets) once the whole card is in the picture, lit, no glare; blue again the moment an edge leaves; gone when the card is gone. PASS on Chris's phone 10-15 ~7am (Spidops + Pikachu VMAX, tunnel). Re-check on prod after the push.
- [ ] Scanner: with the card poking out of the box a little and the line green, Capture: the photo has the whole card (crop grows to the outline, +2%). Not yet confirmed by eye on a saved photo.
- [ ] Scanner: "Keep going for a whole stack." line is gone under the camera.
- [ ] Dev only: /app?dbg=outline shows the finder's view + posts frames to /api/dev/outline-dump (404 on prod; .outline-dumps/ gitignored).
- [ ] Scanner result card (10-15 ~7:45am ET): set · rarity · number wraps to 2 lines, never cut; row 2 = "● Near Mint · Holofoil ✎" pill (dot = condition colour; tap opens the card) + Clear on the right; no "75% sure" on the label; on a phone with 10+ scans or a $1,000+ total the green button says "Verify All $1,234.56" (was "Verify 12 S…"). Card editor's "Is this your card?" line no longer shows a percentage. Pane-checked at 375px on a real Pikachu scan; Chris to eyeball on the phone after the push.
- [ ] Scanner "This copy" sheet (10-15 ~8:15am ET): tap the "● Near Mint · Holofoil ✎" pill on the result card: a sheet "This copy" with 5 condition chips (each shows the market for that condition), Printing chips only when the card has 2+ priced printings, "Use X for all N waiting scans" when 2+ waiting, Done. Taps apply at once: the pill + the card's market price + the Verify total follow (headlinePrice now = market for the copy's condition; NM unchanged). Pane: sheet opened, LP tap -> pill "Lightly Played · Holofoil". NOT yet seen: the price moving to $87.79 on the card (checked by code + tests only); printing chips on a multi-printing card; the all-N link.
- [ ] One $10,000 card at phone width: Verify button says "Verify Scan $10,000.00" (not "Verify All").

## 10-16 push (s178, Chris's 9 items)
- [ ] Search cards opens on the picture grid (new key cardflip.searchView.v2), list toggle still works. Pane: done locally.
- [ ] Watchlist: no stale-price note on cards; set names stay on one line. Sitewide .truncate on <p>/h2/h3 now truncates (text-wrap-style fix). Glance at Inventory/Search tiles for anything that now cuts off badly.
- [ ] Scanner: Open a Pack button gone. Pane: done locally.
- [x] PASS 10-16 (Chris, phone) PHONE (camera): scan a card, tap the result card -> big view with picture, price, "Change", "Not this card?"; pull the handle down or tap Done closes it.
- [ ] Card pages: Buy on eBay under the price + commission line; name pages (e.g. /pokemon/mewtwo-card-value) Buy under each card. customid card-page / name-page / cards-search.
- [ ] /cards/pokemon search: full grid + count + Show more + Buy (Mewtwo = 95, same as the app).
- Decided 10-16 (Chris): NO "Which one is yours?" picker when the name reads but the number doesn't exist. Keep "No match" (never guess a printing).

## 10-16 ~4am ET push (s178 second batch)
- [ ] Morning after: daily_last_result mtg now shows cardmarketFilled (number, ~400ish) next to cappedToListing.
- [ ] Morning after: soft cap live. Spot-check: an Alpha/Beta capped card (e.g. Beta Shivan Dragon, was $1,998.97 = cheapest listing) now ~1.45x its listing; a cheap modern foil (Cromat Apocalypse foil ~$57) unchanged; none of the soft-capped ones flagged "looks off".
- [ ] Ancient Mew (miscp-001) card page shows ~$122 after the next daily price run.
- [ ] Homepage hero line reads "...adds up what your whole binder is worth. Selling? It writes the eBay listing. You tap Post." (Chris yes 10-16).

- [ ] Pokemon listing cap (10-16, after push): Base Set 2 Mewtwo (base4-10) card page ~$68 not $129.77; Skyridge Piloswine H22 unchanged ~$388; a cheap holo under $20 unchanged; none of the capped ones show "looks off".

## 10-17 competitor tasks (PUSHED 90033b03 10-17 ~9:18am ET; CI + smoke green; prod checks 10-17 ~10:30am ET below)
- #59 titles: PASS on prod: "Blastoise 2/102 Base Set price: $224.98" (39 chars); set title "Base Set Pokémon card prices 2026"; set desc "100 Pokémon cards from Base Set, from $0.29 to $224.98. Most valuable: Blastoise at $224.98."
- #58 card pages "Common questions": PASS on prod at 375px: 3 Q&As open, Blastoise LP $191.23 / HP $123.74 = exactly 85% / 55% of $224.98, no sideways scroll.
- #61 "All" range pill: card chart PASS on prod at 375px (All selected, 151 days May 18 -> Oct 17, no overflow). Inventory value chart NOT CHECKED (needs a signed-in account with cards).
- #62 set summary strip: PASS on prod (Base Set: 7d -11.3%, 30d -14.5%, typical $2.60 of 100, most valuable Blastoise $224.98 = top of the card list).
- #63 "Most valuable sets" on /cards/<game> (top 10). SWR cache seo:setvalues:v1:<game> (~21 s query, built after the response): the section may be MISSING on the first build of a hub page and appears after ISR revalidates (<= 2 days). Check all 5 games show it within 2 days, and Pokemon top 5 ~ Skyridge, Legendary Collection, Holon Phantoms, Base Set 1st Ed, Aquapolis.
- #65 Top 100 page: PASS on prod 10-17: all 5 games 100 rows + link on each hub; top 5 look real (Pokemon 1st Ed Charizard $10,000, Magic Smaug $24,500, YGO Uria $999.97, Lorcana Elsa's Ice Palace promo $3,999.99, One Piece Luffy Gold $13,000). Cold builds: Pokemon 16.5 s, YGO 7.6 s, Magic 5.1 s; cached ~0.4 s. #63 Most valuable sets: still missing on all 5 hubs at 10:30am ET (expected; recheck by 10-19).

## 10-17 Watchlist fixes (NOT PUSHED; 87cc9989, 36bbf0e1)
- Game picker shows cards per game (pill 'Pokemon · 6', options 'Magic (0)'). Check on phone: pill fits beside the search box at 375px.
- Game with 0 watched cards: 'No Magic cards on your watchlist.' + 'Show Pokemon (6)' button switches the list. Filter text that matches nothing still says 'Nothing matches that filter.'
- Totals strip open: 'Alerts' label clear of the fold chevron (desktop). Phone layout unchanged.
