# Soft launch (one page)

Written 2026-09-06. v1.0.0 is tagged and every launch gate is closed. The
question now is not "does it work" but "do strangers pay for it". Answer
that with a small cohort before spending on ads.

## Goal

20 to 30 real Pokémon sellers, invited by hand, over 3 weeks. Learn three
numbers: trial → paid conversion, scans per active user, and 30-day churn.

## Who to invite

- People already selling singles on eBay by hand (10+ active listings). They
  feel the pain the scanner removes.
- Mix: a few high-volume sellers, mostly casual ones. The casual seller is the
  $9.99 customer.
- Where: r/pkmntcgtrades, r/PokemonTCG weekly threads, Facebook buy/sell
  groups, local card shop regulars, Discord servers you already sit in.
- The ask is one sentence: "I built a phone app that scans a card, prices it,
  and posts it to eBay. Free 10 scans, no card needed. Would you try it and
  tell me where it breaks?"

Do NOT post it publicly yet. Public posts bring lookers, not sellers, and
burn the eBay Browse quota on curiosity scans.

## What each invitee gets

- The link (cardflip.io), the 10 free scans, nothing comped. A comped plan
  hides the only number that matters.
- One follow-up message after 3 days: "Did you list anything? What stopped
  you?" Their answer goes in a notes file, verbatim.

## What to measure (admin console, weekly)

| Number | Where | Green | Red |
|---|---|---|---|
| Trial users who ran 10 scans | Users table, Plan column | 60%+ | under 30% |
| Trial → paid | Users table (Subscribed count / invited) | 15%+ | under 5% |
| eBay connected / paid | KPI tile | 70%+ | under 40% |
| Listed per paid user, week 1 | Users table row drawer | 5+ | under 2 |
| Scan cost per scan | Vision cost tile | under $0.02 | over $0.04 |
| Server errors / day | Errors section, digest email | 0 to 2 | 5+ |
| 30-day churn | Stripe dashboard | under 15% | over 35% |

Red on conversion with green on scans means the paywall or price is wrong.
Red on scans means the scanner or onboarding is wrong. Fix the one that is
red, then invite the next ten. Do not fix both at once.

## Timeline

- Week 1: invite 10. Watch the Errors section daily. Fix what breaks same day.
- Week 2: invite 10 more only if week 1 had zero "I couldn't scan" replies.
- Week 3: stop inviting. Read the table above. Decide: ads, or another round.

## Before the first invite (Chris, 30 min)

- Delete or reset your own test accounts so the Users table is only strangers.
- Confirm the Stripe customer emails (receipt, welcome) arrived on a real
  subscribe. cdemon did this on 09-05; that counts.
- Put the eBay Browse daily count somewhere you look. A 5,000/day ceiling
  with 30 users is fine; with a public post it is not.

## What not to do during the cohort

- No new features. Bugs and copy only.
- No price changes mid-cohort. The conversion number is useless if the price
  moved.
- No Magic. It stays admins-only until Pokémon converts.
