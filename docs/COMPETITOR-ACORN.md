# Competitor: Acorn TCG (researched 10-28-2026)

Pokémon-only card scanner, iPhone/iPad/Mac. Solo dev Juanjo Valiño (Asturias, Spain), individual seller, no company.
Sources: App Store id6740246597, acorntcg.com (+ /faq, /refund-policy, sitemap), newsletter.jjvalino.com (09-Aug-2026), Similarweb, Appllama, mwm.ai.

## Numbers
- Launched 27 Feb 2025 (20 months before this note). Updates every 2-4 weeks.
- US rating 4.8 from ~16K ratings (site claims 32,749 worldwide). 37 App Store languages.
- Downloads: 250K-300K+ total, ~40K/month (Appllama estimate).
- Revenue (his own claim, unverified): past $50K/month, $500K+ total, 99% from Acorn; ads at 2.6x return on spend; no influencers, makes all content himself.
- Website: ~10.7K visits/month, 94% US, top source paid social. 8-page sitemap, no card/set pages = near-zero Google traffic. Most users arrive through the App Store, not the website.

## Pricing
- $7.99/week, yearly ~$35-60 (varies by storefront), lifetime $99.99.
- Web checkout (Paddle) sells Lifetime only, 14-day refund = skips Apple's cut.
- Free: 50 saved cards, 1 collection, very few scans (reviews say ~3). Pro: unlimited scans/cards, graded prices, TCGplayer/Cardmarket prices + links, export, app icons.
- Onboarding ~23 steps then one paywall (Appllama count).

## Stack/marketing
- Next.js on Vercel (same as ours); pixels: Meta, TikTok, Reddit; PostHog analytics.
- Prices refresh every 24 h; price source not named.

## Complaints (App Store reviews)
Slow scans in poor light; vintage cards matched to modern printings; no 1st Edition vs Unlimited switch; Chinese/some Japanese/basic energy cards missed; some prices far low; paywall limits scans; paid users shown as trial until Restore Purchases; a lifetime offer vanished; some support emails unanswered.

## Bad reviews, counted (Apple US review feed, all 195 written reviews Feb 2025 - Oct 2026)
106 five-star, 8 four, 16 three, 15 two, 50 one. The 81 reviews at 1-3 stars, by main complaint (rough count, some overlap):
- ~40 = PAYWALL: "pay to scan", only 1-3 free scans (or 1 in the tutorial), told after making an account / filling half a master set; still the #1 complaint in Oct 2026.
- ~15 = scanner slow (minutes) / fails / wrong card.
- ~6 = foreign + Japanese cards not read.
- ~6 = prices wrong or far low; one says the free scan showed $14.58, after paying the same card showed $3.50 (bait).
- ~5 = billing: trial charged a different amount, can't find how to cancel, "free trial then charged".
- ~3 = vintage: 1st Edition vs Unlimited can't be changed, 2009 holos read as newer cards.
- ~3 = can't sign in (endless loading). 2 = hard to find owned cards. 1 = no condition choice. 1 = asked to rate, then paywall.
- Many writers are KIDS ("I'm a kid", "I'm broke", "my mom bought it"): the paying adult is often a parent.

## Lessons from the bad reviews
1. Say the free deal BEFORE sign-up (landing, App Store text, first screen): how many free scans, what stays free. Surprise paywalls are what makes people angry, not the price itself.
2. The free taste must be real (several scans that show the real price), and search-to-add stays free.
3. Same price before and after paying (our single-source pricing already does this; never inflate a trial result).
4. Scanner speed + vintage printings + condition = keep as our proof points (8 s budget, 1st Edition twins, condition picker).
5. Kids are a big audience: plain words, sign in with Apple/Google, parent-friendly paying.
6. Easy cancel, honest trial wording, never ask for a rating right before a paywall.
7. Japanese / foreign cards = check where our scanner stands before the app launch.

## Takeaways for CardFlip
- The App Store is his main way in; our native app is the biggest growth lever.
- Our honest edges: 5 games, generous free start, real-scan ads, 1st Edition twins, stated sold-price sources, thousands of Google card pages, ~1/4 his price.
- Learn: answer every review, ship updates often, short scanner shortcut (Action Button / Lock Screen), App Store localization.
