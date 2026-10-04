# Pricing-only mode (Chris 10-04, approved the mockup: "looks good")

Card-show vendors want scan + market price + inventory value without the eBay selling UI.

## What Chris approved
1. **Welcome question, once, right after signup** (new users only): "Welcome to CardFlip / How will you use it? You can change this any time from Inventory." Two big buttons:
   - **Sell on eBay**: "Scan, price, and list cards on eBay in one tap." (today's app)
   - **Just price my cards**: "Market prices and inventory value. Great for card shows and vendors."
2. **Toggle at the top of Inventory**: two-way pill **Selling · Pricing only**.
3. Existing accounts default to Selling. Turning it off never deletes or ends listings; it only hides UI. Same plans and prices.
4. Pricing only HIDES: List/Publish/Send to eBay, Connect eBay prompts (header chip/button too), eBay draft + "Live on eBay" badges, Listed/Ended filters, Relist/End listing, "after eBay fees"/net/profit numbers, listing copy fields, eBay comps panel, eBay steps in the tour. KEEPS: scanner, market price + history, condition/printing, inventory, collection value, alerts, mark-as-sold, wishlist sold-search link.
5. Later (not now): stack total, "my offer" at a set % of market, a one-time nudge for users who never list.

## Code map (Explore pass 10-04, paths under src/)
- **Column**: `lib/db.ts` COLUMN_PROBES `"users"` entry (~:932) add `"pricing_only INTEGER NOT NULL DEFAULT 0"`; fingerprint migrates itself. Model on `handle_public` (db.ts:994).
- **User plumbing**: `lib/server/users.ts` UserRow (:77), User (:21), fromRow (:128), updateUserProfile (:667/:686), PublicUser (~:814) + toPublicUser (~:850); client `lib/client/auth.ts:8` SessionUser; `lib/client/accountApi.ts:74` updateProfile; `components/SessionProvider.tsx` patchUser (:128).
- **API**: `app/api/account/route.ts` PATCH (:79, handlePublic ~:106) — add `pricingOnly` boolean. Server guard: `lib/server/auth.ts:80` sellingGate could also refuse when pricing_only (optional; UI hide is the ask).
- **Signup**: `app/signup/page.tsx` phases "account" | "confirm" | "ebay" (:25, :95-120, URL /signup?step=welcome :116); the "ebay" phase shows `components/EbayConnectCard.tsx`. Put the welcome question as the phase after account/confirm; "Sell on eBay" → today's ebay phase, "Just price my cards" → PATCH pricingOnly then router.push("/app").
- **Inventory**: `app/app/collection/page.tsx` header :1688-1711 (h1 :1690, right cluster :1705) = toggle spot. eBay bits: :289/:428 net after fees, :361 Listed on eBay at, Relist/Ended :643 :1022 :1077 :2604 :2707 :2921, End listing :1372, FILTERS :95 + :1523-1526, money panel :1546-1590 (:1552, :1829), sort listedAge :1645, LocalListingLine :417.
- **Card editors**: `components/CardEditor.tsx` ListedPanel :488, SoldPanel :492 (keep mark-sold), MarketMetricsPanel :1084, LocalListingLine :1419, ListingCopyFields :1447, EbayPostActions :1452; `components/SealedEditor.tsx` :91 :92 :219 :221 :223.
- **Scanner** `app/app/page.tsx`: sendAll :1110-1117, Send to eBay/Connect :1436-1452, footer :1566-1572, comps :38 :772-825, ?ebay=connected :220.
- **Elsewhere**: `components/AppHeader.tsx` showEbay :23, :57-90; `components/StatusChip.tsx:21` Live on eBay (QueueRow :72); collection/report page (fees report: hide link or eBay lines); collection/insights :246; account page eBay section :664-696; account/welcome :116; `components/CardDetailModal.tsx` :196-202; `components/TourOverlay.tsx` :81 :95.

## Build order (small pushes)
1. Column + plumbing + PATCH + Inventory toggle + hide in collection page, editors, header, scanner. Test on mobile emulation first (memory cardflip-mobile-first).
2. Welcome question in signup.
3. Tour copy + account page + report/insights tidy.
