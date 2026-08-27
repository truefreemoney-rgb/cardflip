// One-off: restore the cards that never made it from Fly into Turso.
//
//   node scripts/restore-fly-cards.mjs [--dry-run] [--include-demo]
//
// The 08-27 cutover left Turso with 2 cards while the Fly volume held 27 --
// truefreemoney's 19 and cowboyrocks' 2 were never carried over. Source is
// backups/fly-final/cardflip-prod.db (integrity_check ok), pulled off the Fly
// volume before the app is destroyed. Cards schema and user ids are identical
// in both databases, so rows copy straight across.
//
// demo@cardflip.dev's 6 rows are throwaway test data and are skipped unless
// --include-demo. Existing ids are never touched (INSERT OR IGNORE), so a
// re-run is safe. Photos on Fly lived on disk (backups/fly-final/photos/);
// Turso keeps them in card_photos, so they are loaded here too.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const dryRun = process.argv.includes("--dry-run");
const includeDemo = process.argv.includes("--include-demo");
const DEMO = "demo@cardflip.dev";

const root = process.cwd();
const backup = path.join(root, "backups", "fly-final", "cardflip-prod.db").split(path.sep).join("/");
const photoDir = path.join(root, "backups", "fly-final", "photos");
const cfg = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));

const src = createClient({ url: "file:" + backup });
const dst = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
console.log("source:", backup);
console.log("target:", String(cfg.dbUrl).replace(/^libsql:\/\//, "").split("?")[0], dryRun ? "(dry run)" : "");

const cols = (await src.execute("PRAGMA table_info(cards)")).rows.map((r) => r.name);
const existing = new Set((await dst.execute("SELECT id FROM cards")).rows.map((r) => r.id));
const dstUsers = new Set((await dst.execute("SELECT id FROM users")).rows.map((r) => r.id));

const rows = (await src.execute(
  "SELECT c.* , u.email AS _email FROM cards c JOIN users u ON u.id = c.user_id"
)).rows;

let inserted = 0, skippedExisting = 0, skippedDemo = 0, skippedNoUser = 0;
const placeholders = cols.map(() => "?").join(", ");
const sql = "INSERT OR IGNORE INTO cards (" + cols.join(", ") + ") VALUES (" + placeholders + ")";

for (const r of rows) {
  if (!includeDemo && r._email === DEMO) { skippedDemo++; continue; }
  if (existing.has(r.id)) { skippedExisting++; continue; }
  if (!dstUsers.has(r.user_id)) { skippedNoUser++; console.log("  skip (no such user in Turso):", r.card_name); continue; }
  console.log((dryRun ? "  would restore: " : "  restoring: ") + String(r.card_name) + " [" + String(r.status) + "] " + String(r.id).slice(0, 8));
  if (!dryRun) await dst.execute({ sql, args: cols.map((c) => r[c]) });
  inserted++;
}
console.log("cards: " + inserted + (dryRun ? " would be restored" : " restored") + ", " + skippedExisting + " already there, " + skippedDemo + " demo skipped, " + skippedNoUser + " orphaned");

// Photos: only for cards that now exist in Turso.
let photos = 0;
if (fs.existsSync(photoDir)) {
  const live = new Set((await dst.execute("SELECT id FROM cards")).rows.map((r) => r.id));
  for (const f of fs.readdirSync(photoDir).filter((f) => /^[0-9a-f-]{36}\.jpg$/i.test(f))) {
    const cardId = f.slice(0, -4);
    if (!live.has(cardId)) continue;
    const full = path.join(photoDir, f);
    console.log((dryRun ? "  would attach photo: " : "  attaching photo: ") + cardId.slice(0, 8));
    if (!dryRun) {
      const bytes = fs.readFileSync(full);
      const at = Math.floor(fs.statSync(full).mtimeMs);
      await dst.execute({ sql: "INSERT OR REPLACE INTO card_photos (card_id, bytes, updated_at) VALUES (?, ?, ?)", args: [cardId, bytes, at] });
      await dst.execute({ sql: "UPDATE cards SET photo_at = ? WHERE id = ?", args: [at, cardId] });
    }
    photos++;
  }
}
console.log("photos: " + photos + (dryRun ? " would be attached" : " attached"));
