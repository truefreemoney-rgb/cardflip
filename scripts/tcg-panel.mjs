// Lorcana / One Piece identification panel (09-10, docs/NEW-GAMES.md): a
// FIXED set of printings from the shared tcg_cards mirror, replayed through
// the scanner's own read (first look + second look) and the scanner's own
// lookup (searchTcgCardsLocal) with the picture tiebreak on near-ties.
// Score = exact printing id at the top; "one tap" = within the first 3.
// Target ≥ 98% on these clean catalog images, same as the other two games.
//
//   npm run tcg:panel -- --game lorcana            # run (reads cached in scripts/tcg-panel.<game>.cache.json)
//   npm run tcg:panel -- --game onepiece --pick    # (re)choose the panel → scripts/tcg-panel.<game>.json
//   npm run tcg:panel -- --game lorcana --bucket enchanted --fresh --yes
//
// COST: one uncached card ≈ 5.5k Sonnet input tokens (+ a second look on
// unsure reads, + ~3¢ Opus on a near-tie). Refuses > 40 uncached calls
// without --yes. Lorcast images are AVIF — converted to JPEG here.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { searchTcgCardsLocal, splitOnePieceNumber } = await import(at("lib/server/tcgCards.ts"));
const { analyzeCardImageWithUsage, tiebreakByPicture, toClaudeImage } = await import(at("lib/server/vision.ts"));
const { isNearTie } = await import(at("lib/tiebreak.ts"));
const { UNREADABLE_CONFIDENCE } = await import(at("lib/types.ts"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : null; };
const game = opt("game");
if (game !== "lorcana" && game !== "onepiece") { console.error("--game lorcana | onepiece"); process.exit(2); }
const PANEL_PATH = path.join(root, `scripts/tcg-panel.${game}.json`);
const CACHE_PATH = path.join(root, `scripts/tcg-panel.${game}.cache.json`);
const VISION_CALL_CAP = 40;

const db = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });

// Spread across sets (one card per set first), ordered by a fixed hash so
// --pick is deterministic. Every printing kind the ranker has a rule for.
const HASH = "((CAST(REPLACE(REPLACE(collector_number, 'OP', ''), '-', '') AS INTEGER) + length(set_code) * 7 + unicode(substr(id, -1)) * 13) * 7919) % 97";
const BUCKETS = {
  lorcana: [
    ["standard", "variant = '' AND rarity NOT IN ('Enchanted')", 60],
    ["enchanted", "variant = 'enchanted'", 20],
    ["special / promo", "variant = 'special' OR set_code GLOB '[A-Za-z]*'", 15],
    ["same name, different version", "variant = '' AND name IN (SELECT name FROM tcg_cards WHERE game = 'lorcana' GROUP BY name HAVING COUNT(DISTINCT subtitle) > 1)", 30],
    ["same name+version, different set (reprint)", "variant = '' AND (name, subtitle) IN (SELECT name, subtitle FROM tcg_cards WHERE game = 'lorcana' AND variant = '' GROUP BY name, subtitle HAVING COUNT(DISTINCT set_code) > 1)", 20],
  ],
  onepiece: [
    ["standard booster", "variant = '' AND set_code GLOB 'OP*'", 50],
    ["starter deck", "variant = '' AND set_code GLOB 'ST*'", 15],
    ["extra / premium booster", "variant = '' AND (set_code GLOB 'EB*' OR set_code GLOB 'PRB*')", 10],
    ["parallel / alt art", "variant IN ('parallel', 'alt-art')", 30],
    ["manga / special / full art", "variant IN ('manga', 'special', 'full-art', 'box-topper')", 15],
    ["reprint (same id, later set)", "variant = 'reprint'", 10],
    ["same name, different id", "variant = '' AND name IN (SELECT name FROM tcg_cards WHERE game = 'onepiece' AND variant = '' GROUP BY name HAVING COUNT(DISTINCT collector_number) > 1)", 20],
  ],
};

function pickPanel() {
  const panel = [];
  for (const [bucket, where, n] of BUCKETS[game]) {
    const rows = db
      .prepare(
        `WITH pool AS (
           SELECT id, name, subtitle, set_code, set_name, collector_number, set_total, variant, image_url,
                  ROW_NUMBER() OVER (PARTITION BY set_code ORDER BY ${HASH}, id) AS rn
             FROM tcg_cards WHERE game = ? AND image_url <> '' AND (${where}))
         SELECT * FROM pool ORDER BY rn, ${HASH}, id LIMIT ?`,
      )
      .all(game, n);
    for (const r of rows) panel.push({ bucket, id: r.id, name: r.name, subtitle: r.subtitle, set: r.set_code, setName: r.set_name, number: r.collector_number, total: r.set_total, variant: r.variant, image: r.image_url });
  }
  fs.writeFileSync(PANEL_PATH, JSON.stringify(panel, null, 1));
  console.log(`panel: ${panel.length} printings → ${path.relative(root, PANEL_PATH)}`);
  return panel;
}

let panel = flag("pick") || !fs.existsSync(PANEL_PATH) ? pickPanel() : JSON.parse(fs.readFileSync(PANEL_PATH, "utf8"));
if (opt("bucket")) panel = panel.filter((p) => p.bucket.toLowerCase().includes(opt("bucket").toLowerCase()));
if (opt("id")) panel = panel.filter((p) => opt("id").split(",").includes(p.id));
if (opt("limit")) panel = panel.slice(0, Number(opt("limit")));
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
process.env.ANTHROPIC_API_KEY ||= env.ANTHROPIC_API_KEY;

