# CardFlip social kit — every big site, the assets, the steps

Built 09-10. Assets are rendered by `npm run social:assets` into
`public/social/` and are live at **https://cardflip.io/social/<file>.png**
(tap → hold → Save Image on a phone). `docs/SOCIAL.md` is the plan from
run #26 (handles, first posts, weekly rhythm); this is the checklist.

## The same three things everywhere

| Field | Value |
|---|---|
| Display name | `CardFlip` |
| Handle | `cardflipio` → if taken `cardflipapp` → `getcardflip`. Same one on every site; check all of them at namechk.com first (2 min). |
| Website | `https://cardflip.io` |
| Profile picture | `avatar-1000.png` (sites that cap lower: `avatar-512.png`, `avatar-400.png`) |
| Category | App / Software · Collectibles |
| Email on the account | support@cardflip.io |
| Bio, 150 chars | Scan a Pokémon or Magic card. Get the real price. List it on eBay in one tap. 10 free scans → cardflip.io |
| Bio, 80 chars | Scan a card. See the real price. List it on eBay. 10 free scans ↓ |
| Bio, 1 line | Scan a card, see what it's worth. |

Use a new email alias per site only if a site refuses a shared one. Turn on
two-factor on every account the day you make it; use the same authenticator
app. Write the handle + login into the password manager before leaving each
site.

## Site by site

Rule for all: profile picture first, banner second, bio third, website
fourth, then one post before you leave — an empty account with a banner
looks abandoned.

