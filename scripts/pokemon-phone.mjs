// Pokémon phone batch (docs/POKEMON-IDENTIFICATION.md): Chris's REAL phone
// photos, pulled from prod's card_photos (the seller photo saved with each
// ledger card), replayed through the scanner's own read (first look + second
// look) and the scanner's own lookup walk. Truth = the catalog card Chris
// kept (cards.catalog_card_id); score = exact printing id at the top.
// Target ≥ 98% on clear photos — the number the catalog panel cannot give:
// glare, angle, hands, a sleeve.
//
//   npm run pokemon:phone                 # run (photos cached in backups/pokemon-phone/, reads in scripts/pokemon-phone.cache.json)
//   npm run pokemon:phone -- --fresh      # re-read every photo after a prompt change
//   npm run pokemon:phone -- --pull       # re-pull the photo list from prod (new scans)
//   npm run pokemon:phone -- --since 2026-09-10   # only photos saved on/after that day (UTC)
//
// Prod credentials come from .env.migration.json (dbUrl/dbToken) or
// TURSO_DATABASE_URL/TURSO_AUTH_TOKEN, read-only queries only. Anthropic key
// from .env.vercel.local. Photos never leave backups/ (gitignored). Every
// uncached photo is one or two Sonnet calls (~5.5k + ~3k tokens); the run
// refuses more than 40 without --yes.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { searchEnglishCardsLocal } = await import(at("lib/server/enCards.ts"));
const { isSecretRareNumber } = await import(at("lib/cardNumber.ts"));
const { analyzeCardImageWithUsage } = await import(at("lib/server/vision.ts"));
const { UNREADABLE_CONFIDENCE } = await import(at("lib/types.ts"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : null; };
const PHOTO_DIR = path.join(root, "backups/pokemon-phone");
const LIST_PATH = path.join(PHOTO_DIR, "batch.json");
const CACHE_PATH = path.join(root, "scripts/pokemon-phone.cache.json");
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.vercel.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
process.env.ANTHROPIC_API_KEY ||= env.ANTHROPIC_API_KEY;

async function pull() {
  let url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    const c = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));
    url = c.dbUrl; authToken = c.dbToken;
  }
  const db = createClient({ url, authToken });
  const r = await db.execute(
    `SELECT c.id, c.card_name, c.set_name, c.card_number, c.catalog_card_id, c.condition, p.updated_at
       FROM card_photos p JOIN cards c ON c.id = p.card_id
      WHERE c.game = 'pokemon' AND c.catalog_card_id IS NOT NULL
      ORDER BY p.updated_at DESC`,
  );
  const batch = [];
  for (const row of r.rows) {
    const file = path.join(PHOTO_DIR, `${row.id}.jpg`);
    if (!fs.existsSync(file)) {
      const b = await db.execute({ sql: "SELECT bytes FROM card_photos WHERE card_id = ?", args: [row.id] });
      fs.writeFileSync(file, Buffer.from(b.rows[0].bytes));
    }
    batch.push({ id: row.id, name: row.card_name, set: row.set_name, number: row.card_number, want: row.catalog_card_id, condition: row.condition, at: Number(row.updated_at) });
  }
  fs.writeFileSync(LIST_PATH, JSON.stringify(batch, null, 1));
  console.log(`pulled ${batch.length} Pokémon phone photos → ${path.relative(root, PHOTO_DIR)}`);
  return batch;
}

let batch = flag("pull") || !fs.existsSync(LIST_PATH) ? await pull() : JSON.parse(fs.readFileSync(LIST_PATH, "utf8"));
if (opt("since")) { const t = Date.parse(opt("since")); batch = batch.filter((p) => p.at >= t); }
if (opt("limit")) batch = batch.slice(0, Number(opt("limit")));
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
if (flag("fresh")) for (const p of batch) delete cache[p.id];

