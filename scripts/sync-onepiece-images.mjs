// One Piece pictures from TCGplayer (via tcgcsv.com, category 68) instead of
// the Bandai card-list scans that optcgapi mirrors — every Bandai image
// carries a diagonal "SAMPLE" stamp (Chris 09-30: "we shouldn't have any
// cards with overlays like that"). TCGplayer photographs the real card.
//
//   npm run sync:onepiece:images          (after sync:onepiece; catalog-sync runs both)
//
// Match: tcgcsv product Number ("ST13-003") = our collector_number, then
// the printing — a product with no "(Parallel)"-style tag is the base
// print, tagged ones pair with our parallel rows (_p1, _p2 … in order).
// Rows with no clean TCGplayer scan show Bandai's stamped card (Chris 09-30:
// "if the cards don't have an unstamped image … you have to use the stamped
// cards, we can't have any image coming soon nonsense").
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

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
/** "clean" | "stamped" | "placeholder" | "unchecked" for one TCGplayer product picture. */
async function pictureVerdict(productId, refUrl) {
  const k = String(productId);
  // Numbers are cached; the verdict is re-derived so a rule change needs no refetch.
  if (stampCache[k]?.lift != null) {
    stampCache[k].verdict = verdict(stampCache[k]);
    return stampCache[k].verdict;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const thumb = await toGrey(await fetchBuf(`https://tcgplayer-cdn.tcgplayer.com/product/${k}_200w.jpg`));
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
      stampCache[k] = { verdict: v, lift: Number(s.lift.toFixed(1)), white: Number(s.white.toFixed(2)), mad: mad == null ? null : Number(mad.toFixed(1)) };
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

// "Monkey.D.Luffy (003) (Parallel)" → printing tags without the card-number tag.
function tagsOf(name) {
  const tags = [];
  for (const m of String(name).matchAll(/\(([^)]+)\)/g)) {
    const t = m[1].trim().toLowerCase();
    if (!/^\d+$/.test(t)) tags.push(t);
  }
  return tags;
}
// Our variant column ↔ a tcgcsv tag class.
function classOf(tags) {
  const s = tags.join(" ");
  if (!s) return "base";
  if (/manga/.test(s)) return "manga";
  if (/box topper/.test(s)) return "box-topper";
  if (/alternate|alt art/.test(s)) return "alt-art";
  if (/parallel/.test(s)) return "parallel";
  if (/reprint/.test(s)) return "base";
  return "other";
}
function ourClass(variant) {
  if (!variant || variant === "reprint") return "base";
  if (/^(parallel|alt-art|manga|box-topper)$/.test(variant)) return variant;
  return "other";
}

const groups = await getJson(`${API}/groups`);
// number → products (in productId order)
const byNumber = new Map();
let fetched = 0;
async function worker(queue) {
  for (let g = queue.shift(); g; g = queue.shift()) {
    const products = await getJson(`${API}/${g.groupId}/products`);
    for (const p of products) {
      const number = ext(p, "Number").trim().toUpperCase();
      if (!number || !p.imageUrl) continue;
      if (!byNumber.has(number)) byNumber.set(number, []);
      byNumber.get(number).push({ id: p.productId, name: p.name, cls: classOf(tagsOf(p.name)), image: bigImage(p.imageUrl) });
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
const rows = db.prepare("SELECT id, collector_number, variant, image_url, ref_image_url FROM tcg_cards WHERE game = 'onepiece' AND set_code NOT IN ('PROMO', 'DON') ORDER BY id").all(); // DON!! cards print no number to pair on
// synced_at moves too: push-catalog.mjs only uploads a table whose newest stamp is newer than prod's.
const update = db.prepare("UPDATE tcg_cards SET image_url = ?, synced_at = ? WHERE id = ?");
const now = Date.now();
// Same number, same printing class, paired in order (_p1 → first parallel, _p2 → second).
const taken = new Map(); // number|cls → how many used
let matched = 0;
let stamped = 0;
const unmatched = [];
const picks = [];
for (const r of rows) {
  const number = r.collector_number.toUpperCase();
  const cls = ourClass(r.variant);
  const pool = (byNumber.get(number) ?? []).filter((p) => p.cls === cls);
  const k = `${number}|${cls}`;
  const i = taken.get(k) ?? 0;
  // A parallel beyond what TCGplayer lists (or our "other") falls back to the
  // last product of its class; a base with no base product tries the first
  // product of any class only when it is the sole listing.
  let pick = pool[i] ?? pool[pool.length - 1];
  if (!pick) {
    const any = byNumber.get(number) ?? [];
    if (cls === "base" && any.length === 1) pick = any[0];
  }
  if (!pick) {
    unmatched.push(r.id);
    continue;
  }
  taken.set(k, i + 1);
  picks.push({ row: r, pick });
}
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
const picked = new Map(picks.map((p) => [p.row.id, p]));
const tally = { clean: 0, stamped: 0, placeholder: 0, unchecked: 0 };
db.exec("BEGIN");
for (const r of rows) {
  const p = picked.get(r.id);
  const v = p ? results.get(r.id) : null;
  if (v) tally[v]++;
  // Fallback order: Bandai's picture, then TCGplayer's stamped copy, then whatever the row had.
  const image = v === "clean" ? p.pick.image : r.ref_image_url || (p && v !== "placeholder" ? p.pick.image : "") || r.image_url;
  if (image !== r.image_url) update.run(image, now, r.id);
}
db.exec("COMMIT");
matched = tally.clean;
stamped = tally.stamped + tally.unchecked;
console.log(`onepiece images: ${matched}/${rows.length} clean TCGplayer scans; ${stamped} TCGplayer pictures stamped and ${tally.placeholder} placeholders → Bandai's stamped card; ${unmatched.length} not on TCGplayer → Bandai's stamped card`);
if (unmatched.length) console.log(`  not on TCGplayer: ${unmatched.slice(0, 40).join(", ")}${unmatched.length > 40 ? " …" : ""}`);
