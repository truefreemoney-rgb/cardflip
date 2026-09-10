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

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { searchEnglishCardsLocal } = await import(at("lib/server/enCards.ts"));
const { isSecretRareNumber } = await import(at("lib/cardNumber.ts"));
const { analyzeCardImageWithUsage, tiebreakByPicture } = await import(at("lib/server/vision.ts"));
const { isNearTie } = await import(at("lib/tiebreak.ts"));
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
if (opt("id")) panel = panel.filter((p) => opt("id").split(",").includes(p.id));
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
// The scanner's own read path — first look + second look (a crop of the
// bottom strip when the first read is unsettled), exactly what
// /api/vision/scan runs. The cache stores the merged read.
process.env.ANTHROPIC_API_KEY ||= env.ANTHROPIC_API_KEY;
async function readCard(b64, mediaType) {
  return (await analyzeCardImageWithUsage(b64, mediaType, "en", "pokemon")).read;
}

// TCGdex "high" (~600×825) is the closest catalog size to a 1024px phone
// upload; the 1st Edition twins carry TCGplayer scans (stamped) as they are.
// pokemontcg.io's plain PNG is a 245px thumbnail — no phone photo is that
// small — so the panel reads the _hires twin (~734px) of any such row.
const bigUrl = (u) =>
  u.replace("/low.webp", "/high.webp").replace(/(images\.pokemontcg\.io\/[^/]+\/[^/._]+)\.png$/, "$1_hires.png");
