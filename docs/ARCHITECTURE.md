# CardFlip architecture inventory

Written 2026-09-05 (v1.0.0, Phase 0 of the stewardship brief). Facts below were read from the code and the deploy history on that date; rows marked **confirm** need a dashboard Chris can see and I cannot. Keep this to one screen: what is live, what is legacy, where the recovery path is. Narrative and history live in `STATE.md` / `HISTORY.md`, not here.

## What is live

| Layer | Fact | Source |
|---|---|---|
| App | Next.js 16.3.0, App Router, React 19.2, TypeScript, Tailwind. One repo, one deployable. | `package.json` |
| Hosting | Vercel, **Pro** plan since 09-04. Production = branch `main`. Vercel's GitHub integration deploys every push to main. Previews for `vercel-migration` are **disabled** (`vercel.json` → `git.deploymentEnabled`). | `vercel.json`, Vercel dashboard |
| Runtime | Node.js serverless functions + static/ISR pages. Default function limit applies (Pro: 60 s wall, configurable); the three cron routes set `maxDuration = 300`. | `src/app/api/cron/*/route.ts` |
| Database | Turso (hosted libSQL) via `@libsql/client`. `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`. Plan tier: **confirm** (Turso dashboard). | `src/lib/db.ts` |
| Schema | `db.ts` runs the whole `CREATE TABLE IF NOT EXISTS` block plus column probes (`COLUMN_PROBES`) on **first use in every process**. A deploy is the migration. Idempotent by construction; no migration history table. Proven on prod 09-05 (admin console read the two newest tables). | `src/lib/db.ts:527` |
| Photos | Card photos are BLOBs in the `card_photos` table, served through `/api/card-image/[id]`. No object storage. | `src/lib/server/cardPhotos.ts` |
| Scheduled work | Vercel Cron → `GET /api/cron/mtg-prices` (09:00 UTC) and `GET /api/cron/pokemon-prices` (09:45 UTC), Bearer `CRON_SECRET`. Pokémon step also folds in eBay sales sync, wishlist alerts, reprice nudges. `/api/cron/daily` is the older combined route, still deployed, reachable only with the secret, **not** scheduled. | `vercel.json`, `src/lib/server/dailyJobs.ts`, `src/lib/server/cronAuth.ts` |
| Startup hook | `src/instrumentation.ts`: on boot runs `seedMtgMirror()` (batched import, no-op when current); the hourly in-process daily tick is **off on Vercel** (`process.env.VERCEL` guard). `onRequestError` writes every unhandled server error to the `error_events` table. | `src/instrumentation.ts` |
| Error visibility | `error_events` table, read only by the admin page (`/admin`, recent errors + 24 h count). Vercel function logs otherwise. **No external error tracker, no alerting.** | `src/lib/server/errorLog.ts`, `src/app/admin/page.tsx` |
| Auth | Email/password, DB sessions + cookie, optional TOTP with hashed backup codes. Admin console uses a separate panel cookie (`ADMIN_PANEL_USER/PASSWORD`), not a user session. | `src/lib/server/auth.ts`, `sessions.ts`, `totp.ts`, `adminGate.ts` |
| Rate limits | Per-IP in-memory limiter per route (resets on cold start) + durable DB day-counters for the things that must survive serverless (PSA quota, scan usage). | `src/lib/server/rateLimit.ts`, `dayBudget.ts`, `scanUsage.ts` |
| Feature switch | `settings` table, key `magic_public`. Gates landing copy, metadata/OG, help, legal pages, footer, every game toggle. Admins always see Magic. Toggle calls `revalidatePath("/", "layout")` (since 09-05) because public pages are static/ISR (landing `revalidate = 86400`). | `src/lib/server/settings.ts`, `src/app/api/admin/settings/route.ts` |
| CI | GitHub Actions `ci.yml` on push to main / vercel-migration and PRs: `npm ci`, `next typegen`, `tsc --noEmit`, `lint`, `npm test` (20 suites, temp-dir file DBs, no secrets). **Does not gate the Vercel deploy** and does not run `next build`. Last 5 main runs green (09-05). | `.github/workflows/ci.yml` |
| Env | 32 variables, names in `.env.example`, values only in Vercel (prod + preview) and gitignored `.env.local`. | `.env.example` |

## Third-party integrations

