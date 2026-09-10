// Magic phone batch (docs/MTG-IDENTIFICATION.md §3c): Chris's REAL phone
// photos, pulled from prod's card_photos (the seller photo saved with each
// ledger card), replayed through the scanner's own vision read and ranker.
// Truth = the catalog printing Chris kept (cards.catalog_card_id); score =
// exact printing id at the top. Target ≥ 90% — this is the gate the panel
// (catalog images) cannot give: glare, angle, hands, a real foil.
//
//   npm run mtg:phone                 # run (photos cached in backups/mtg-phone/, reads in scripts/mtg-phone.cache.json)
//   npm run mtg:phone -- --fresh      # re-read every photo after a prompt change
//   npm run mtg:phone -- --pull       # re-pull the photo list from prod (new scans)
//
// Prod credentials come from .env.migration.json (dbUrl/dbToken) or
// TURSO_DATABASE_URL/TURSO_AUTH_TOKEN, read-only queries only. Anthropic key
// from .env.vercel.local. Photos never leave backups/ (gitignored).
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@libsql/client";

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { searchMtgCardsLocal } = await import(at("lib/server/mtgCards.ts"));
const { mtgCuesOf } = await import(at("lib/mtgCues.ts"));
const { MTG_READ_SCHEMA } = await import(at("lib/server/vision.ts"));
const visionSrc = fs.readFileSync(path.join(root, "src/lib/server/vision.ts"), "utf8");
const VISION_MODEL = visionSrc.match(/VISION_MODEL = "([^"]+)"/)[1];
const SYSTEM_MTG = visionSrc.match(/const SYSTEM_MTG = `([\s\S]*?)`;/)[1];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : null; };
const PHOTO_DIR = path.join(root, "backups/mtg-phone");
const LIST_PATH = path.join(PHOTO_DIR, "batch.json");
const CACHE_PATH = path.join(root, "scripts/mtg-phone.cache.json");
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.vercel.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}

async function pull() {
  let url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    const c = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8"));
    url = c.dbUrl; authToken = c.dbToken;
  }
  const db = createClient({ url, authToken });
  const r = await db.execute(
    `SELECT c.id, c.card_name, c.set_name, c.card_number, c.catalog_card_id, c.condition, p.updated_at
       FROM card_photos p JOIN cards c ON c.id = p.card_id
      WHERE c.game = 'mtg' AND c.catalog_card_id IS NOT NULL
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
  console.log(`pulled ${batch.length} Magic phone photos → ${path.relative(root, PHOTO_DIR)}`);
  return batch;
}

let batch = flag("pull") || !fs.existsSync(LIST_PATH) ? await pull() : JSON.parse(fs.readFileSync(LIST_PATH, "utf8"));
if (opt("limit")) batch = batch.slice(0, Number(opt("limit")));
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
if (flag("fresh")) for (const p of batch) delete cache[p.id];
// Vision budget guard (09-10: one full uncached panel ≈ 1.1M input tokens on the
// prod API key — every uncached card is a ~5.5k-token Sonnet call). Above
// VISION_CALL_CAP uncached reads the run stops unless --yes is passed.
const VISION_CALL_CAP = 40;
const uncached = batch.filter((p) => !cache[p.id]).length;
console.log(`vision calls this run: ${uncached} uncached of ${batch.length} (≈${Math.round(uncached * 5.5)}k input tokens)`);
if (uncached > VISION_CALL_CAP && !flag("yes")) {
  console.error(`refusing ${uncached} vision calls without --yes (cap ${VISION_CALL_CAP}); use --limit N or --bucket to narrow`);
  process.exit(2);
}

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
async function readCard(b64) {
  const response = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: MTG_READ_SCHEMA } },
    system: SYSTEM_MTG,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: "Identify this card. The seller believes it is English, but trust the photo over that if they disagree." },
      ],
    }],
  });
  const text = response.content.find((b) => b.type === "text");
  return text ? JSON.parse(text.text) : null;
}

// Local mirror row for the printing Chris kept, so a miss prints what it should have said.
const { DatabaseSync } = await import("node:sqlite");
const mirror = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });
const wantRow = mirror.prepare("SELECT name, set_code, collector_number, finishes, frame_effects, promo_types FROM mtg_cards WHERE id = ?");

const misses = [];
const finishes = {};
let hit = 0, n = 0;
for (const p of batch) {
  let read = cache[p.id];
  if (!read) {
    const b64 = fs.readFileSync(path.join(PHOTO_DIR, `${p.id}.jpg`)).toString("base64");
    read = await readCard(b64);
    cache[p.id] = read;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  }
  const code = read.kind === "art" && read.setCode && !read.setCode.toUpperCase().startsWith("A") ? `A${read.setCode}` : read.setCode;
  let found = [];
  for (const candidate of [read.name, read.englishName].filter(Boolean)) {
    found = await searchMtgCardsLocal(candidate, read.cardNumber || null, code || null, 5, read.kind === "art" ? "full-art" : (read.artStyle ?? null), read.kind === "art", mtgCuesOf(read));
    if (found.length) break;
  }
  const top = found[0];
  n++;
  finishes[read.finish ?? "null"] = (finishes[read.finish ?? "null"] ?? 0) + 1;
  if (top?.id === p.want) hit++;
  else {
    const w = wantRow.get(p.want);
    misses.push({
      want: w ? `${w.name} [${w.set_code.toUpperCase()} ${w.collector_number}] ${w.frame_effects || "-"} / ${w.promo_types || "-"}` : `${p.name} [${p.set} ${p.number}] (not in local mirror)`,
      got: top ? `${top.name} [${top.setCode ?? ""} ${top.number}] ${top.id}` : "(nothing)",
      read: `name=${read.name} code=${read.setCode} number=${read.cardNumber} treatment=${read.treatment} marks=${(read.marks ?? []).join("+") || "-"} finish=${read.finish} artist=${read.artist} year=${read.copyrightYear} border=${read.borderColor}`,
      rank: found.findIndex((c) => c.id === p.want),
    });
  }
  process.stdout.write(`\r${n}/${batch.length}`);
}
process.stdout.write("\r");
console.log(`\nexact printing on real phone photos: ${hit}/${n} = ${n ? ((hit / n) * 100).toFixed(1) : 0}%  (target ≥ 90%)`);
console.log(`finish read: ${Object.entries(finishes).map(([k, v]) => `${k} ${v}`).join(", ")}  (not scored — the ledger keeps no finish)`);
for (const m of misses) {
  console.log(`\n✗ want ${m.want}\n  got  ${m.got}${m.rank > 0 ? `  (right one at #${m.rank + 1})` : ""}\n  read ${m.read}`);
}
