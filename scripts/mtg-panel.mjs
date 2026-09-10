// Magic phase 2 panel (docs/MTG-IDENTIFICATION.md): a FIXED set of printings
// from the local mirror covering every era row and treatment/mark, replayed
// through the scanner's own vision read (Scryfall "large" image, ~936px —
// the size that shows The List icon) and the scanner's own ranker. Score =
// exact printing id at the top. Target ≥ 95% on these clean images; every
// ranker change re-runs the panel — the Pokémon discipline.
//
//   npm run mtg:panel                 # run (reads cached in scripts/mtg-panel.cache.json)
//   npm run mtg:panel -- --pick       # (re)choose the panel → scripts/mtg-panel.json
//   npm run mtg:panel -- --bucket plst --limit 5 --fresh
//
// The chosen ids are committed (mtg-panel.json) so the number means the same
// thing next month. Reads the local mirror (data/cardflip.db, npm run
// sync:mtg first) and the Anthropic API from .env.vercel.local; writes only
// the two panel files. Finish cannot be judged from catalog images — the
// read's finish is printed, not scored; that is Chris's phone batch.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import Anthropic from "@anthropic-ai/sdk";

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
const PANEL_PATH = path.join(root, "scripts/mtg-panel.json");
const CACHE_PATH = path.join(root, "scripts/mtg-panel.cache.json");

const db = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });

// Every row of the era table + every treatment/mark the ranker has a cue for.
// Deterministic: ordered by id, so --pick gives the same panel from the same mirror.
const BUCKETS = [
  ["pre-1998", "set_release_date < '1998-01-01'", 24],
  ["1998-2014 number-only", "set_release_date >= '1998-01-01' AND set_release_date < '2014-07-18' AND set_code NOT IN ('plst','sld')", 30],
  ["M15 standard", "frame = '2015' AND frame_effects = '' AND promo_types = '' AND full_art = 0 AND border_color = 'black' AND set_release_date >= '2014-07-18' AND set_code NOT IN ('plst','sld')", 30],
  ["showcase", "frame_effects LIKE '%showcase%' AND set_code NOT IN ('plst','sld')", 15],
  ["extended art", "frame_effects LIKE '%extendedart%' AND set_code NOT IN ('plst','sld')", 15],
  ["borderless", "border_color = 'borderless' AND set_code NOT IN ('plst','sld')", 15],
  ["retro frame", "frame = '1997' AND set_release_date > '2015-01-01' AND set_code NOT IN ('plst','sld')", 10],
  ["The List (PLST)", "set_code = 'plst'", 15],
  ["Secret Lair (SLD)", "set_code = 'sld'", 10],
  ["promo pack", "promo_types LIKE '%promopack%'", 8],
  ["prerelease", "promo_types LIKE '%prerelease%'", 8],
  ["serialized", "promo_types LIKE '%serialized%'", 5],
  ["double-faced / split", "name LIKE '% // %' AND type_line NOT LIKE 'Card%' AND set_code NOT IN ('plst','sld')", 10],
  ["art series", "type_line LIKE 'Card%' AND set_code LIKE 'a%'", 5],
  ["textless", "textless = 1", 5],
];

function pickPanel() {
  const panel = [];
  for (const [bucket, where, n] of BUCKETS) {
    const rows = db
      .prepare(
        `SELECT id, name, set_code, collector_number, image_url FROM mtg_cards
          WHERE lang = 'en' AND image_url <> '' AND collector_number NOT LIKE '%★' AND (${where})
          ORDER BY id LIMIT ?`,
      )
      .all(n);
    for (const r of rows) panel.push({ bucket, id: r.id, name: r.name, set: r.set_code, number: r.collector_number, image: r.image_url });
  }
  fs.writeFileSync(PANEL_PATH, JSON.stringify(panel, null, 1));
  console.log(`panel: ${panel.length} printings → ${path.relative(root, PANEL_PATH)}`);
  return panel;
}

let panel = flag("pick") || !fs.existsSync(PANEL_PATH) ? pickPanel() : JSON.parse(fs.readFileSync(PANEL_PATH, "utf8"));
if (opt("bucket")) panel = panel.filter((p) => p.bucket.toLowerCase().includes(opt("bucket").toLowerCase()));
if (opt("limit")) panel = panel.slice(0, Number(opt("limit")));
// --fresh re-reads the selected cards (keep the rest of the cache).
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
if (flag("fresh")) for (const p of panel) delete cache[p.id];

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.vercel.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
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

// Scryfall "large" (~936px) is the closest catalog size to the 1568px phone upload.
const largeUrl = (u) => u.replace("/normal/", "/large/");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const byBucket = new Map();
const misses = [];
let n = 0;
for (const p of panel) {
  let read = cache[p.id];
  if (!read) {
    const res = await fetch(largeUrl(p.image), { headers: { "User-Agent": "CardFlip-panel/1.0", Accept: "image/jpeg" } });
    if (!res.ok) { console.log(`  !! ${p.name}: image ${res.status}`); continue; }
    read = await readCard(Buffer.from(await res.arrayBuffer()).toString("base64"));
    cache[p.id] = read;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
    await sleep(120);
  }
  // Same walk as the scanner (app/page.tsx → /api/search-card → searchMtgCardsLocal).
  const code = read.kind === "art" && read.setCode && !read.setCode.toUpperCase().startsWith("A") ? `A${read.setCode}` : read.setCode;
  let found = [];
  for (const candidate of [read.name, read.englishName].filter(Boolean)) {
    found = await searchMtgCardsLocal(candidate, read.cardNumber || null, code || null, 5, read.kind === "art" ? "full-art" : (read.artStyle ?? null), read.kind === "art", mtgCuesOf(read));
    if (found.length) break;
  }
  const top = found[0];
  const hit = top?.id === p.id;
  const tally = byBucket.get(p.bucket) ?? { hit: 0, n: 0 };
  tally.n++;
  if (hit) tally.hit++;
  byBucket.set(p.bucket, tally);
  n++;
  process.stdout.write(`\r${n}/${panel.length}`);
  if (!hit) {
    misses.push({
      bucket: p.bucket,
      want: `${p.name} [${p.set.toUpperCase()} ${p.number}] ${p.id}`,
      got: top ? `${top.name} [${top.setCode ?? ""} ${top.number}] ${top.id}` : "(nothing)",
      read: `name=${read.name} code=${read.setCode} number=${read.cardNumber} treatment=${read.treatment} marks=${(read.marks ?? []).join("+") || "-"} artist=${read.artist} year=${read.copyrightYear} border=${read.borderColor}`,
      rank: found.findIndex((c) => c.id === p.id),
    });
  }
}
process.stdout.write("\r");

let hit = 0, total = 0;
console.log("\nbucket                     hit / n");
for (const [bucket, t] of byBucket) {
  hit += t.hit; total += t.n;
  console.log(`${bucket.padEnd(26)} ${String(t.hit).padStart(3)} / ${t.n}${t.hit < t.n ? "   ◄" : ""}`);
}
console.log(`\nexact printing: ${hit}/${total} = ${total ? ((hit / total) * 100).toFixed(1) : 0}%  (target ≥ 95%)`);
for (const m of misses) {
  console.log(`\n✗ [${m.bucket}] want ${m.want}\n  got  ${m.got}${m.rank > 0 ? `  (right one at #${m.rank + 1})` : ""}\n  read ${m.read}`);
}
