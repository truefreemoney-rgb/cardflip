// Copy every card photo from data/photos/ into the card_photos table.
//
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
//   node scripts/migrate-photos.mjs [--dry-run]
//
// One-time cutover step for the Fly -> Vercel migration: photos live on the
// Fly volume today and inside the database after (cardPhotos.ts). Without
// TURSO_* set it writes to the local data/cardflip.db instead. Idempotent —
// a re-run overwrites the same rows. Run with the photo dir copied local
// (like the DB re-seed): PHOTO_SOURCE=path overrides the default dir.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const dryRun = process.argv.includes("--dry-run");
const PHOTO_DIR = process.env.PHOTO_SOURCE ?? path.join(process.cwd(), "data", "photos");
const DB_PATH = path.join(process.cwd(), "data", "cardflip.db").replace(/\\/g, "/");

const db = createClient(url ? { url, authToken } : { url: `file:${DB_PATH}` });
console.log(`target: ${url ?? DB_PATH}${dryRun ? " (dry run)" : ""}`);

const files = fs.existsSync(PHOTO_DIR)
  ? fs.readdirSync(PHOTO_DIR).filter((f) => /^[0-9a-f-]{36}\.jpg$/i.test(f))
  : [];
console.log(`${files.length} photo file(s) in ${PHOTO_DIR}`);

let done = 0;
let orphaned = 0;
let failed = 0;
for (const f of files) {
  const cardId = f.slice(0, -4);
  try {
    // The table references cards(id); a photo whose card is gone is junk.
    const owner = await db.execute({ sql: "SELECT 1 FROM cards WHERE id = ?", args: [cardId] });
    if (owner.rows.length === 0) {
      orphaned++;
      console.log(`skip (no card row): ${cardId}`);
      continue;
    }
    if (dryRun) {
      console.log(`would copy ${cardId}`);
      continue;
    }
    const bytes = fs.readFileSync(path.join(PHOTO_DIR, f));
    await db.execute({
      sql: "INSERT OR REPLACE INTO card_photos (card_id, bytes, updated_at) VALUES (?, ?, ?)",
      args: [cardId, bytes, Math.floor(fs.statSync(path.join(PHOTO_DIR, f)).mtimeMs)],
    });
    done++;
    if (done % 25 === 0) console.log(`${done}/${files.length}...`);
  } catch (err) {
    failed++;
    console.error(`FAILED ${cardId}: ${err.message}`);
  }
}
console.log(`done: ${done} copied, ${orphaned} orphaned, ${failed} failed`);
db.close();
process.exit(failed > 0 ? 1 : 0);
