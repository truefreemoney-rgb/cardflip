// Pokémon identification panel (Chris 09-10: "needs to be 98%" on a clear
// photo): a FIXED set of ~210 printings from the local mirror, spread over
// every era and every numbering trick, replayed through the scanner's own
// vision read (TCGdex "high" image, ~600×825 — about what a 1024px phone
// upload lands at) and the scanner's own lookup walk (app/page.tsx →
// /api/search-card → searchEnglishCardsLocal). Score = exact printing id at
// the top; "one tap" = right card within the first 3. Target ≥ 98% top-1 on
// these clean images. Same discipline as scripts/mtg-panel.mjs.
//
//   npm run pokemon:panel                # run (reads cached in scripts/pokemon-panel.cache.json)
//   npm run pokemon:panel -- --pick      # (re)choose the panel → scripts/pokemon-panel.json
//   npm run pokemon:panel -- --bucket promo --limit 5 --fresh --yes
//
// COST: every uncached card is one Sonnet vision call (~5.5k input tokens);
// a full fresh panel ≈ 1.1M tokens ≈ $2.20. The run prints the count and
// refuses more than VISION_CALL_CAP uncached calls without --yes — say the
// number to Chris before passing it. The chosen ids are committed
// (pokemon-panel.json) so the number means the same thing next month. Reads
// the local mirror (data/cardflip.db, npm run sync:en first) and the
// Anthropic API key from .env.vercel.local; writes only the two panel files.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import Anthropic from "@anthropic-ai/sdk";

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { searchEnglishCardsLocal } = await import(at("lib/server/enCards.ts"));
const { isSecretRareNumber } = await import(at("lib/cardNumber.ts"));
const { CARD_READ_SCHEMA, SYSTEM, VISION_MODEL } = await import(at("lib/server/vision.ts"));
const { UNREADABLE_CONFIDENCE } = await import(at("lib/types.ts"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : null; };
const PANEL_PATH = path.join(root, "scripts/pokemon-panel.json");
const CACHE_PATH = path.join(root, "scripts/pokemon-panel.cache.json");
const VISION_CALL_CAP = 40;

const db = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });

// Every era + every numbering trick the lookup has a rule for. Each bucket
// is spread across its sets (one card per set first, then a second…) and
// ordered by a fixed hash of the number, so --pick is deterministic and not
// "the first 25 cards of Base Set".
const PLAIN = "id NOT LIKE '%-1st' AND set_id NOT LIKE '%p' AND set_id NOT LIKE 'tk-%' AND set_id NOT LIKE 'mc%'";
const NUMERIC = "local_id GLOB '[0-9]*' AND local_id NOT GLOB '*[A-Za-z]*'";
const STANDARD_NUMBERED = `${NUMERIC} AND CAST(local_id AS INTEGER) <= set_card_count_official`;
const PROMO_SETS = "('basep','np','dpp','hgssp','bwp','xyp','smp','swshp','svp','mep')";
const BUCKETS = [
  ["WotC 1999-2002", `${PLAIN} AND set_release_date < '2003-01-01'`, 25],
  ["1st Edition twins", "id LIKE '%-1st'", 10],
  ["EX era 2003-2007", `${PLAIN} AND set_release_date >= '2003-01-01' AND set_release_date < '2007-06-01'`, 15],
  ["DP / HGSS 2007-2011", `${PLAIN} AND set_release_date >= '2007-06-01' AND set_release_date < '2011-04-01'`, 15],
  ["BW / XY 2011-2016", `${PLAIN} AND set_release_date >= '2011-04-01' AND set_release_date < '2017-02-01'`, 15],
  ["SM standard", `${PLAIN} AND ${STANDARD_NUMBERED} AND set_release_date >= '2017-02-01' AND set_release_date < '2020-02-01'`, 15],
  ["SWSH standard", `${PLAIN} AND ${STANDARD_NUMBERED} AND set_release_date >= '2020-02-01' AND set_release_date < '2023-03-01'`, 15],
  ["SV / ME standard", `${PLAIN} AND ${STANDARD_NUMBERED} AND set_release_date >= '2023-03-01'`, 20],
  ["secret / illustration rare", `${PLAIN} AND ${NUMERIC} AND CAST(local_id AS INTEGER) > set_card_count_official AND set_release_date >= '2017-02-01'`, 25],
  ["promo (no denominator)", `set_id IN ${PROMO_SETS}`, 20],
  ["lettered number (TG/GG/SV/RC/SH)", `${PLAIN} AND local_id GLOB '[A-Z][A-Z]*[0-9]'`, 12],
  ["same name+number, different set", `${PLAIN} AND (name, local_id, set_card_count_official) IN (SELECT name, local_id, set_card_count_official FROM en_cards WHERE ${PLAIN} GROUP BY name, local_id, set_card_count_official HAVING COUNT(*) > 1)`, 15],
  ["energy", `${PLAIN} AND name LIKE '% Energy'`, 6],
  ["McDonald's / trainer kit", "(set_id LIKE 'mc%' OR set_id LIKE 'tk-%')", 5],
];

