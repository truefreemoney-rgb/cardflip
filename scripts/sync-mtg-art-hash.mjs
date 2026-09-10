// Fills mtg_cards.art_hash for every Art Series front on the local mirror
// (docs/MTG-IDENTIFICATION.md, 09-10): the picture fingerprint that names an
// Art Series card, since its front prints no text. ~2,500 Scryfall "normal"
// images at 8/s ≈ 6 minutes; rows already hashed are skipped, so reruns are
// cheap. Prod gets the column through scripts/push-mtg-cues.mjs.
//
//   npm run mtg:arthash            # fill what is missing
//   npm run mtg:arthash -- --all   # recompute everything
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { dHash } = await import(at("lib/server/artHash.ts"));

const root = process.cwd();
const db = new DatabaseSync(path.join(root, "data/cardflip.db"));
try { db.exec("ALTER TABLE mtg_cards ADD COLUMN art_hash TEXT NOT NULL DEFAULT ''"); } catch { /* present */ }

const all = process.argv.includes("--all");
// --scope art (default) | lands | pre1998 | all-old: which rows to fingerprint.
const scopeArg = process.argv[process.argv.indexOf("--scope") + 1];
const scope = process.argv.includes("--scope") ? scopeArg : "art";
const SCOPES = {
  art: "type_line LIKE 'Card%' AND set_code LIKE 'a%'",
  lands: "type_line LIKE 'Basic Land%'",
  pre1998: "set_release_date < '1998-01-01'",
};
const where = SCOPES[scope] ?? SCOPES.art;
const rows = db
  .prepare(
    `SELECT id, name, image_url FROM mtg_cards
      WHERE lang = 'en' AND image_url <> '' AND (${where})
        ${all ? "" : "AND art_hash = ''"}
      ORDER BY id`,
  )
  .all();
console.log(`${rows.length} ${scope} fronts to hash`);
const update = db.prepare("UPDATE mtg_cards SET art_hash = ? WHERE id = ?");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
let failed = 0;
for (const r of rows) {
  try {
    const res = await fetch(r.image_url, { headers: { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "image/jpeg" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hash = await dHash(Buffer.from(await res.arrayBuffer()));
    update.run(hash, r.id);
  } catch (err) {
    failed++;
    console.log(`\n  !! ${r.name}: ${err?.message ?? err}`);
  }
  n++;
  if (n % 25 === 0) process.stdout.write(`\r${n}/${rows.length}`);
  await sleep(125);
}
process.stdout.write("\r");
const total = db.prepare("SELECT COUNT(*) AS n FROM mtg_cards WHERE art_hash <> ''").get().n;
console.log(`hashed ${n - failed}, failed ${failed}; ${total} rows carry an art hash`);
if (!fs.existsSync(path.join(root, "data/cardflip.db"))) process.exit(1);