// TCGplayer product photos (trainer kits, some promos) are blurry 12 KB
// listings, not scans; a miss on one is reported apart from the clear-image score.
const isProductPhoto = (u) => u.includes("tcgplayer-cdn.tcgplayer.com");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The scanner's own walk (app/app/page.tsx): name candidates in order, the
// printed fraction from the read, exact-name early exit, then a number-only
// fallback when a full fraction was read.
async function lookup(read) {
  if (!read || (typeof read.confidence === "number" && read.confidence < UNREADABLE_CONFIDENCE)) return [];
  const printed = read.cardNumber
    ? { number: read.cardNumber, setTotal: read.setTotal, setCode: read.setCode, isSecretRare: isSecretRareNumber(read.cardNumber, read.setTotal), setName: read.setName, copyrightYear: read.copyrightYear ?? null }
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
let mirrorDupes = 0;
let wrongImages = 0;
// Panel rows whose catalog image is really another printing (checked by eye).
const CATALOG_IMAGE_IS = { "g1-28": "g1-28a" };
// Sniff, don't trust the URL: TCGplayer serves PNG bytes from ".jpg" paths.
const sniff = (bytes) => bytes.subarray(0, 4).toString("hex") === "89504e47" ? "image/png"
  : bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : "image/jpeg";
let tiebreaks = 0;
for (const p of panel) {
  let read = cache[p.id];
  let image = null; // { b64, mediaType } once fetched — the tiebreak needs it even on a cached read
  const fetchImage = async () => {
    const url = bigUrl(p.image);
    const res = await fetch(url, { headers: { "User-Agent": "CardFlip-panel/1.0", Accept: "image/webp,image/jpeg" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`image ${res.status} ${url}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    return { b64: bytes.toString("base64"), mediaType: sniff(bytes) };
  };
  if (!read) {
    try { image = await fetchImage(); } catch (err) { console.log(`  !! ${p.name}: ${err?.cause?.code ?? err?.message ?? err}`); continue; }
    try {
      read = await readCard(image.b64, image.mediaType);
    } catch (err) {
      console.log(`  !! ${p.name}: vision ${err?.message ?? err}`);
      continue;
    }
    cache[p.id] = read;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
    await sleep(120);
  }
  let found = await lookup(read);
  // Near-tie: the picture decides (Opus, ~3¢) — the same call the app makes.
  if (isNearTie(found) && !flag("no-tiebreak")) {
    try {
      image ??= await fetchImage();
      const t = await tiebreakByPicture(image.b64, image.mediaType, "pokemon", [found[0].id, found[1].id]);
      tiebreaks++;
      if (t.id === found[1].id) found = [found[1], found[0], ...found.slice(2)];
    } catch (err) {
      console.log(`  !! ${p.name}: tiebreak ${err?.message ?? err}`);
    }
  }
  // TCGdex's WotC-era scans are mostly 1st Edition copies (checked 09-10:
  // base1-7, base5-52 both stamped), so when the read saw the stamp the twin
  // IS the right answer for that image — count it, and keep the tally so the
  // catalog-art issue (unlimited rows showing a stamped scan) stays visible.
  let rank = found.findIndex((c) => c.id === p.id);
  if (rank !== 0 && read?.firstEdition === true && found[0]?.id === `${p.id}-1st`) { rank = 0; stampedScans++; }
  // Catalog faults, not scanner faults — counted separately so they stay
  // visible: (a) the mirror holds the same printing twice (Trainer Gallery
  // sets exist as swsh9tg AND swsh9.5tg) and (b) the catalog image is a
  // different printing (g1-28's TCGdex scan is 28a).
  const top = found[0];
  if (rank !== 0 && top && top.name === p.name && top.number === p.number && top.setName === p.setName) { rank = 0; mirrorDupes++; }
  if (rank !== 0 && top && CATALOG_IMAGE_IS[p.id] === top.id) { rank = 0; wrongImages++; }
  const hit = rank === 0;
  const tally = byBucket.get(p.bucket) ?? { hit: 0, top3: 0, n: 0, blurry: 0 };
  tally.n++;
  if (hit) tally.hit++;
  if (rank > -1 && rank < 3) tally.top3++;
  if (!hit && isProductPhoto(p.image)) tally.blurry++;
  byBucket.set(p.bucket, tally);
  n++;
  process.stdout.write(`\r${n}/${panel.length}`);
  if (!hit) {
    const top = found[0];
    misses.push({
      bucket: p.bucket,
      want: `${p.name} ${p.number}/${p.official ?? "?"} [${p.set}${p.code ? " " + p.code : ""}] ${p.id}`,
      got: top ? `${top.name} ${top.number} [${top.setName}] ${top.id}` : "(nothing)",
      read: `name=${read?.name} number=${read?.cardNumber} total=${read?.setTotal} code=${read?.setCode} set=${read?.setName} year=${read?.copyrightYear} art=${read?.artStyle} 1st=${read?.firstEdition} conf=${read?.confidence} 2nd=${read?.secondLook ?? "-"}`,
      rank,
    });
  }
}
process.stdout.write("\r");

let hit = 0, top3 = 0, total = 0, blurry = 0;
console.log("\nbucket                              top1 / top3 / n");
for (const [bucket, t] of byBucket) {
  hit += t.hit; top3 += t.top3; total += t.n; blurry += t.blurry;
  console.log(`${bucket.padEnd(35)} ${String(t.hit).padStart(3)} / ${String(t.top3).padStart(3)} / ${t.n}${t.hit < t.n ? "   ◄" : ""}${t.blurry ? `  (${t.blurry} blurry product photo)` : ""}`);
}
const pct = (a, of = total) => (of ? ((a / of) * 100).toFixed(1) : "0");
console.log(`\nexact printing first: ${hit}/${total} = ${pct(hit)}%  (target ≥ 98%)   within one tap (top 3): ${top3}/${total} = ${pct(top3)}%`);
if (blurry) console.log(`clear images only (${blurry} misses on blurry TCGplayer product photos set aside): ${hit}/${total - blurry} = ${pct(hit, total - blurry)}%`);
if (stampedScans) console.log(`(${stampedScans} unlimited rows whose catalog scan is a stamped 1st Edition copy — counted as hits on the twin)`);
if (mirrorDupes) console.log(`(${mirrorDupes} hits on a duplicate mirror row of the same printing — catalog dedupe needed)`);
if (tiebreaks) console.log(`(${tiebreaks} near-ties sent to the picture tiebreak — Opus, ~3¢ each; --no-tiebreak skips them)`);
if (wrongImages) console.log(`(${wrongImages} hits where the catalog image is another printing — catalog art needed)`);
for (const m of misses) {
  console.log(`\n✗ [${m.bucket}] want ${m.want}\n  got  ${m.got}${m.rank > 0 ? `  (right one at #${m.rank + 1})` : ""}\n  read ${m.read}`);
}