function pickPanel() {
  const panel = [];
  for (const [bucket, where, n] of BUCKETS) {
    const rows = db
      .prepare(
        `WITH pool AS (
           SELECT id, name, set_id, set_name, local_id, set_code, set_card_count_official AS official, image_url,
                  ROW_NUMBER() OVER (PARTITION BY set_id ORDER BY ((CAST(local_id AS INTEGER) + unicode(substr(set_id, -1)) * 13 + length(set_id) * 7) * 7919) % 97, id) AS rn
             FROM en_cards
            WHERE image_url <> '' AND (${where}))
         SELECT * FROM pool ORDER BY rn, ((CAST(local_id AS INTEGER) + unicode(substr(set_id, -1)) * 13 + length(set_id) * 7) * 7919) % 97, id LIMIT ?`,
      )
      .all(n);
    for (const r of rows) panel.push({ bucket, id: r.id, name: r.name, set: r.set_id, setName: r.set_name, number: r.local_id, code: r.set_code, official: r.official, image: r.image_url });
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

const uncached = panel.filter((p) => !cache[p.id]).length;
console.log(`vision calls this run: ${uncached} uncached of ${panel.length} (≈${Math.round(uncached * 5.5)}k input tokens ≈ $${(uncached * 5.5 * 2 / 1000).toFixed(2)})`);
if (uncached > VISION_CALL_CAP && !flag("yes")) {
  console.error(`refusing ${uncached} vision calls without --yes (cap ${VISION_CALL_CAP}); use --limit N or --bucket to narrow`);
  process.exit(2);
}

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.vercel.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

async function readCard(b64, mediaType) {
  const response = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: CARD_READ_SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
        { type: "text", text: "Identify this card. The seller believes it is English, but trust the photo over that if they disagree." },
      ],
    }],
  });
  const text = response.content.find((b) => b.type === "text");
  return text ? JSON.parse(text.text) : null;
}

// TCGdex "high" (~600×825) is the closest catalog size to a 1024px phone
// upload; the 1st Edition twins carry TCGplayer scans (stamped) as they are.
const bigUrl = (u) => u.replace("/low.webp", "/high.webp");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The scanner's own walk (app/app/page.tsx): name candidates in order, the
// printed fraction from the read, exact-name early exit, then a number-only
// fallback when a full fraction was read.
async function lookup(read) {
  if (!read || (typeof read.confidence === "number" && read.confidence < UNREADABLE_CONFIDENCE)) return [];
  const printed = read.cardNumber
    ? { number: read.cardNumber, setTotal: read.setTotal, setCode: read.setCode, isSecretRare: isSecretRareNumber(read.cardNumber, read.setTotal) }
    : null;
  const art = read.artStyle ?? null;
  const first = read.firstEdition ?? null;
  let matches = [];
  for (const candidate of [read.name, read.englishName].filter(Boolean)) {
    const found = (await searchEnglishCardsLocal(candidate, printed, 5, art, first)).cards;
    if (found.length === 0) continue;
    if (matches.length === 0) matches = found;
    if (found[0].name.trim().toLowerCase() === candidate.trim().toLowerCase()) { matches = found; break; }
  }
  if (matches.length === 0 && printed?.setTotal) matches = (await searchEnglishCardsLocal("", printed, 5, null, first)).cards;
  return matches;
}

