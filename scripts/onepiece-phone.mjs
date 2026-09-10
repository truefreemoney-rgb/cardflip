// One Piece "phone" batch (09-10): Chris owns no One Piece cards and never
// will, so the real-photo gate uses eBay seller photos instead — a listing
// whose title carries the card number ("Sugar OP04-024 Parallel") is a
// labeled, hand-held, glare-and-sleeve photo of that card. Replayed through
// the scanner's own vision read + ranker (the same walk as tcg-panel.mjs).
//
// Truth is card-level (name + number): seller titles are reliable for the
// number, unreliable for the printing (a "parallel" in the title may be
// missing or wrong). Printing-level is printed too, not scored.
//
//   npm run op:phone                  # run (photos cached in backups/onepiece-phone/, reads in scripts/onepiece-phone.cache.json)
//   npm run op:phone -- --pull        # re-pull listings from eBay Browse (needs EBAY_CLIENT_ID/SECRET in .env.vercel.local)
//   npm run op:phone -- --fresh       # re-read every photo after a prompt change
//   npm run op:phone -- --size 60     # how many printings to sample when pulling (default 60)
//
// Anthropic key + eBay app keys from .env.vercel.local. Photos never leave
// backups/ (gitignored).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { searchTcgCardsLocal, splitOnePieceNumber } = await import(at("lib/server/tcgCards.ts"));
const { analyzeCardImageWithUsage, tiebreakByPicture, toClaudeImage } = await import(at("lib/server/vision.ts"));
const { isNearTie } = await import(at("lib/tiebreak.ts"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : null; };
const game = "onepiece";
const PHOTO_DIR = path.join(root, "backups/onepiece-phone");
const LIST_PATH = path.join(PHOTO_DIR, "batch.json");
const CACHE_PATH = path.join(root, "scripts/onepiece-phone.cache.json");
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.vercel.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
process.env.ANTHROPIC_API_KEY ||= env.ANTHROPIC_API_KEY;

const mirror = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });
const baseNumber = (n) => String(n).replace(/_[rp]\d+$/i, "").toUpperCase();
const cleanName = (n) => String(n).replace(/\s+-\s+[A-Z]+\d*-\d+[a-z0-9_#]*$/i, "").trim();

// ---- pull: sample printings, find one eBay listing each, save its photo ----
async function ebayToken() {
  const cid = env.EBAY_CLIENT_ID, sec = env.EBAY_CLIENT_SECRET;
  if (!cid || !sec) throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET missing from .env.vercel.local");
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

async function pull() {
  const size = Number(opt("size") ?? 60);
  const token = await ebayToken();
  // Priced printings only — those are the ones sellers list. Mix of families.
  const buckets = [
    ["base", "variant = ''", Math.round(size * 0.5)],
    ["alt", "variant IN ('parallel','alt-art','special','manga','full-art')", Math.round(size * 0.35)],
    ["reprint", "variant = 'reprint'", size - Math.round(size * 0.5) - Math.round(size * 0.35)],
  ];
  const batch = [];
  const seenNumbers = new Set();
  for (const [bucket, where, n] of buckets) {
    const rows = shuffled(mirror.prepare(`SELECT id, name, set_code, collector_number, variant, price_usd FROM tcg_cards WHERE game = ? AND image_url <> '' AND price_usd >= 1 AND (${where}) ORDER BY id`).all(game), 7 + bucket.length);
    let got = 0;
    for (const r of rows) {
      if (got >= n) break;
      const number = baseNumber(r.collector_number);
      if (seenNumbers.has(number)) continue;
      const name = cleanName(r.name);
      const isAlt = bucket === "alt";
      const q = `one piece ${name} ${number}${isAlt ? " parallel" : ""}`;
      const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
      url.searchParams.set("q", q);
      url.searchParams.set("limit", "20");
      url.searchParams.set("category_ids", "183454"); // CCG Individual Cards
      let items = [];
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } });
        if (res.status === 429) { console.log("  eBay 429, stopping pull"); break; }
        items = (await res.json()).itemSummaries ?? [];
      } catch (err) { console.log(`  ${name} ${number}: ${err?.message ?? err}`); continue; }
      const numRe = new RegExp(number.replace("-", "[- ]?"), "i");
      const firstWord = name.split(/[\s."]+/)[0].toLowerCase();
      const pick = items.find((it) => {
        const t = String(it.title ?? "");
        if (!numRe.test(t) || !t.toLowerCase().includes(firstWord)) return false;
        if (/\blot\b|bundle|playset|\bx[2-9]\b|[2-9]x\b|set of|proxy|custom|sleeve only|deck box/i.test(t)) return false;
        const altInTitle = /parallel|alt[- ]?art|manga|\bsp\b|special/i.test(t);
        return isAlt ? altInTitle : !altInTitle;
      });
      const img = pick?.image?.imageUrl;
      if (!pick || !img) continue;
      const full = img.replace(/s-l\d+\./, "s-l1600.");
      const id = `${bucket}-${number}`;
      const file = path.join(PHOTO_DIR, `${id}.jpg`);
      try {
        const res = await fetch(full, { headers: { "User-Agent": "CardFlip-phone/1.0" }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`image ${res.status}`);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      } catch (err) { console.log(`  ${name} ${number}: ${err?.message ?? err}`); continue; }
      batch.push({ id, bucket, name, number, want: r.id, wantVariant: r.variant, title: pick.title, listing: pick.itemWebUrl ?? "" });
      seenNumbers.add(number);
      got++;
      process.stdout.write(`\r${batch.length} listings`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  process.stdout.write("\r");
  fs.writeFileSync(LIST_PATH, JSON.stringify(batch, null, 1));
  console.log(`pulled ${batch.length} One Piece seller photos → ${path.relative(root, PHOTO_DIR)}`);
  return batch;
}

let batch = flag("pull") || !fs.existsSync(LIST_PATH) ? await pull() : JSON.parse(fs.readFileSync(LIST_PATH, "utf8"));
if (opt("limit")) batch = batch.slice(0, Number(opt("limit")));
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
if (flag("fresh")) for (const p of batch) delete cache[p.id];
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
  let printed = read.cardNumber ? { number: read.cardNumber, setTotal: read.setTotal, setCode: read.setCode, isSecretRare: false } : null;
  if (printed) {
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

const misses = [];
const byBucket = new Map();
let cardHit = 0, printHit = 0, n = 0, tiebreaks = 0;
for (const p of batch) {
  let read = cache[p.id];
  const file = path.join(PHOTO_DIR, `${p.id}.jpg`);
  let image = null;
  const load = async () => (image ??= await toClaudeImage(fs.readFileSync(file)));
  if (!read) {
    try { const img = await load(); read = (await analyzeCardImageWithUsage(img.base64, img.mediaType, "en", game)).read; }
    catch (err) { console.log(`  !! ${p.name}: vision ${err?.message ?? err}`); continue; }
    cache[p.id] = read;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
    await new Promise((r) => setTimeout(r, 120));
  }
  let found = await lookup(read);
  if (isNearTie(found) && !flag("no-tiebreak")) {
    try {
      const img = await load();
      const t = await tiebreakByPicture(img.base64, img.mediaType, game, [found[0].id, found[1].id]);
      tiebreaks++;
      if (t.id === found[1].id) found = [found[1], found[0], ...found.slice(2)];
    } catch (err) { console.log(`  !! ${p.name}: tiebreak ${err?.message ?? err}`); }
  }
  const top = found[0];
  const sameCard = (c) => c && baseNumber(c.number ?? c.collector_number) === p.number && cleanName(c.name).toLowerCase() === p.name.toLowerCase();
  const rank = found.findIndex(sameCard);
  const hit = rank === 0;
  n++;
  if (hit) cardHit++;
  if (top?.id === p.want) printHit++;
  const tally = byBucket.get(p.bucket) ?? { hit: 0, n: 0 };
  tally.n++; if (hit) tally.hit++;
  byBucket.set(p.bucket, tally);
  process.stdout.write(`\r${n}/${batch.length}`);
  if (!hit) {
    misses.push({
      bucket: p.bucket,
      want: `${p.name} ${p.number} (${p.wantVariant || "base"} ${p.want})  title: ${p.title}`,
      got: top ? `${top.name} ${top.number} [${top.setCode}] ${top.variant || "base"} ${top.id}` : "(nothing)",
      read: `name=${read?.name} number=${read?.cardNumber} code=${read?.setCode} variant=${read?.variant} conf=${read?.confidence} 2nd=${read?.secondLook ?? "-"}`,
      rank,
      listing: p.listing,
    });
  }
}
process.stdout.write("\r");
const pct = (a) => (n ? ((a / n) * 100).toFixed(1) : "0");
console.log("\nbucket     card / n");
for (const [b, t] of byBucket) console.log(`${b.padEnd(10)} ${String(t.hit).padStart(3)} / ${t.n}${t.hit < t.n ? "   ◄" : ""}`);
console.log(`\nonepiece seller photos: right card (name + number) first: ${cardHit}/${n} = ${pct(cardHit)}%  (target ≥ 90%)   exact printing: ${printHit}/${n} = ${pct(printHit)}% (title labels are loose — not the gate)`);
if (tiebreaks) console.log(`(${tiebreaks} near-ties sent to the picture tiebreak)`);
for (const m of misses) {
  console.log(`\n✗ [${m.bucket}] want ${m.want}\n  got  ${m.got}${m.rank > 0 ? `  (right one at #${m.rank + 1})` : ""}\n  read ${m.read}\n  ${m.listing}`);
}
