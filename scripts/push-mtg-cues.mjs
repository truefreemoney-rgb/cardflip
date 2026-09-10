#!/usr/bin/env node
// Copies the Magic printing cues (artist, frame, border_color, frame_effects,
// promo_types, full_art, textless — docs/MTG-IDENTIFICATION.md, phase 1) from
// the LOCAL mirror (data/cardflip.db, filled by scripts/sync-mtg.mjs) onto the
// production Turso mirror, row by row on id. Scryfall throttles the sync from
// the cloud, so the local sync is the source; this pushes only the cue
// columns, never prices or images, so it is safe to run any time.
//
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/push-mtg-cues.mjs
//   (reads .env.migration.json for the prod url/token when the env vars are unset)
//
// The columns must already exist on prod — src/lib/db.ts adds them on the
// first request after a deploy (COLUMN_PROBES); run this after that deploy.
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

let url = process.env.TURSO_DATABASE_URL;
let authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  const cfgPath = path.join(process.cwd(), ".env.migration.json");
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8").replace(/^﻿/, ""));
    url = url || cfg.dbUrl;
    authToken = authToken || cfg.dbToken;
  }
}
if (!url || !authToken) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (or have .env.migration.json)");
  process.exit(1);
}

const local = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"), { readOnly: true });
const remote = createClient({ url, authToken });

const rows = local
  .prepare(
    `SELECT id, artist, frame, border_color, frame_effects, promo_types, full_art, textless
       FROM mtg_cards
      WHERE frame <> '' OR artist <> ''`,
  )
  .all();
console.log(`local: ${rows.length} printings with cue data`);
if (rows.length < 50_000) {
  console.error("That is not a full mirror — run npm run sync:mtg first.");
  process.exit(1);
}

// Sanity: the columns exist on prod (the app adds them on first request after deploy).
try {
  await remote.execute("SELECT artist, frame FROM mtg_cards LIMIT 1");
} catch (err) {
  console.error("prod mtg_cards has no cue columns yet — deploy first, load one page, then rerun.", String(err).slice(0, 200));
  process.exit(1);
}

const BATCH = 400;
let done = 0;
const started = Date.now();
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  await remote.batch(
    chunk.map((r) => ({
      sql: `UPDATE mtg_cards SET artist = ?, frame = ?, border_color = ?, frame_effects = ?, promo_types = ?, full_art = ?, textless = ? WHERE id = ?`,
      args: [r.artist, r.frame, r.border_color, r.frame_effects, r.promo_types, r.full_art, r.textless, r.id],
    })),
    "write",
  );
  done += chunk.length;
  if (done % (BATCH * 25) === 0 || done === rows.length) {
    console.log(`${done}/${rows.length} (${Math.round((Date.now() - started) / 1000)}s)`);
  }
}
const check = await remote.execute("SELECT COUNT(*) AS n FROM mtg_cards WHERE frame <> ''");
console.log(`prod: ${check.rows[0].n} printings now carry cue data`);