const byBucket = new Map();
const misses = [];
let n = 0;
let stampedScans = 0;
for (const p of panel) {
  let read = cache[p.id];
  if (!read) {
    const url = bigUrl(p.image);
    const res = await fetch(url, { headers: { "User-Agent": "CardFlip-panel/1.0", Accept: "image/webp,image/jpeg" } });
    if (!res.ok) { console.log(`  !! ${p.name}: image ${res.status} ${url}`); continue; }
    const bytes = Buffer.from(await res.arrayBuffer());
    // Sniff, don't trust the URL: TCGplayer serves PNG bytes from ".jpg" paths.
    const mediaType = bytes.subarray(0, 4).toString("hex") === "89504e47" ? "image/png"
      : bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : "image/jpeg";
    try {
      read = await readCard(bytes.toString("base64"), mediaType);
    } catch (err) {
      console.log(`  !! ${p.name}: vision ${err?.message ?? err}`);
      continue;
    }
    cache[p.id] = read;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
    await sleep(120);
  }
  const found = await lookup(read);
  // TCGdex's WotC-era scans are mostly 1st Edition copies (checked 09-10:
  // base1-7, base5-52 both stamped), so when the read saw the stamp the twin
  // IS the right answer for that image — count it, and keep the tally so the
  // catalog-art issue (unlimited rows showing a stamped scan) stays visible.
  let rank = found.findIndex((c) => c.id === p.id);
  if (rank !== 0 && read?.firstEdition === true && found[0]?.id === `${p.id}-1st`) { rank = 0; stampedScans++; }
  const hit = rank === 0;
  const tally = byBucket.get(p.bucket) ?? { hit: 0, top3: 0, n: 0 };
  tally.n++;
  if (hit) tally.hit++;
  if (rank > -1 && rank < 3) tally.top3++;
  byBucket.set(p.bucket, tally);
  n++;
  process.stdout.write(`\r${n}/${panel.length}`);
  if (!hit) {
    const top = found[0];
    misses.push({
      bucket: p.bucket,
      want: `${p.name} ${p.number}/${p.official ?? "?"} [${p.set}${p.code ? " " + p.code : ""}] ${p.id}`,
      got: top ? `${top.name} ${top.number} [${top.setName}] ${top.id}` : "(nothing)",
      read: `name=${read?.name} number=${read?.cardNumber} total=${read?.setTotal} code=${read?.setCode} art=${read?.artStyle} 1st=${read?.firstEdition} conf=${read?.confidence}`,
      rank,
    });
  }
}
process.stdout.write("\r");

let hit = 0, top3 = 0, total = 0;
console.log("\nbucket                              top1 / top3 / n");
for (const [bucket, t] of byBucket) {
  hit += t.hit; top3 += t.top3; total += t.n;
  console.log(`${bucket.padEnd(35)} ${String(t.hit).padStart(3)} / ${String(t.top3).padStart(3)} / ${t.n}${t.hit < t.n ? "   ◄" : ""}`);
}
const pct = (a) => (total ? ((a / total) * 100).toFixed(1) : "0");
console.log(`\nexact printing first: ${hit}/${total} = ${pct(hit)}%  (target ≥ 98%)   within one tap (top 3): ${top3}/${total} = ${pct(top3)}%`);
if (stampedScans) console.log(`(${stampedScans} unlimited rows whose catalog scan is a stamped 1st Edition copy — counted as hits on the twin)`);
for (const m of misses) {
  console.log(`\n✗ [${m.bucket}] want ${m.want}\n  got  ${m.got}${m.rank > 0 ? `  (right one at #${m.rank + 1})` : ""}\n  read ${m.read}`);
}