// The scanner's walk (app/app/page.tsx → searchCards → /api/search-card).
async function lookup(read) {
  if (!read || (typeof read.confidence === "number" && read.confidence < UNREADABLE_CONFIDENCE)) return [];
  let printed = read.cardNumber ? { number: read.cardNumber, setTotal: read.setTotal, setCode: read.setCode, isSecretRare: false } : null;
  if (game === "onepiece" && printed) {
    const s = splitOnePieceNumber(printed.number);
    if (s.setCode) printed = { ...printed, number: s.number, setCode: s.setCode };
  }
  let matches = [];
  for (const candidate of [read.name, read.englishName].filter(Boolean)) {
    const found = await searchTcgCardsLocal(game, candidate, printed, 5, read.subtitle ?? null, read.variant ?? null);
    if (found.length === 0) continue;
    if (matches.length === 0) matches = found;
    if (found[0].name.split(" - ")[0].trim().toLowerCase() === candidate.trim().toLowerCase()) { matches = found; break; }
  }
  if (matches.length === 0 && printed) matches = await searchTcgCardsLocal(game, "", printed, 5, read.subtitle ?? null, read.variant ?? null);
  return matches;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byBucket = new Map();
const misses = [];
let n = 0, tiebreaks = 0;
for (const p of panel) {
  let read = cache[p.id];
  let image = null;
  const fetchImage = async () => {
    const res = await fetch(p.image, { headers: { "User-Agent": "CardFlip-panel/1.0" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`image ${res.status} ${p.image}`);
    return toClaudeImage(Buffer.from(await res.arrayBuffer()));
  };
  if (!read) {
    try { image = await fetchImage(); } catch (err) { console.log(`  !! ${p.name}: ${err?.message ?? err}`); continue; }
    try {
      read = (await analyzeCardImageWithUsage(image.base64, image.mediaType, "en", game)).read;
    } catch (err) {
      console.log(`  !! ${p.name}: vision ${err?.message ?? err}`);
      continue;
    }
    cache[p.id] = read;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
    await sleep(120);
  }
  let found = await lookup(read);
  if (isNearTie(found) && !flag("no-tiebreak")) {
    try {
      image ??= await fetchImage();
      const t = await tiebreakByPicture(image.base64, image.mediaType, game, [found[0].id, found[1].id]);
      tiebreaks++;
      if (t.id === found[1].id) found = [found[1], found[0], ...found.slice(2)];
    } catch (err) {
      console.log(`  !! ${p.name}: tiebreak ${err?.message ?? err}`);
    }
  }
  // A starter-deck reprint shares the base printing's face exactly (same
  // number, same art, no mark) — either twin at the top is the right answer.
  const plain = (v) => !v || v === "reprint";
  const sameFace = (c) => c.id === p.id || (game === "onepiece" && plain(p.variant) && plain(c.variant) && String(c.number ?? c.collector_number).replace(/_[rp]\d+$/i, "") === String(p.number).replace(/_[rp]\d+$/i, "") && clean(c.name) === clean(p.name));
  function clean(n) { return String(n).replace(/\s+-\s+[A-Z]+\d*-\d+[a-z0-9_#]*$/i, ""); }
  const rank = found.findIndex(sameFace);
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
      want: `${p.name}${p.subtitle ? " - " + p.subtitle : ""} ${p.number}${p.total ? "/" + p.total : ""} [${p.set}] ${p.variant || "base"} ${p.id}`,
      got: top ? `${top.name} ${top.number} [${top.setCode}] ${top.variant || "base"} ${top.id}` : "(nothing)",
      read: `name=${read?.name} sub=${read?.subtitle} number=${read?.cardNumber} total=${read?.setTotal} code=${read?.setCode} variant=${read?.variant} year=${read?.copyrightYear} conf=${read?.confidence} 2nd=${read?.secondLook ?? "-"}`,
      rank,
    });
  }
}
process.stdout.write("\r");

let hit = 0, top3 = 0, total = 0;
console.log("\nbucket                                        top1 / top3 / n");
for (const [bucket, t] of byBucket) {
  hit += t.hit; top3 += t.top3; total += t.n;
  console.log(`${bucket.padEnd(45)} ${String(t.hit).padStart(3)} / ${String(t.top3).padStart(3)} / ${t.n}${t.hit < t.n ? "   ◄" : ""}`);
}
const pct = (a) => (total ? ((a / total) * 100).toFixed(1) : "0");
console.log(`\n${game}: exact printing first: ${hit}/${total} = ${pct(hit)}%  (target ≥ 98%)   within one tap (top 3): ${top3}/${total} = ${pct(top3)}%`);
if (tiebreaks) console.log(`(${tiebreaks} near-ties sent to the picture tiebreak — Opus, ~3¢ each; --no-tiebreak skips them)`);
for (const m of misses) {
  console.log(`\n✗ [${m.bucket}] want ${m.want}\n  got  ${m.got}${m.rank > 0 ? `  (right one at #${m.rank + 1})` : ""}\n  read ${m.read}`);
}
