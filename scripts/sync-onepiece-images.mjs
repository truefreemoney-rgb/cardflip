// One Piece pictures from TCGplayer (via tcgcsv.com, category 68) instead of
// the Bandai card-list scans that optcgapi mirrors — every Bandai image
// carries a diagonal "SAMPLE" stamp (Chris 09-30: "we shouldn't have any
// cards with overlays like that"). TCGplayer photographs the real card.
//
//   npm run sync:onepiece:images          (after sync:onepiece; catalog-sync runs both)
//
// Match: tcgcsv product Number ("ST13-003") = our collector_number, then the
// printing: the product priced like the row, else its own set's product of
// that printing, else Bandai's picture (lib/onepiecePick.mjs; 10-25, pairing
// across every set had put 361 rows on another printing's picture).
// Rows with no clean TCGplayer scan show Bandai's stamped card (Chris 09-30:
// "if the cards don't have an unstamped image … you have to use the stamped
// cards, we can't have any image coming soon nonsense").
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { classOf, pickPictures, tagsOf } from "./lib/onepiecePick.mjs";
import { isOnePieceStampedTwin } from "../src/lib/onepiece.ts";

const API = "https://tcgcsv.com/tcgplayer/68";
// TCGplayer itself reuses Bandai's stamped art for many products (ST-13,
// OP05, OP12 …; Romance Dawn is a real scan). Every picked picture is
// scored once for the stamp on its 200px thumbnail and remembered here by
// product id, so the weekly run only inspects new products.
const STAMP_CACHE = path.join(process.cwd(), "scripts", "onepiece-stamp.cache.json");
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "application/json" };
const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"));

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      return (await res.json()).results ?? [];
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

/**
 * The "SAMPLE" stamp is one fixed template, so it is checked as one: the
 * mask (scripts/onepiece-stamp.mask.json) is where Bandai's stamped
 * OP01-001 is lighter than TCGplayer's clean scan of the same card. A
 * stamped picture is lighter inside the mask than in the 2px ring around
 * it (lift 8–27 measured 09-30, light backgrounds included); a clean scan
 * is not (≤ 4). TCGplayer's "Image Coming Soon" placeholder is near-white
 * all over and counts as no picture.
 */