const VISION_CALL_CAP = 40;
const uncached = batch.filter((p) => !cache[p.id]).length;
console.log(`vision calls this run: ${uncached} uncached of ${batch.length} (≈${Math.round(uncached * 7)}k input tokens ≈ $${(uncached * 7 * 2 / 1000).toFixed(2)})`);
if (uncached > VISION_CALL_CAP && !flag("yes")) {
  console.error(`refusing ${uncached} vision calls without --yes (cap ${VISION_CALL_CAP}); use --limit N or --since to narrow`);
  process.exit(2);
}

// The scanner's own walk (app/app/page.tsx) — see pokemon-panel.mjs.
async function lookup(read) {
  if (!read || (typeof read.confidence === "number" && read.confidence < UNREADABLE_CONFIDENCE)) return [];
  const printed = read.cardNumber
    ? { number: read.cardNumber, setTotal: read.setTotal, setCode: read.setCode, isSecretRare: isSecretRareNumber(read.cardNumber, read.setTotal), setName: read.setName, copyrightYear: read.copyrightYear ?? null }
    : null;
  let matches = [];
  for (const candidate of [read.name, read.englishName].filter(Boolean)) {
    const found = (await searchEnglishCardsLocal(candidate, printed, 5, read.artStyle ?? null, read.firstEdition ?? null)).cards;
    if (found.length === 0) continue;
    if (matches.length === 0) matches = found;
    if (found[0].name.trim().toLowerCase() === candidate.trim().toLowerCase()) { matches = found; break; }
  }
  if (matches.length === 0 && printed?.setTotal) matches = (await searchEnglishCardsLocal("", printed, 5, null, read.firstEdition ?? null)).cards;
  return matches;
}

// Local mirror row for the card Chris kept, so a miss prints what it should have said.
const { DatabaseSync } = await import("node:sqlite");
const mirror = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });
const wantRow = mirror.prepare("SELECT name, set_name, local_id, set_card_count_official AS official FROM en_cards WHERE id = ?");

const misses = [];
let hit = 0, top3 = 0, n = 0, secondLooks = 0;
for (const p of batch) {
  let read = cache[p.id];
  if (!read) {
    const b64 = fs.readFileSync(path.join(PHOTO_DIR, `${p.id}.jpg`)).toString("base64");
    read = (await analyzeCardImageWithUsage(b64, "image/jpeg", "en", "pokemon")).read;
    cache[p.id] = read;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  }
  const found = await lookup(read);
  const rank = found.findIndex((c) => c.id === p.want);
  n++;
  if (read.secondLook) secondLooks++;
  if (rank === 0) hit++;
  if (rank > -1 && rank < 3) top3++;
  if (rank !== 0) {
    const w = wantRow.get(p.want);
    const top = found[0];
    misses.push({
      want: w ? `${w.name} ${w.local_id}/${w.official ?? "?"} [${w.set_name}] ${p.want}` : `${p.name} [${p.set} ${p.number}] ${p.want} (not in local mirror)`,
      got: top ? `${top.name} ${top.number} [${top.setName}] ${top.id}` : "(nothing)",
      read: `name=${read.name} number=${read.cardNumber} total=${read.setTotal} code=${read.setCode} set=${read.setName} year=${read.copyrightYear} art=${read.artStyle} 1st=${read.firstEdition} conf=${read.confidence} 2nd=${read.secondLook ?? "-"}`,
      rank,
    });
  }
  process.stdout.write(`\r${n}/${batch.length}`);
}
process.stdout.write("\r");
const pct = (a) => (n ? ((a / n) * 100).toFixed(1) : "0");
console.log(`\nexact card on real phone photos: ${hit}/${n} = ${pct(hit)}%  (target ≥ 98%)   within one tap (top 3): ${top3}/${n} = ${pct(top3)}%   second looks: ${secondLooks}`);
for (const m of misses) {
  console.log(`\n✗ want ${m.want}\n  got  ${m.got}${m.rank > 0 ? `  (right one at #${m.rank + 1})` : ""}\n  read ${m.read}`);
}
