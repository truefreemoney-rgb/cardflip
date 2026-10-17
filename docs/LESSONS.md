# Lessons from tickets and comments

Chris (10-14): every support ticket and every social comment is a learning
experience while the site is new and not fully tested. One entry each: what
they said, what it taught, what changed, what is still open. Newest first.

## 10-17 · Chris: "why do the prices look too high?" (asked in chat)
- What: Lugia-EX bw8-108 posted at 7pm as +60% ($94.69 -> $151.44); eBay sold ~$90-98. Charmander dp7-101, Rayquaza pop1-3, Lugia GX, Regice ex etc. 1.4-3x eBay sold.
- Cause: not the 10-16 cap (it only lowers prices; median weekly change 1.000 every week). TCGplayer market = last sale, and a few sales walked thin cards up in 1.1-1.7x steps over a week; every guard test looked for ONE big step.
- Fix: guard test 1c (b2a51efb): up >= 25% in 7d and >= 1.4x the median NM eBay ask (3+) = hidden. Labelled on 18 climbers first (fair <= 1.13x, too high >= 1.42x). Gap left: cards with no eBay ask row (under $100, or not yet read: Lugia-EX) and 1.2-1.4x overprices (Charmander, Reshiram) still show; the real fix is sold data (PriceCharting, Chris's call).
## 10-16 · Junk 1pm post + Dynadot DNS fault (found by me, not a ticket)
**What happened:** the 1pm head to head printed parked Alpha/Beta listings as "slipped 69% / 78.8% this week" on 5 sites. Then, ~1:15pm ET, Dynadot's ns2.dyna-ns.net began answering cardflip.io / www with 54.215.31.113 (TTL 60) on ~10-15% of queries: wrong-certificate errors for some visitors and GitHub posting pings.
**What it taught:** (1) the price guard checked an old price against today's Cardmarket before its flat test, so a 52-day parked number passed; (2) our own 10-14 Magic cap (6f3fc80f) made every Magic "this week" move junk for 7 days; (3) one registrar nameserver is a single point of failure.
**What changed:** eb2cd6ad (flat-old before referee, Magic weekly moves paused to 10-21, owner delete-post route); 1pm re-posted as Southern Islands set spotlight on all 7 sites; Vercel DNS zone prepared with every record (site, www, Fastmail MX/SPF/DKIM) and verified.
**Still open:** Chris switches Dynadot nameservers to ns1/ns2.vercel-dns.com; confirm propagation; remove the MTG_CAP_DAY pause after 10-21.

## 10-14 · Support ticket #1001 · Jenny (trial, 5 scans, Google sign-up)
**Their words:** "Why do we all need to buy it if we just want to see the prices and if others are wanting to sell there cards why make them pay for wanting to know what there binder/s inventory is like."
Robot chat before it: "Why can't I just have free scans" / "is it possible to get my whole binder scanned without paying" / "but why".

**What it taught:**
1. Nobody told her lookup by name is free. The out-of-scans wall only sold plans, and Search Cards was behind the same wall, so there was no free path at all for a trial account at 0 scans.
2. The robot argued. It repeated the prices three times, said "it's the same model most apps use", and only offered a human at the end. It did not know the free path either.
3. Her goal was "what is my binder worth", not selling. The site talks about selling on eBay; a valuation job walks in the door too.
4. She cleared her five scanned cards with the row ×s (card_removals log), which read to us as "cards went to zero". The × looked like "clear the list" and was really "delete the card". Separate fix, same night.
5. The robot transcript in the ticket mail is where the product failed first; read it before replying.

**What changed:** wall opens with "Just want a price? That's free." + Search Cards button, Search Cards open after the trial, robot rule (prices free / scans paid, once, link Search, never argue or compare), scan-limits article (6714a500, live 10-14 8:33pm ET). Scanner row × → "Clear" (keeps the card), delete only in the card view behind a confirm, top × → "Done" (c787d5b0, live 8:23pm ET). Admin users row shows "N removed" / "N save failed" (49fe7d28).

**Still open:** trial size (5 scans, ~2¢ each) is Chris's call; naming the "what is my binder worth" job on the landing page; watch for her reply to Chris's 8:29pm ET answer.

**Follow-through the same night (Chris: "do them all"):** robot moved to Sonnet 5.5; an objections sheet (why pay, wrong match, scan failed, where did my card go, upload, countries, refund, cancel, eBay, upset) answers complaints first; the first unhappy message about money gets "heard + free path + a human", never a second explanation; the robot can now give back a missed scan, resend an email code, and point at a card in Inventory; every reply has Helpful / Not helpful; /admin/robot shows the week's chats, thumbs-down first, so chats get read like tickets; a replay test keeps Jenny's conversation as a regression check for the prompt. Also found while answering her: signed-in sellers had no way to the public card price pages except the homepage (now a line under Search's set tiles and "Full price page →" on every opened card). Live test of the new rule with her words, from Chris's account, 8:40pm ET: free path first with a Search Cards button; the "but why" follow-up still explained the cost a second time, which the escalation rule now forbids.

- 10-16 Chris (phone, Watchlist): the long "Market hasn't updated this in 2 months. View Sold on eBay" note under one card pushed its row out of line. Cause 1: the note had no place on a small grid card. Fixed: removed from Watchlist cards (still on the card page and detail sheet). Cause 2 (found while checking): globals.css `p { text-wrap: pretty }` (unlayered) beat Tailwind's layered `.truncate`. The shorthand resets wrapping, so every one-line truncate on a <p> or h2/h3 wrapped sitewide. Fixed with `text-wrap-style`. Lesson: use the -style longhand in global type rules.

- 10-16 Chris (phone, Search > My Watchlist): Charizard $134.86 with "▼ 5.0%" split, so the arrow stayed beside the price and "5.0%" dropped to an extra row. Cause: the 118px tile left 100px for price + move; "$134.86" (57px) + gap + pill (41px) was 2px over, and nothing stopped the pill from breaking at its space. Chris: must fit up to $99,999.99 (not millions). Fixed: tile 142px, price + pill nowrap, price 15/13/12px by size (<$1k / <$10k / up to $99,999.99), pill 10.5px, moves 100%+ shown without a decimal. Checked with 15 test tiles at 375px ($0.99..$99,999.99 x 99.9%/999%/5%): all one row. Lesson: size number rows for the widest real value (9s, cents) and measure it; don't eyeball one sample.
- 10-16 Chris, follow-up to the watchlist pill: "no extra rows appearing out of nowhere, anywhere", up to $99,999.99. Built scripts/_wrap-sweep.mjs: every page at 375px, every price swapped for $99,999.99 and every % for 99.9%, flagging any short label or value that splits, a label/value row that breaks, clipping, or sideways scroll. scripts/_wrap-measure.mjs + _wrap-shots.mjs check the tiles whose font size depends on the price, on iPhone WebKit. Found and fixed: Watchlist tab tiles (even $999.99 with a 10%+ move ran out of the tile), Inventory summary (In Play + Earned), homepage game tiles ("ONE PIE…") and binder labels, the hero price line, the price chart header/footer (now always two rows on phones), insights changes, pack profit, movers "$a → $b", the profile Buy button, the sell-panel numbers, condition/printing chips, bell and reprice pills. Lesson: Chrome's mobile emulation in the pane boosts small text, so measure fit in Playwright WebKit, not the pane.