const { W, H, mask, ring } = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "onepiece-stamp.mask.json"), "utf8"));
const toGrey = (buf) => sharp(buf).resize(W, H, { fit: "fill" }).removeAlpha().greyscale().raw().toBuffer();
function stampScore(g) {
  let inS = 0, inN = 0, rS = 0, rN = 0, white = 0;
  for (let i = 0; i < W * H; i++) {
    if (g[i] > 235) white++;
    if (mask[i]) { inS += g[i]; inN++; } else if (ring[i]) { rS += g[i]; rN++; }
  }
  return { lift: inS / inN - rS / rN, white: white / (W * H) };
}
// The decisive test (09-30): TCGplayer's picture IS Bandai's stamped one
// when the two are near-duplicates — mean absolute difference after
// removing each image's mean brightness: 2–3 for the same picture, 17+ for
// a real scan. The mask lift only decides when Bandai's picture can't be
// fetched (its key comes from the optcgapi filename, "ST13-003_p1_….jpg").
function meanAbsDiff(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - ma - (b[i] - mb));
  return s / a.length;
}
const bandaiKey = (refUrl) => /^([A-Z]{1,4}\d{0,3}-\d{1,4}(?:_[pr]\d)?)/i.exec(String(refUrl).split("/").pop() ?? "")?.[1] ?? null;
async function fetchBuf(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
// Checked by eye 09-30: duplicates ≤ 5, real scans ≥ 9; 5–9 has both (Karoo
// scan 6.0, Air Door stamped 6.7), and there the mask lift settles it.
const verdict = ({ lift, white, mad }) => {
  if (white > 0.5) return "placeholder";
  if (mad != null && mad < 5) return "stamped";
  if (mad != null && mad >= 9) return "clean";
  return lift >= 7 ? "stamped" : "clean";
};

const stampCache = fs.existsSync(STAMP_CACHE) ? JSON.parse(fs.readFileSync(STAMP_CACHE, "utf8")) : {};
// SAMPLE is temporary (Chris 10-13): stamped pictures are re-checked once a day, so a clean scan TCGplayer
// swaps in under the same product id is picked up. The thumbnail's byte length is the cheap change test;
// "clean" verdicts with a stamp-sized lift (the mad >= 9 shortcut, e.g. Sabo OP13-120_p2) are re-checked too.
const TODAY = new Date().toISOString().slice(0, 10);
const recheck = (c) => c.verdict !== "clean" || c.lift >= 7;
const nowClean = new Set(); // product ids that turned clean this run
/** "clean" | "stamped" | "placeholder" | "unchecked" for one TCGplayer product picture. */
async function pictureVerdict(productId, refUrl) {
  const k = String(productId);
  const thumbUrl = `https://tcgplayer-cdn.tcgplayer.com/product/${k}_200w.jpg`;
  // Numbers are cached; the verdict is re-derived so a rule change needs no refetch.
  let prefetched = null;
  const cached = stampCache[k];
  if (cached?.lift != null) {
    cached.verdict = verdict(cached);
    if (!recheck(cached) || cached.at === TODAY) return cached.verdict;
    try {
      prefetched = await fetchBuf(thumbUrl);
    } catch {
      return cached.verdict; // retry tomorrow
    }
    // No length yet (entries from before 10-14): this run only records it, no Bandai refetch for thousands.
    if (cached.len == null || cached.len === prefetched.length) {
      cached.len = prefetched.length;
      cached.at = TODAY;
      return cached.verdict;
    }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = prefetched ?? (await fetchBuf(thumbUrl));
      prefetched = null;
      const thumb = await toGrey(raw);
      const s = stampScore(thumb);
      let mad = null;
      const key = bandaiKey(refUrl);
      if (key) {
        try {
          mad = meanAbsDiff(thumb, await toGrey(await fetchBuf(`https://en.onepiece-cardgame.com/images/cardlist/card/${key}.png`)));
        } catch {
          mad = null; // no Bandai picture under that key: the mask decides
        }
      }
      const v = verdict({ ...s, mad });
      const lift = Number(s.lift.toFixed(1));
      // cleanLen versions the link (?v=) so the saved copy gets a new file name, not the stamped one cached under the old.
      const cleanLen = cached?.lift != null && recheck(cached) && v === "clean" && lift < 7 ? raw.length : cached?.cleanLen;
      if (cleanLen && cleanLen !== cached?.cleanLen) nowClean.add(k);
      stampCache[k] = { verdict: v, lift, white: Number(s.white.toFixed(2)), mad: mad == null ? null : Number(mad.toFixed(1)), len: raw.length, at: TODAY, ...(cleanLen ? { cleanLen } : {}) };
      return v;
    } catch (err) {
      if (attempt >= 2) {
        console.log(`  !! ${err.message} (unchecked → stamped fallback)`);
        return "unchecked";
      }
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

const ext = (p, key) => p.extendedData?.find((e) => e.name === key)?.value ?? "";
const bigImage = (url) => String(url ?? "").replace(/_200w\.jpg$/, "_in_1000x1000.jpg");

const groups = await getJson(`${API}/groups`);
// number → products (in productId order), each with its set (group name) and TCGplayer market (the highest printing's)
const byNumber = new Map();
let fetched = 0;
async function worker(queue) {
  for (let g = queue.shift(); g; g = queue.shift()) {
    const [products, prices] = await Promise.all([getJson(`${API}/${g.groupId}/products`), getJson(`${API}/${g.groupId}/prices`)]);
    const market = new Map();
    for (const q of prices) if (q.marketPrice > 0) market.set(q.productId, Math.max(market.get(q.productId) ?? 0, q.marketPrice));
    for (const p of products) {
      const number = ext(p, "Number").trim().toUpperCase();
      if (!number || !p.imageUrl) continue;
      if (!byNumber.has(number)) byNumber.set(number, []);
      byNumber.get(number).push({ id: p.productId, name: p.name, cls: classOf(tagsOf(p.name)), image: bigImage(p.imageUrl), group: g.name, market: market.get(p.productId) ?? null });
    }
    fetched++;
  }
}
const queue = [...groups];
await Promise.all(Array.from({ length: 4 }, () => worker(queue)));
for (const list of byNumber.values()) list.sort((a, b) => a.id - b.id);
console.log(`tcgcsv: ${fetched} groups, ${byNumber.size} numbers`);

// Promo rows (set_code PROMO, sync-onepiece.mjs --with-promos) stay out: paired by number they
// took other cards' scans; they keep the picture their own feed entry carries.
// The rows sync-onepiece-tcg.mjs added ("…#tcg<product>") stay out of the pairing too: they would shift every
// pairing after them (10-25). They, and every row it tied to its product (tcg_product_id), take that product's picture.
const rows = db.prepare("SELECT id, set_name, collector_number, variant, image_url, ref_image_url, price_usd FROM tcg_cards WHERE game = 'onepiece' AND set_code NOT IN ('PROMO', 'DON') AND id NOT LIKE '%#tcg%' ORDER BY id").all(); // DON!! cards print no number to pair on
const hasTie = db.prepare("PRAGMA table_info(tcg_cards)").all().some((c) => c.name === "tcg_product_id");
const tied = hasTie ? db.prepare("SELECT id, set_code, set_name, collector_number, variant, image_url, ref_image_url, price_usd, tcg_product_id FROM tcg_cards WHERE game = 'onepiece' AND tcg_product_id IS NOT NULL ORDER BY id").all() : [];
// synced_at moves too: push-catalog.mjs only uploads a table whose newest stamp is newer than prod's.
const update = db.prepare("UPDATE tcg_cards SET image_url = ?, synced_at = ? WHERE id = ?");
const now = Date.now();
let matched = 0;
let stamped = 0;
const { picks: paired, unmatched: unpaired, how } = pickPictures(rows, byNumber);
console.log(`picks: by price ${how.price}, own set ${how.own}, kept the old pick ${how.keptOld}; own-set pick 2x+ off the row price ${how.offPrice}; Bandai (no pick) ${how.none}`);
// A recorded tie is the row's own printing: it replaces the pairing's pick (and Bandai's fallback) when TCGplayer has a picture.
const productById = new Map();
for (const list of byNumber.values()) for (const p of list) productById.set(p.id, p);
const tiedPicks = new Map();
for (const r of tied) {
  const pick = productById.get(Number(r.tcg_product_id));
  if (pick) tiedPicks.set(r.id, { row: r, pick, exact: true });
}
const picks = [...paired.filter((p) => !tiedPicks.has(p.row.id)), ...tiedPicks.values()];
const unmatched = unpaired.filter((id) => !tiedPicks.has(id));
const pairedIds = new Set(rows.map((r) => r.id));
for (const r of tied) if (!pairedIds.has(r.id) && tiedPicks.has(r.id)) rows.push(r);
console.log(`tied to their own product (sync-onepiece-tcg.mjs): ${tiedPicks.size} rows${tied.length > tiedPicks.size ? ` (${tied.length - tiedPicks.size} with no TCGplayer picture keep theirs)` : ""}`);
// Stamp check, a few thumbnails at a time (cached ids cost nothing).
const queue2 = [...picks];
const results = new Map();
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let item = queue2.shift(); item; item = queue2.shift()) results.set(item.row.id, await pictureVerdict(item.pick.id, item.row.ref_image_url));
  }),
);
fs.writeFileSync(STAMP_CACHE, JSON.stringify(stampCache, null, 0));
// Chris 09-30: a clean scan wherever TCGplayer has one; otherwise the
// stamped Bandai card (ref_image_url) — never a blank, never a placeholder.
// 10-12: when TCGplayer's picture is a proven twin of Bandai's (this row's own
// printing, not a fallback pick, and near-duplicate: mad < 5) the TCGplayer
// link wins. Same stamped picture, but optcgapi links are kept off list pages
// (CardPagesUi showsInLists), so those rows showed empty tiles there.
// --dry: print what would change, write nothing.
const DRY = process.argv.includes("--dry");
const picked = new Map(picks.map((p) => [p.row.id, p]));
const tally = { clean: 0, stamped: 0, placeholder: 0, unchecked: 0 };
let changed = 0;
const sample = [];
if (!DRY) db.exec("BEGIN");
for (const r of rows) {
  const p = picked.get(r.id);
  const v = p ? results.get(r.id) : null;
  if (v) tally[v]++;
  const mad = p ? stampCache[String(p.pick.id)]?.mad : null;
  const twin = p && p.exact && v === "stamped" && mad != null && mad < 5;
  // Fallback order: TCGplayer's twin copy, Bandai's picture, TCGplayer's stamped copy, whatever the row had.
  const cleanLen = p ? stampCache[String(p.pick.id)]?.cleanLen : null;
  const tcgImage = p ? (cleanLen && v === "clean" ? `${p.pick.image}?v=${cleanLen}` : p.pick.image) : "";
  // A row sync-onepiece-tcg.mjs added ("…#tcg") has no Bandai picture to fall back on. With no TCGplayer photo
  // (CDN 403, "unchecked") it keeps what that pass gave it; behind a placeholder, a reprint or a stamped copy shows its
  // booster card's picture, the same face (Chris 09-30: never a blank, never a placeholder).
  // A tied row whose product has no photo (Demo Deck 2023 Sanji/Usopp promos, 10-25) keeps the picture it shows.
  const added = r.id.includes("#tcg");
  const sameFace = added && (r.variant === "reprint" || isOnePieceStampedTwin({ variant: r.variant, setCode: r.set_code }));
  const image = added && v === "unchecked"
    ? r.image_url
    : tiedPicks.has(r.id) && v === "unchecked"
      ? r.ref_image_url || r.image_url
      : added && v === "placeholder"
      ? (sameFace ? rows.find((x) => x.id === r.collector_number)?.image_url : null) || r.image_url
      : v === "clean" || twin ? tcgImage : r.ref_image_url || (p && v !== "placeholder" ? p.pick.image : "") || r.image_url;
  if (image !== r.image_url) {
    changed++;
    sample.push(`${r.id}: ${r.image_url.split("/").pop()} -> ${image}`);
    if (DRY && process.env.DRY_OUT) fs.appendFileSync(process.env.DRY_OUT, JSON.stringify({ id: r.id, from: r.image_url, to: image }) + "\n");
    if (!DRY) update.run(image, now, r.id);
  }
}
// Pictures that turned clean this run get a versioned link above, so save-pictures re-saves them.
const unstamped = picks.filter((p) => nowClean.has(String(p.pick.id))).length;
if (!DRY) db.exec("COMMIT");
console.log(`${DRY ? "[dry] would change" : "changed"} ${changed} rows; ${unstamped} stamped pictures now clean (re-save)`);
for (const s of sample.slice(0, 8)) console.log(`  ${s}`);
matched = tally.clean;
stamped = tally.stamped + tally.unchecked;
console.log(`onepiece images: ${matched}/${rows.length} clean TCGplayer scans; ${stamped} TCGplayer pictures stamped and ${tally.placeholder} placeholders → Bandai's stamped card; ${unmatched.length} not on TCGplayer → Bandai's stamped card`);
if (unmatched.length) console.log(`  not on TCGplayer: ${unmatched.slice(0, 40).join(", ")}${unmatched.length > 40 ? " …" : ""}`);