| # | Site | Make it here | Profile pic | Banner file (size) | Bio limit | Notes |
|---|---|---|---|---|---|---|
| 1 | **Instagram** | instagram.com/accounts/emailsignup → switch to Professional (Creator) in Settings | 1000 | none | 150 | Link in bio = cardflip.io. First post: `post-square.png`. Reels are the channel. |
| 2 | **TikTok** | tiktok.com/signup → Business account (Settings → Manage account) so the bio gets a website link | 1000 | none | 80 | Same clips as Reels, no music licence issues on Business accounts. |
| 3 | **YouTube** | youtube.com → Create a channel → Customize channel | 1000 (min 800) | `youtube-banner.png` 2560×1440 | 1000 | Shorts only to start. Handle set under Basic info. |
| 4 | **X (Twitter)** | x.com/i/flow/signup → Edit profile | 400 | `x-banner.png` 1500×500 | 160 | Pin the first post. Turn off DMs from everyone. |
| 5 | **Facebook Page** | facebook.com/pages/create (needs a personal FB login) | 1000 (170 shown) | `facebook-cover.png` 1640×856 | 255 | The Page, not a profile. Add the Shop / Website button → cardflip.io. Buy/sell groups live here. |
| 6 | **Threads** | Threads app → sign in with the Instagram account | (Instagram's) | none | 150 | Free with #1. Same handle automatically. |
| 7 | **Reddit** | reddit.com/register → make `u/cardflipio`; do NOT make r/cardflip yet | 400 (256 shown) | `reddit-banner.png` 1920×384 (profile banner) | 200 | Answer price questions in r/PokemonTCG, r/mtgfinance, r/pkmntcgtrades. No links for two weeks (rule from SOCIAL.md). |
| 8 | **Pinterest** | pinterest.com/business/create | 1000 (165 shown) | `pinterest-cover.png` 800×450 | 500 | Claim the website (Settings → Claimed accounts; it gives an HTML tag — paste it to Claude, same as Google). Pins: `pinterest-pin.png` 1000×1500. |
| 9 | **LinkedIn Page** | linkedin.com/company/setup/new (needs a personal profile) | 400 | `linkedin-cover.png` 1128×191 | 2000 | For the dealer tier later; one post a month is fine. |
| 10 | **Bluesky** | bsky.app → Create account | 1000 | `bluesky-banner.png` 1500×500 | 256 | Set the handle to `cardflip.io` itself (Settings → Change handle → I have my own domain → DNS TXT; paste the value to Claude). |
| 11 | **Discord** | discord.com → + → Create My Own → Community | 512 | `discord-banner.png` 960×540 | — | Server "CardFlip". Channels: #scans, #prices, #help. Invite link goes in every other bio's link list. |
| 12 | **Twitch** | twitch.tv/signup | 512 | `twitch-banner.png` 1200×480 | 300 | Only if live pack openings / scanning sessions become a thing. Claim the name now. |
| 13 | **Snapchat** | snapchat.com → Public Profile (Settings → Public Profile → Create) | 1000 | none | 80 | Claim the name; post the same Reels as Stories. |
| 14 | **WhatsApp Business** | WhatsApp Business app → Business tools → Business profile | 1000 | none | 139 | Sellers message here. Catalog = cardflip.io link. |

Do 1–4 first (that is SOCIAL.md), then 5–8, then the rest are name claims:
create the account, upload the picture, write the bio, one post, leave.

## Link-in-bio (one link everywhere)

Every site allows one link. Point them all at **https://cardflip.io** —
the homepage already has the app, pricing and help. If you want the stack
(app / TikTok / YouTube / Discord) on one page, say so and I'll add
`cardflip.io/links` — a plain in-repo page, no Linktree.

## Instant share links — the "plug-ins"

Prefilled share URLs. Open one, it lands on the site's composer with the
text and link filled in. Use them from a phone; change the text as you like.

| Site | URL |
|---|---|
| X | `https://x.com/intent/post?text=Scan%20a%20card%2C%20see%20what%20it%27s%20worth.%2010%20free%20scans&url=https%3A%2F%2Fcardflip.io` |
| Facebook | `https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fcardflip.io` |
| Reddit | `https://www.reddit.com/submit?url=https%3A%2F%2Fcardflip.io&title=Scan%20a%20card%2C%20see%20what%20it%27s%20worth` |
| Pinterest | `https://pinterest.com/pin/create/button/?url=https%3A%2F%2Fcardflip.io&media=https%3A%2F%2Fcardflip.io%2Fsocial%2Fpinterest-pin.png&description=Scan%20a%20card%2C%20see%20what%20it%27s%20worth` |
| LinkedIn | `https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fcardflip.io` |
| Bluesky | `https://bsky.app/intent/compose?text=Scan%20a%20card%2C%20see%20what%20it%27s%20worth.%2010%20free%20scans%20https%3A%2F%2Fcardflip.io` |
| Threads | `https://www.threads.net/intent/post?text=Scan%20a%20card%2C%20see%20what%20it%27s%20worth.%2010%20free%20scans%20https%3A%2F%2Fcardflip.io` |
| WhatsApp | `https://wa.me/?text=Scan%20a%20card%2C%20see%20what%20it%27s%20worth%20https%3A%2F%2Fcardflip.io` |
| Telegram | `https://t.me/share/url?url=https%3A%2F%2Fcardflip.io&text=Scan%20a%20card%2C%20see%20what%20it%27s%20worth` |
| Email | `mailto:?subject=CardFlip&body=Scan%20a%20card%2C%20see%20what%20it%27s%20worth%3A%20https%3A%2F%2Fcardflip.io` |

Instagram, TikTok, YouTube and Snapchat have no web composer link — you
upload the clip in the app.

The in-app version (a Share button on a scan result: "Scanned Charizard —
worth $212" as a card image, every one of these links behind it) is the
real plug-in; it is on my queue as soon as you say the word. Cost: about a
day. The kit above needs nothing from the code.

## Files

| File | Size | For |
|---|---|---|
| avatar-1000.png / -512 / -400 | square | every profile picture |
| x-banner.png, bluesky-banner.png | 1500×500 | X, Bluesky |
| facebook-cover.png | 1640×856 | Facebook Page |
| youtube-banner.png | 2560×1440 | YouTube (safe area 1546×423 in the middle) |
| linkedin-cover.png | 1128×191 | LinkedIn Page |
| twitch-banner.png | 1200×480 | Twitch |
| reddit-banner.png | 1920×384 | Reddit profile |
| pinterest-cover.png | 800×450 | Pinterest board cover |
| discord-banner.png | 960×540 | Discord server banner / invite |
| post-square.png | 1080×1080 | Instagram, Facebook, LinkedIn, Threads first post |
| post-story.png | 1080×1920 | Stories, Reels cover, TikTok cover, Shorts thumbnail, Snapchat |
| post-landscape.png | 1200×628 | X, Bluesky, link previews |
| pinterest-pin.png | 1000×1500 | Pinterest pin |

Change the tagline, colours or sizes in `scripts/social-assets.mjs` and
re-run; it is one HTML template per kind.
