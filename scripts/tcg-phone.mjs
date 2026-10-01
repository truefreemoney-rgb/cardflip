// TCG "phone" batch (09-10): Chris owns no One Piece or Lorcana cards, so
// the real-photo gate uses eBay seller photos instead — a listing whose
// title carries the card number ("Sugar OP04-024 Parallel", "Elsa - Spirit
// of Winter 41/204") is a labeled, hand-held, glare-and-sleeve photo of that
// card. Replayed through the scanner's own vision read + ranker (the same
// walk as tcg-panel.mjs).
//
// Truth is card-level: One Piece = name + number; Lorcana = name + version
// + number/total. Seller titles are reliable for those, unreliable for the
// printing (a "parallel" in the title may be missing or wrong), so the
// exact-printing rate is printed, not scored.
//
//   npm run op:phone                      # One Piece (backups/onepiece-phone/, scripts/onepiece-phone.cache.json)
//   npm run lorcana:phone                 # Lorcana  (backups/lorcana-phone/,  scripts/lorcana-phone.cache.json)
//   ... -- --pull        # re-pull listings from eBay Browse (needs real EBAY_CLIENT_ID/SECRET in .env.vercel.local;
//                        # the Vercel pull redacts them — 09-10 the batch was built by driving the in-app browser
//                        # through eBay search pages instead, see docs/STATE.md)
//   ... -- --fresh       # re-read every photo after a prompt change
//   ... -- --size 60     # printings to sample when pulling (default 60)
//
// Anthropic key + eBay app keys from .env.vercel.local. Photos never leave
// backups/ (gitignored). The batch list (backups/<game>-phone/batch.json)
// rows: { id, bucket, name, subtitle?, number, total?, want, wantVariant, title, listing }.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { devAnthropicKey } from "./lib/dev-key.mjs";

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { searchTcgCardsLocal, splitOnePieceNumber, yugiohKey } = await import(at("lib/server/tcgCards.ts"));
const { analyzeCardImageWithUsage, tiebreakByPicture, toClaudeImage } = await import(at("lib/server/vision.ts"));
const { tiebreakIds } = await import(at("lib/tiebreak.ts"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : null; };
const game = opt("game") ?? "onepiece";
// Yu-Gi-Oh! (09-29): no --pull; the batch was scraped from eBay search pages
// in the browser pane (backups/yugioh-phone/raw.json → batch.json rows
// { id, name, number, wantRarity, first, title, listing }). Exact printing =
// the rarity the title names.
if (game !== "onepiece" && game !== "lorcana" && game !== "yugioh") { console.error("--game onepiece | lorcana | yugioh"); process.exit(2); }
const PHOTO_DIR = path.join(root, `backups/${game}-phone`);
const LIST_PATH = path.join(PHOTO_DIR, "batch.json");
const CACHE_PATH = path.join(root, `scripts/${game}-phone.cache.json`);
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.vercel.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
process.env.ANTHROPIC_API_KEY = devAnthropicKey(); // testing-workspace key only, never prod (scripts/lib/dev-key.mjs)

const mirror = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });
const baseNumber = (n) => String(n).replace(/_[rp]\d+$/i, "").toUpperCase();
const cleanName = (n) => String(n).replace(/\s+-\s+[A-Z]+\d*-\d+[a-z0-9_#]*$/i, "").trim();
const fold = (s) => String(s ?? "").toLowerCase().replace(/[‘’‛′`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

// ---- pull: sample printings, find one eBay listing each, save its photo ----
async function ebayToken() {
  const cid = env.EBAY_CLIENT_ID, sec = env.EBAY_CLIENT_SECRET;
  if (!cid || !sec || cid.includes("SENSITIVE")) throw new Error("real EBAY_CLIENT_ID / EBAY_CLIENT_SECRET missing from .env.vercel.local (Vercel redacts them)");
  const tok = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${cid}:${sec}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`eBay token: ${JSON.stringify(tok)}`);
  return tok.access_token;
}

// Seeded shuffle so --pull is repeatable.
function shuffled(rows, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const a = rows.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Sampling buckets per game: [bucket, SQL where, share]. */
const BUCKETS = {
  onepiece: [
    ["base", "variant = ''", 0.5],
    ["alt", "variant IN ('parallel','alt-art','special','manga','full-art')", 0.35],
    ["reprint", "variant = 'reprint'", 0.15],
  ],
  lorcana: [
    ["base", "variant = '' AND set_code GLOB '[0-9]*'", 0.7],
    ["enchanted", "variant = 'enchanted' AND set_code GLOB '[0-9]*'", 0.3],
  ],
};

/** Everything the eBay title must and must not say for this row. */
function titleRules(r, bucket) {
  const name = cleanName(r.name);
  if (game === "onepiece") {
    const number = baseNumber(r.collector_number);
    const isAlt = bucket === "alt";
    return {
      q: `one piece ${name} ${number}${isAlt ? " parallel" : ""}`,
      must: [new RegExp(number.replace("-", "[- ]?"), "i"), new RegExp(name.split(/[\s."]+/)[0], "i")],
      variantRe: /parallel|alt[- ]?art|manga|\bsp\b|special/i,
      wantVariantWord: isAlt,
    };
  }
  const isEnch = bucket === "enchanted";
  return {
    q: `lorcana ${name} ${r.subtitle} ${r.collector_number}/${r.set_total}${isEnch ? " enchanted" : ""}`,
    must: [new RegExp(`\\b${r.collector_number}\\s*/\\s*${r.set_total}\\b`), new RegExp(name.split(/[\s.&]+/)[0], "i")],
    variantRe: /enchanted/i,
    wantVariantWord: isEnch,
  };
}
const BAD_TITLE = /\blot\b|bundle|playset|\bx[2-9]\b|[2-9]x\b|set of|proxy|custom|sleeve only|deck box|psa|bgs|cgc|graded|japanese|\bjpn?\b|japan|korean|chinese|german|french|italian|spanish/i;

async function pull() {
  const size = Number(opt("size") ?? 60);
  const token = await ebayToken();
  const batch = [];
  const seen = new Set();
  for (const [bucket, where, share] of BUCKETS[game]) {
    const n = Math.round(size * share);
    const rows = shuffled(mirror.prepare(`SELECT id, name, subtitle, set_code, collector_number, set_total, variant, price_usd FROM tcg_cards WHERE game = ? AND image_url <> '' AND COALESCE(price_usd, price_usd_foil) >= ${game === "lorcana" ? 3 : 1} AND (${where}) ORDER BY id`).all(game), 7 + bucket.length);
    let got = 0;
    for (const r of rows) {
      if (got >= n) break;
      const key = game === "onepiece" ? baseNumber(r.collector_number) : `${r.set_code}-${r.collector_number}`;
      if (seen.has(key)) continue;
      const rules = titleRules(r, bucket);
      const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
      url.searchParams.set("q", rules.q);
      url.searchParams.set("limit", "20");
      url.searchParams.set("category_ids", "183454"); // CCG Individual Cards
      let items = [];
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } });
        if (res.status === 429) { console.log("  eBay 429, stopping pull"); break; }
        items = (await res.json()).itemSummaries ?? [];
      } catch (err) { console.log(`  ${r.name}: ${err?.message ?? err}`); continue; }
      const pick = items.find((it) => {
        const t = String(it.title ?? "");
        if (!rules.must.every((re) => re.test(t)) || BAD_TITLE.test(t)) return false;
        return rules.variantRe.test(t) === rules.wantVariantWord;
      });
      const img = pick?.image?.imageUrl;
      if (!pick || !img) continue;
      const id = `${bucket}-${key}`;
      const file = path.join(PHOTO_DIR, `${id}.jpg`);
      try {
        const res = await fetch(img.replace(/s-l\d+\./, "s-l1600."), { headers: { "User-Agent": "CardFlip-phone/1.0" }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`image ${res.status}`);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      } catch (err) { console.log(`  ${r.name}: ${err?.message ?? err}`); continue; }
      batch.push({ id, bucket, name: cleanName(r.name), subtitle: r.subtitle || "", number: game === "onepiece" ? baseNumber(r.collector_number) : r.collector_number, total: r.set_total, want: r.id, wantVariant: r.variant, title: pick.title, listing: pick.itemWebUrl ?? "" });
      seen.add(key);
      got++;
      process.stdout.write(`\r${batch.length} listings`);
      await new Promise((res) => setTimeout(res, 150));
    }
  }
  process.stdout.write("\r");
  fs.writeFileSync(LIST_PATH, JSON.stringify(batch, null, 1));
  console.log(`pulled ${batch.length} ${game} seller photos → ${path.relative(root, PHOTO_DIR)}`);
  return batch;
}

let batch = flag("pull") || !fs.existsSync(LIST_PATH) ? await pull() : JSON.parse(fs.readFileSync(LIST_PATH, "utf8"));
// One Piece DON!! photos (bucket "don", 10-01): no number and no name on the
// card, the read cannot pin one of ~190 (2 of 10) and the scanner sends them
// to Check match by design. They are scored only with --don or --id.
if (!flag("don") && !opt("id")) { const n = batch.length; batch = batch.filter((p) => p.bucket !== "don"); if (batch.length < n) console.log(`(${n - batch.length} DON!! photos left out; --don scores them)`); }
if (opt("limit")) batch = batch.slice(0, Number(opt("limit")));
if (opt("id")) batch = batch.filter((p) => opt("id").split(",").includes(p.id));
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
if (flag("fresh")) for (const p of batch) delete cache[p.id];
// --hide-number (10-01, blurred-number test): score the cached read with its number blanked, as if
// the number line could not be read. No new reads: only photos already read WITH a number.
// --sample N takes N of them spread across the batch.
const HIDE = flag("hide-number");
if (HIDE) {
  batch = batch.filter((p) => cache[p.id]?.cardNumber);
  const want = Number(opt("sample") ?? 0);
  if (want) { const k = Math.max(1, Math.floor(batch.length / want)); batch = batch.filter((_, i) => i % k === 0).slice(0, want); }
}
const VISION_CALL_CAP = 40;
const uncached = batch.filter((p) => !cache[p.id]).length;
console.log(`vision calls this run: ${uncached} uncached of ${batch.length} (≈${Math.round(uncached * 5.5)}k input tokens ≈ $${(uncached * 5.5 * 2 / 1000).toFixed(2)})`);
if (uncached > VISION_CALL_CAP && !flag("yes")) {
  console.error(`refusing ${uncached} vision calls without --yes (cap ${VISION_CALL_CAP}); use --limit N to narrow`);
  process.exit(2);
}

const UNREADABLE_CONFIDENCE = 0.2;
// The scanner's walk (same as tcg-panel.mjs).
async function lookup(read) {
  if (!read || (typeof read.confidence === "number" && read.confidence < UNREADABLE_CONFIDENCE)) return [];
  let printed = read.cardNumber ? { number: read.cardNumber, setTotal: read.setTotal, setCode: read.setCode, isSecretRare: false, shaky: read.secondLook === "low-confidence" } : null;
  if (game === "onepiece" && printed) {
    const s = splitOnePieceNumber(printed.number);
    if (s.setCode) printed = { ...printed, number: s.number, setCode: s.setCode };
  }
  let matches = [];
  for (const candidate of [read.name, read.englishName].filter(Boolean)) {
    const found = await searchTcgCardsLocal(game, candidate, printed, 5, read.subtitle ?? null, read.variant ?? null, read.firstEdition ?? null);
    if (found.length === 0) continue;
    if (matches.length === 0) matches = found;
    if (found[0].name.split(" - ")[0].trim().toLowerCase() === candidate.trim().toLowerCase()) { matches = found; break; }
  }
  if (matches.length === 0 && printed) matches = await searchTcgCardsLocal(game, "", printed, 5, read.subtitle ?? null, read.variant ?? null, read.firstEdition ?? null);
  return matches;
}

/** Card-level truth: the same card, any printing. */
function sameCard(c, p) {
  if (!c) return false;
  if (game === "yugioh") return yugiohKey(String(c.number)) === yugiohKey(p.number) && fold(c.name) === fold(p.name);
  // One Piece: the number names one card; the catalog spells a name two ways
  // across printings ("Sakazuk" / "Sakazuki" OP16-065), so the name is not the truth.
  // A DON!! card prints no number: the row itself (plain or gold of that art) is the truth.
  if (game === "onepiece" && p.number === "") return c.id === p.want || (p.wantAlso ?? []).includes(c.id);
  if (game === "onepiece") return baseNumber(c.number ?? c.collector_number) === p.number;
  // Lorcana: the catalog card name is "Name - Version"; number/total pins the set.
  const [cName, ...rest] = String(c.name).split(" - ");
  const cSub = rest.join(" - ");
  return String(c.number) === String(p.number) && Number(c.setTotal ?? c.set_total) === Number(p.total) && fold(cName) === fold(p.name) && (!p.subtitle || fold(cSub) === fold(p.subtitle));
}

const misses = [];
const printMisses = [];
const byBucket = new Map();
let cardHit = 0, printHit = 0, n = 0, ties = 0, tiebreaks = 0, tieDeclined = 0, tieCancelled = 0, spent = 0, tieSpent = 0;
const TIE_CACHE_PATH = path.join(root, `scripts/${game}-phone-tiebreak.cache.json`);
const tieCache = fs.existsSync(TIE_CACHE_PATH) ? JSON.parse(fs.readFileSync(TIE_CACHE_PATH, "utf8")) : {};
/** $ for one call: rates = [input, output, cache read, cache write] per million tokens. */
const dollars = (u, [i, o, cr, cw]) => u ? (u.inputTokens * i + u.outputTokens * o + u.cacheReadTokens * cr + u.cacheWriteTokens * cw) / 1e6 : 0;
for (const p of batch) {
  let read = cache[p.id];
  const file = path.join(PHOTO_DIR, `${p.id}.jpg`);
  let image = null;
  const load = async () => (image ??= await toClaudeImage(fs.readFileSync(file)));
  if (!read) {
    try {
      const img = await load();
      const res = await analyzeCardImageWithUsage(img.base64, img.mediaType, "en", game);
      read = res.read;
      spent += dollars(res.usage, [2, 10, 0.2, 2.5]); // Sonnet (scanUsage RATES)
    }
    catch (err) { console.log(`  !! ${p.name}: vision ${err?.message ?? err}`); continue; }
    cache[p.id] = read;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
    await new Promise((r) => setTimeout(r, 120));
  }
  if (HIDE) read = { ...read, cardNumber: null, setTotal: null };
  let found = await lookup(read);
  const tieIds = tiebreakIds(found, game);
  if (tieIds.length >= 2) ties++;
  if (tieIds.length >= 2 && !flag("no-tiebreak")) {
    try {
      // Answers are cached per photo + candidate list (10-01), so a re-run costs nothing.
      const tieKey = `${p.id}|${tieIds.join(",")}`;
      let t = tieCache[tieKey];
      if (!t) {
        const img = await load();
        const res = await tiebreakByPicture(img.base64, img.mediaType, game, tieIds);
        tieSpent += dollars(res.usage, game === "onepiece" ? [1, 5, 0.1, 1.25] : [5, 25, 0.5, 6.25]); // Haiku for One Piece, Opus otherwise
        t = { id: res.id ?? null, pick: res.pick ?? null, cancelled: res.reason === "catalog picture missing" };
        // A cancelled check (fewer than 2 candidates have a catalog picture) made no call and is
        // not cached: the picture may be there on the next run.
        if (!t.cancelled) {
          tieCache[tieKey] = { id: t.id, pick: t.pick };
          fs.writeFileSync(TIE_CACHE_PATH, JSON.stringify(tieCache, null, 1));
        }
      }
      tiebreaks++;
      if (t.cancelled) tieCancelled++; else if (!t.id) tieDeclined++;
      const at = t.id && t.id !== found[0].id ? found.findIndex((c) => c.id === t.id) : -1;
      if (at > 0) found = [found[at], ...found.filter((_, i) => i !== at)];
    } catch (err) { console.log(`  !! ${p.name}: tiebreak ${err?.message ?? err}`); }
  }
  const top = found[0];
  const rank = found.findIndex((c) => sameCard(c, p));
  const hit = rank === 0;
  n++;
  if (hit) cardHit++;
  const printOk = game === "yugioh" ? hit && top.rarity === p.wantRarity : top?.id === p.want;
  if (printOk) printHit++;
  else if (hit) printMisses.push(`${p.name}${p.subtitle ? " - " + p.subtitle : ""}: listing says ${p.wantRarity ?? p.wantVariant ?? "base"} ${p.want ?? ""}, we picked ${top?.rarity ?? ""} ${top?.variant || "base"} ${top?.id} [${top?.setCode}]  read=${read?.variant} 1st=${read?.firstEdition}  title: ${p.title}  ${p.listing}`);
  const tally = byBucket.get(p.bucket) ?? { hit: 0, n: 0 };
  tally.n++; if (hit) tally.hit++;
  byBucket.set(p.bucket, tally);
  process.stdout.write(`\r${n}/${batch.length}`);
  if (!hit) {
    misses.push({
      bucket: p.bucket,
      want: `${p.name}${p.subtitle ? " - " + p.subtitle : ""} ${p.number}${p.total ? "/" + p.total : ""} (${p.wantVariant || "base"} ${p.want})  title: ${p.title}`,
      got: top ? `${top.name} ${top.number}${top.setTotal ? "/" + top.setTotal : ""} [${top.setCode}] ${top.variant || "base"} ${top.id}` : "(nothing)",
      read: `name=${read?.name} sub=${read?.subtitle} number=${read?.cardNumber} total=${read?.setTotal} code=${read?.setCode} variant=${read?.variant} conf=${read?.confidence} 2nd=${read?.secondLook ?? "-"}`,
      rank,
      listing: p.listing,
    });
  }
}
process.stdout.write("\r");
const pct = (a) => (n ? ((a / n) * 100).toFixed(1) : "0");
console.log("\nbucket     card / n");
for (const [b, t] of byBucket) console.log(`${b.padEnd(10)} ${String(t.hit).padStart(3)} / ${t.n}${t.hit < t.n ? "   ◄" : ""}`);
if (flag("no-tiebreak")) console.log(`\nnear-ties (picture check would fire): ${ties}/${n}`);
console.log(`\n${game} seller photos${HIDE ? " (NUMBER HIDDEN)" : ""}: right card first: ${cardHit}/${n} = ${pct(cardHit)}%  (target ≥ 90%)   exact printing: ${printHit}/${n} = ${pct(printHit)}% (title labels are loose — not the gate)`);
if (tiebreaks) console.log(`(${tiebreaks} near-ties sent to the picture tiebreak: ${tiebreaks - tieDeclined - tieCancelled} answered, ${tieDeclined} kept the order, ${tieCancelled} cancelled (picture missing))`);
console.log(`spent this run ≈ $${spent.toFixed(2)} on reads + $${tieSpent.toFixed(2)} on picture checks`);
for (const m of printMisses) console.log(`~ printing differs: ${m}`);
for (const m of misses) {
  console.log(`\n✗ [${m.bucket}] want ${m.want}\n  got  ${m.got}${m.rank > 0 ? `  (right one at #${m.rank + 1})` : ""}\n  read ${m.read}\n  ${m.listing}`);
}
