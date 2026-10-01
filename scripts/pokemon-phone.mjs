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
import { devAnthropicKey } from "./lib/dev-key.mjs";

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { searchEnglishCardsLocal } = await import(at("lib/server/enCards.ts"));
const { isSecretRareNumber } = await import(at("lib/cardNumber.ts"));
const { analyzeCardImageWithUsage, tiebreakByPicture } = await import(at("lib/server/vision.ts"));
const { tiebreakIds } = await import(at("lib/tiebreak.ts"));
const { UNREADABLE_CONFIDENCE } = await import(at("lib/types.ts"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : null; };
const PHOTO_DIR = path.join(root, "backups/pokemon-phone");
// --seller (10-01): eBay seller photos instead of Chris's own (list built by scripts/pokemon-seller-from-raw.mjs;
// truth = the listing title's name + number). --id <id> runs one photo (re-read a miss with --id X --fresh).
const SELLER = flag("seller");
const LIST_PATH = path.join(PHOTO_DIR, SELLER ? "seller.json" : "batch.json");
const CACHE_PATH = path.join(root, SELLER ? "scripts/pokemon-seller.cache.json" : "scripts/pokemon-phone.cache.json");
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.vercel.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
process.env.ANTHROPIC_API_KEY = devAnthropicKey(); // testing-workspace key only, never prod (scripts/lib/dev-key.mjs)

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

let batch = !SELLER && (flag("pull") || !fs.existsSync(LIST_PATH)) ? await pull() : JSON.parse(fs.readFileSync(LIST_PATH, "utf8"));
if (opt("id")) { const ids = opt("id").split(","); batch = batch.filter((p) => ids.includes(p.id)); }
if (opt("since")) { const t = Date.parse(opt("since")); batch = batch.filter((p) => p.at >= t); }
if (opt("limit")) batch = batch.slice(0, Number(opt("limit")));
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
if (flag("fresh")) for (const p of batch) delete cache[p.id];
// --hide-number (10-01, blurred-number test): score the cached read with its number blanked, as if
// the number line could not be read. No new reads: only photos already read WITH a number.
// --sample N takes N of them spread across the batch. --ties counts the near-ties the app would
// send to the picture check; --tiebreak makes the call (Opus, ~3¢, answers cached).
const HIDE = flag("hide-number");
if (HIDE) {
  batch = batch.filter((p) => cache[p.id]?.cardNumber);
  const want = Number(opt("sample") ?? 0);
  if (want) { const k = Math.max(1, Math.floor(batch.length / want)); batch = batch.filter((_, i) => i % k === 0).slice(0, want); }
}

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
let hit = 0, top3 = 0, n = 0, secondLooks = 0, spent = 0;
const TIE_CACHE_PATH = path.join(root, "scripts/pokemon-seller-tiebreak.cache.json");
const tieCache = fs.existsSync(TIE_CACHE_PATH) ? JSON.parse(fs.readFileSync(TIE_CACHE_PATH, "utf8")) : {};
let ties = 0, tieSpent = 0, tieDeclined = 0, tieCancelled = 0;
for (const p of batch) {
  let read = cache[p.id];
  if (!read) {
    const b64 = fs.readFileSync(path.join(PHOTO_DIR, `${p.id}.jpg`)).toString("base64");
    const res = await analyzeCardImageWithUsage(b64, "image/jpeg", "en", "pokemon");
    read = res.read;
    // Sonnet rates ($ per million): input 2, output 10, cache read 0.2, cache write 2.5 (scanUsage RATES).
    spent += (res.usage.inputTokens * 2 + res.usage.outputTokens * 10 + res.usage.cacheReadTokens * 0.2 + res.usage.cacheWriteTokens * 2.5) / 1e6;
    cache[p.id] = read;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  }
  if (HIDE) read = { ...read, cardNumber: null, setTotal: null };
  let found = await lookup(read);
  const tieIds = tiebreakIds(found, "pokemon");
  if (tieIds.length >= 2) ties++;
  if (tieIds.length >= 2 && flag("tiebreak")) {
    const key = `${p.id}|${tieIds.join(",")}`;
    let answer = tieCache[key];
    if (!answer) {
      process.env.ANTHROPIC_API_KEY ??= devAnthropicKey();
      const b64 = fs.readFileSync(path.join(PHOTO_DIR, `${p.id}.jpg`)).toString("base64");
      const t = await tiebreakByPicture(b64, "image/jpeg", "pokemon", tieIds);
      // Opus rates ($ per million): input 5, output 25, cache read 0.5, cache write 6.25.
      tieSpent += (t.usage.inputTokens * 5 + t.usage.outputTokens * 25 + t.usage.cacheReadTokens * 0.5 + t.usage.cacheWriteTokens * 6.25) / 1e6;
      answer = { id: t.id ?? null, pick: t.pick ?? null, cancelled: t.reason === "catalog picture missing" };
      if (!answer.cancelled) {
        tieCache[key] = { id: answer.id, pick: answer.pick };
        fs.writeFileSync(TIE_CACHE_PATH, JSON.stringify(tieCache, null, 1));
      }
    }
    if (answer.cancelled) tieCancelled++; else if (answer.id === null) tieDeclined++;
    const at = answer.id && answer.id !== found[0].id ? found.findIndex((c) => c.id === answer.id) : -1;
    if (at > 0) found = [found[at], ...found.filter((_, i) => i !== at)];
  }
  const rank = found.findIndex((c) => c.id === p.want || (p.alt ?? []).includes(c.id));
  n++;
  if (read.secondLook) secondLooks++;
  if (rank === 0) hit++;
  if (rank > -1 && rank < 3) top3++;
  if (rank !== 0) {
    const w = wantRow.get(p.want);
    const top = found[0];
    misses.push({
      id: p.id, title: p.title ?? "",
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
console.log(`\nexact card on real phone photos${HIDE ? " (NUMBER HIDDEN)" : ""}: ${hit}/${n} = ${pct(hit)}%  (target ≥ 98%)   within one tap (top 3): ${top3}/${n} = ${pct(top3)}%   second looks: ${secondLooks}   spent this run ≈ $${spent.toFixed(2)}`);
if (flag("ties") || flag("tiebreak")) console.log(`near-ties (picture check would fire): ${ties}/${n}${flag("tiebreak") ? `   ${ties - tieDeclined - tieCancelled} answered, ${tieDeclined} kept the order, ${tieCancelled} cancelled (picture missing)   picture checks spent this run ≈ $${tieSpent.toFixed(2)}` : ""}`);
for (const m of misses) {
  console.log(`\n✗ ${m.id}${m.title ? `  "${m.title}"` : ""}\n  want ${m.want}\n  got ${m.got}${m.rank > 0 ? `  (right one at #${m.rank + 1})` : ""}\n  read ${m.read}`);
}
