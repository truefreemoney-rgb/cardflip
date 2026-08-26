# Fly → Vercel migration plan

Decision: Chris, 08-25 — move hosting from Fly.io to Vercel, informed of
cost/risk. Executed on branch `vercel-migration`; `main` stays deployable
to Fly throughout. The live site keeps running on Fly until the final
cutover step.

## Target architecture

| Today (Fly) | After (Vercel) |
|---|---|
| SQLite file on volume (`node:sqlite`, sync) | **Turso** (libSQL — same SQL dialect, async client) |
| Card photos on disk (`cardPhotos.ts`) | **Tigris S3 bucket** (reuse the existing `backup.ts` SigV4 client — no new vendor) |
| `instrumentation.ts` hourly timer + heartbeat | **Vercel Cron** → split cron endpoints |
| In-memory rate limiting (single machine) | DB-backed buckets in Turso (best-effort per-route) |
| `backup.ts` VACUUM INTO → Tigris | Retired — Turso has point-in-time restore |
| eBay RuName callback on fly.dev | Re-registered to cardflip.io in eBay dev portal |

## Phases

1. **Async DB layer** (the long pole — 105 sync call sites / 22 files).
   Replace `node:sqlite` with `@libsql/client`; every `db.prepare().get/
   all/run` becomes `await`. Mechanical but wide: every server lib and
   route goes async-aware. Schema DDL unchanged (SQLite dialect).
2. **Photos → Tigris.** `cardPhotos.ts` reads/writes S3 objects instead of
   `data/photos/`; `/api/card-image/[id]` streams from the bucket. One-time
   copy script for existing photos.
3. **Jobs → Vercel Cron.** `dailyJobs.ts` splits into per-step endpoints
   (`/api/cron/mtg-prices`, `/pokemon-prices`, `/sweep`, `/ebay-sales`),
   each under the function time limit (Fluid compute, maxDuration raised;
   the Scryfall bulk scan is the riskiest fit — chunk it if needed).
   CRON_SECRET auth unchanged.
4. **Parallel deploy.** Vercel project builds from the GitHub repo
   (branch), env vars copied from Fly secrets, Turso seeded from a fresh
   SQLite export, full test pass on the vercel.app preview URL including
   scan→price→draft.
5. **Cutover.** Brief write freeze → final data delta → Dynadot DNS from
   Fly IPs to Vercel (A 76.76.21.21 / CNAME www) → Chris updates eBay dev
   portal (RuName callback + account-deletion endpoint) → Fly kept warm
   one week as rollback → decommission Fly machine + volume.

## Rollback

Any point before cutover: nothing changed for users (main still deploys
to Fly). After cutover: DNS back to Fly IPs (5-min TTL), Fly machine
still holds the pre-freeze database.

## Chris's part (blockers, in order)

1. Create a **Turso** account (turso.tech, free tier fine to start) and
   paste me an API token — I do everything else with it.
2. Vercel: connect the GitHub repo `truefreemoney-rgb/cardflip` in the
   Vercel dashboard (Add New → Project → Import). No deploy settings
   needed — I'll configure via `vercel.json`.
3. At cutover time only: eBay dev portal URL updates (I'll give exact
   fields), and the DNS edit at Dynadot (I'll give exact records).

## Known losses / accepted tradeoffs

- Monthly cost rises (~$5 Fly → Vercel Pro $20 + Turso usage).
- The day-old Tigris DB backup system is retired (Turso PITR replaces it).
- Rate limiting becomes per-region best-effort until DB-backed version lands.
