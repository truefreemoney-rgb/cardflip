# Lessons from tickets and comments

Chris (10-14): every support ticket and every social comment is a learning
experience while the site is new and not fully tested. One entry each: what
they said, what it taught, what changed, what is still open. Newest first.

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
