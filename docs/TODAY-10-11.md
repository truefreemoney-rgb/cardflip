# Today 10-11 (Chris's list; no reminders, he works it when he gets to it)

- [x] DONE (Chris replied; waiting on their answer since, OPEN-TESTS-10-14 C75) **Reply to eBay Developer Support** (their 1:43pm ET 10-11 mail on the growth-check ticket "CardFlip (cardflip.io): scan a trading card, price it, list it on eBay"). They ask: is the increase for the Inventory API specifically, and what volume. Suggested reply, paste as is or trim:

  > Yes, the Inventory API is the one that matters most (createOrReplaceInventoryItem, createOffer, publishOffer, updateOffer, withdrawOffer, getOffer), since every card a seller lists, reprices or ends goes through it. Expected volume: each active seller lists 5 to 30 cards a day and we poll getOffer at most 25 calls per visit, once a minute, so at 1,000 active sellers that is roughly 50,000 to 100,000 Inventory calls a day, growing with signups. Browse and Marketplace Insights are on the starter 5,000/day caps and sit under them today; if those need separate tickets I will file them, but the Inventory API is the request here.

  Reply goes from chris@superiormarketing.com (the dev-portal contact).

- [x] DONE 10-13 (VERIFIED as Individual) **Google Ads advertiser verification** (Ads account 688-921-3919 → Account → Advertiser Verification). Three tasks, in order, each ~5 min: Answer a few questions about your organization → Provide your Dun & Bradstreet info → Confirm your affiliation. Skip the "copyrighted content" and "EU political ads" boxes (Dismiss / No). The "who pays for your ads" question is optional: Cardflip is right.
