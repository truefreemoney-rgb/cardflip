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

1. **Async DB layer** — ✅ DONE 08-25 (this branch). `@libsql/client`
   adapter in lib/db.ts keeps the `db.prepare().get/all/run` shape (plus
   `db.transaction()` — the HTTP client rejects raw BEGIN); backend picked
   by env (TURSO_DATABASE_URL → remote, else the same local file). All
   scattered module-load DDL folded behind one schema gate. seedMtgMirror
   keeps its own sync node:sqlite connection, file-mode only. Gotchas
   found the hard way: (a) `as unknown as` casts and Promises passed into
   NextResponse.json() hide missing awaits from tsc — swept both classes
   by grep, verify with runtime smoke tests not just tsc; (b) the libsql
   native binding asserts at Windows process exit unless the client is
   closed (beforeExit hook in db.ts). Verified: tsc/lint clean, all 9
   suites pass, dev-server e2e (demo seed, Pokémon+MTG search, history,
   wishlist, price checks) clean on the file backend.
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
   **Pre-work ✅ DONE 08-25:** Turso provisioned via Platform API (org
   `cardflipper`, group `default` @ aws-us-east-1, db `cardflip`, url
   `libsql://cardflip-cardflipper.aws-us-east-1.turso.io`; db auth token
   minted full-access/never-expires — session-local, becomes a Vercel env
   var; Chris's platform token was pasted in chat 08-25 → revoke it at
   app.turso.tech after cutover). Seeded 330,471 rows from the local file
   in 89s via scripts/seed-turso.mjs (counts verified table-by-table),
   and the whole app ran against Turso locally — demo wipe+reseed
   (writes), Pokémon + MTG search, price history all clean. Cutover
   re-seed: copy prod's volume file local, `--wipe` run of the same
   script.
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