| Service | Used for | Where in code | Admin account | Notes |
|---|---|---|---|---|
| Vercel | hosting, cron, env | — | Chris (team `card-flip1`) | Pro since 09-04 |
| Turso | database | `lib/db.ts` | Chris | plan **confirm**; tokens in Vercel env |
| Anthropic | vision scan (Sonnet 5), help chat (Haiku 4.5) | `lib/server/vision.ts`, `helpChat.ts` | Chris (console) | auto-reload ON 09-05 |
| Stripe | checkout, portal, webhook (sole writer of sub state) | `lib/server/stripe.ts`, `api/stripe/webhook` | Chris | live keys; public details done 09-05; sandbox key in `.env.local` |
| eBay | OAuth, Sell Inventory/Offer, Browse comps, Orders, Finances, Negotiation, account-deletion webhook | `lib/server/ebay*.ts` | Chris (developer.ebay.com) | **one production keyset for all sellers**; limit-increase application pending (Task 3) |
| Fastmail SMTP | all outbound mail as support@cardflip.io | `lib/server/mail.ts` | Chris | SPF/DKIM on Dynadot |
| Dynadot | cardflip.io DNS | — | Chris | A → Vercel, MX/SPF/DKIM → Fastmail |
| PSA | cert verification | `lib/server/psa.ts` | Chris (API token) | **403 from Vercel IPs** (WAF); free tier 100/day pooled per IP; email to collectors-apis pending |
| TCGdex, pokemontcg.io | Pokémon catalog | `lib/server/enCards.ts`, scripts | Chris (API key) | mirrored into Turso by scripts from Chris's PC |
| Scryfall | Magic catalog | `lib/server/mtgCards.ts`, scripts | none | **429s cloud IPs** → mirror runs from Chris's PC |
| TCGplayer (via tcgcsv) | market prices | `lib/tcgcsv.ts`, price refresh | none | daily refresh |
| GitHub | repo + CI | `.github/` | Chris (`truefreemoney-rgb`) | `gh` CLI authed |
| iPostal1 | business mailing address | — | Chris | virtual mailbox 09-05 |

## What is legacy

| Item | Status | Action |
|---|---|---|
| Fly.io (`fly.toml`, `Dockerfile`) | **Dead.** No traffic, volume gone; cards restored into Turso 08-31; backup path deleted 09-04. Files only. | Delete both files (this phase). |
| Local SQLite file mode in `db.ts` (`data/cardflip.db` when `TURSO_DATABASE_URL` unset) | **Alive on purpose**: dev server, every test suite, and scripts run against a file DB. Not a prod path. | Keep. |
| `/api/cron/daily` combined route + hourly in-process tick | Superseded by the two split crons; tick is gated off on Vercel. | Keep the route as a manual `?force=1` lever; document. |
| `docs/MIGRATION.md` | Fly→Vercel cutover notes, complete. | Archive reference only. |
| `scripts/restore-fly-cards.mjs` | One-off from 08-31. | Delete when convenient. |

## Recovery path

| Failure | Path | Proven? |
|---|---|---|
| Bad deploy | Vercel → Deployments → promote previous. Or `git revert` on main. | Vercel UI, yes (09-04 redeploy) |
| Data loss / bad migration | Nightly dump: Windows Scheduled Task "CardFlip Turso backup" 10:00 local on Chris's PC → `scripts/backup-turso.mjs` → `backups/turso/cardflip-<date>.db.gz` (keeps 10). Restore = gunzip + `scripts/seed-turso.mjs --wipe` with `SEED_SOURCE`. | Backup verified end-to-end 08-31. Restore **not rehearsed** on prod. **Single copy, on one PC. No off-site.** |
| Secrets lost | Re-enter from each provider's dashboard into Vercel env. No vault. | n/a |
| Turso outage | None. App is down. | — |
| Anthropic outage / credits | Scanner returns an error; rest of app works. Auto-reload on. | — |

## Known risks (ranked)

1. **Backups are one copy on one PC.** Off-site copy (S3/Drive) is a backlog item. Restore never rehearsed.
2. **Schema runs in the request path.** Fine at this size; will become a cold-start cost and a rollback hazard. Move to numbered migrations run once from CI before it hurts.
3. **Jobs run inside 300 s functions.** Price refresh will half-finish silently once the catalog outgrows the ceiling. Move to a worker when the first timeout appears.
4. **One eBay keyset for all sellers.** Rate-limit increase pending.
5. **No alerting.** Errors land in a table nobody is paged on.
6. **Static caching vs. runtime switches.** Fixed for the Magic toggle; any future switch needs the same revalidate.
7. **PSA blocked from cloud IPs.** Feature degrades to manual grade; paid tier or proxy is the fix.
8. **Scanner page is 1,400 lines with the queue loop inside a component.** Refactor target #1.

## Baseline (2026-09-05, Windows 10, Node 24, clean `npm ci`)

| Step | Result |
|---|---|
| `npm ci` | ok (allow-scripts warnings only) |
| `npx next typegen` | ok |
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors**, 5 warnings — all unused imports/vars in `scripts/push-catalog.mjs` and `scripts/test-price-history.mjs` |
| `npm test` | **20 suites, all passed** (temp-dir file DBs, no network) |
| `npx next build` | **ok, ~20 s.** 57 API routes + `/admin` dynamic (ƒ); every page static (○); `/` is ISR, revalidate 1 d. |

Build finding worth knowing: `/help`, `/terms`, `/privacy`, `/opengraph-image` and the `/app/*` shells are fully static — they read the Magic switch at build time and only change on a rebuild or an explicit `revalidatePath`. That is why the toggle appeared not to work on 09-05 and why the settings route now revalidates the whole layout.

CI on GitHub (same steps minus build): last 5 runs on main green. Vercel: last 3 main commits deployed `success`.

**No baseline check failed. No blocking issue opened.** Phase 0 changes made: this document; `fly.toml` and `Dockerfile` deleted (dead since the 08-27 cutover). Nothing else touched.
