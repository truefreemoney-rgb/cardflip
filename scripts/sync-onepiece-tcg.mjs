// One Piece: every printing TCGplayer sells is its own row with its own price (10-25, Chris: "go ahead with the one
// piece fix"; asked 09-03 and 10-17). Runs after sync-onepiece.mjs (the optcgapi feed) and before
// sync-onepiece-images.mjs, which shows each tied row its own product's picture.
//   node scripts/sync-onepiece-tcg.mjs [--dry] [--report <out.json>]
// 1. Ties each row to the TCGplayer product it is, by the product name's printing tags (lib/onepieceTie.mjs), and
//    records it in tcg_cards.tcg_product_id (push-catalog sends it; the 5am refresh prices by it).
// 2. Adds the printings no row is: "OP17-006#tcg712668" (release event / pre-release / anniversary stamps under their
//    booster, promos under PROMO, LT-01 / Demo Deck / Revision Pack decks under their own code). Released groups only,
//    and only with a price.
// 3. Prices every tied row from its own product (lib/onepiece.ts onePieceProductPrice), the rule
//    lib/server/tcgPriceRefresh.ts prices by at 5am, so the 2am push and the refresh stop flipping (Usopp OP11-003_r1:
//    $1.66 from optcgapi at 2am, $0.09 at 5am, every night). No TCGplayer price = the row keeps the feed's.
// --dry: writes nothing. --report: the whole plan as JSON (the dry-run sheet). CARDFLIP_DB_PATH: another mirror file.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { NUMBER, homeCode, productPrices, rowsToAdd, tieRows } from "./lib/onepieceTie.mjs";
import { isOnePieceStampedTwin } from "../src/lib/onepiece.ts";

const API = "https://tcgcsv.com/tcgplayer/68";
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "application/json" }; // tcgcsv 401s a bare node UA
const DRY = process.argv.includes("--dry");
const reportAt = process.argv.indexOf("--report");
const REPORT = reportAt > 0 ? process.argv[reportAt + 1] : null;
const dbPath = process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db");
const db = new DatabaseSync(dbPath, DRY ? { readOnly: true } : {});

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

const groups = await getJson(`${API}/groups`);
if (groups.length < 40) throw new Error(`tcgcsv groups: ${groups.length}, expected 40+`);
const products = [];
const priceRows = [];
let failed = 0;
const queue = [...groups];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      try {
        const [prods, prices] = await Promise.all([getJson(`${API}/${g.groupId}/products`), getJson(`${API}/${g.groupId}/prices`)]);
        for (const p of prods) {
          const number = String((p.extendedData ?? []).find((e) => e.name === "Number")?.value ?? "").trim().toUpperCase();
          if (!NUMBER.test(number)) continue;
          products.push({ productId: p.productId, groupId: g.groupId, name: p.name, number, rarity: (p.extendedData ?? []).find((e) => e.name === "Rarity")?.value ?? "" });
        }
        priceRows.push(...prices);
      } catch (err) {
        failed++;
        console.log(`  !! group ${g.groupId} ${g.abbreviation}: ${err.message}`);
      }
    }
  }),
);
// A group that did not answer would read as "no product" and untie its rows: stop instead (tomorrow retries).
if (failed) throw new Error(`tcgcsv: ${failed} group(s) failed, nothing written`);
console.log(`tcgcsv: ${groups.length} groups, ${products.length} card products`);
const prices = productPrices(priceRows);

const cols = new Set(db.prepare("PRAGMA table_info(tcg_cards)").all().map((c) => c.name));
const rows = db.prepare(`SELECT id, name, collector_number, variant, set_code, set_name, set_release_date, rarity, price_usd, image_url, own_image_src${cols.has("tcg_product_id") ? ", tcg_product_id" : ""} FROM tcg_cards WHERE game = 'onepiece' AND set_code <> 'DON'`).all();
const { ties, claimed, shared, clashes, untied, info } = tieRows(rows, products, groups);

// Our set names and dates per code (the majority name, as lib/onepiece-sets.mjs fixSetNames keeps them).
const sets = new Map();
const tally = new Map();
for (const r of rows) {
  if (r.id.includes("#")) continue;
  const k = `${r.set_code}\u0001${r.set_name}`;
  tally.set(k, (tally.get(k) ?? 0) + 1);
}
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  const [code, name] = k.split("\u0001");
  if (!sets.has(code)) sets.set(code, { name, day: rows.find((r) => r.set_code === code && r.set_release_date)?.set_release_date ?? "" });
}
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const add = rowsToAdd(products, info, claimed, prices, sets, today, untied);

// A printing TCGplayer has no photo of (its CDN answers 403: 145 of the 10-25 adds, all of OP16's release event cards
// among them) never goes up with a broken picture. A reprint or a stamped copy has its booster card's face, so it
// shows that card's picture (Chris 09-30: never a blank); any other printing waits for TCGplayer's photo.
const sameFace = (r) => r.variant === "reprint" || isOnePieceStampedTwin({ variant: r.variant, setCode: r.set_code });
const baseOf = (number) => rows.filter((r) => r.collector_number === number && !r.id.includes("#") && !r.variant && r.image_url).sort((a, b) => Number(b.set_code === homeCode(number)) - Number(a.set_code === homeCode(number)))[0] ?? null;
const pictureLoads = async (productId) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
      await res.arrayBuffer();
      if (res.status === 403 || res.status === 404) return false;
      if (res.ok) return true;
    } catch {
      // a timeout says nothing: try once more, then count it as loading (the images pass checks it again)
    }
  }
  return true;
};
const pq = [...add.rows];
const noPicture = [];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let r = pq.shift(); r; r = pq.shift()) {
      if (await pictureLoads(r.tcg_product_id)) continue;
      const base = sameFace(r) ? baseOf(r.collector_number) : null;
      if (base) r.image_url = base.image_url;
      else noPicture.push(r);
    }
  }),
);
if (noPicture.length) {
  const wait = new Set(noPicture.map((r) => r.id));
  add.rows = add.rows.filter((r) => !wait.has(r.id));
  add.skipped.noPicture = noPicture.length;
  add.waiting = noPicture.map((r) => ({ id: r.id, name: r.name, variant: r.variant, usd: r.price_usd }));
}

// Prices: every tied row takes its own product's (a row without one keeps the feed's). A FIRST tie that would move a
// $20+ price more than 25% waits for a hand check (memory: every pricing change measured against real sales first):
// TCGplayer's market is a last sale, and 10-25 put EB02 SP Chopper OP08-001_p2 at $6,835.94 against optcgapi's $162.11
// with no TCGplayer sale in its latest-sales window. A held row keeps its picture, price and tie as they were, until its
// id is in scripts/onepiece-tcg-cleared.json ({ "<row id>": "<what the check found>" }).
const CLEARED = path.join(process.cwd(), "scripts", "onepiece-tcg-cleared.json");
const cleared = fs.existsSync(CLEARED) ? JSON.parse(fs.readFileSync(CLEARED, "utf8")) : {};
const byId = new Map(rows.map((r) => [r.id, r]));
const prodById = new Map(products.map((p) => [p.productId, p]));
const groupOf = (pid) => info.get(prodById.get(pid)?.groupId)?.abbreviation ?? null;
const priceChanges = [];
const held = new Map();
const band = { same: 0, within25: 0, filled: 0, moved: 0, noTcgPrice: 0, held: 0 };
// (The rows this pass added are priced here too, from the second night on: the push must never carry a stale price
// over the one the 5am refresh gave them.)
for (const [id, t] of ties) {
  const r = byId.get(id);
  const usd = prices.get(t.productId) ?? null;
  if (usd == null) { band.noTcgPrice++; continue; }
  const was = r.price_usd ?? null;
  if (was != null && Math.abs(usd - was) < 0.005) { band.same++; continue; }
  const kind = was == null || was === 0 ? "filled" : Math.abs(usd - was) <= 0.25 * was ? "within25" : "moved";
  const change = { id, productId: t.productId, product: prodById.get(t.productId)?.name ?? null, group: groupOf(t.productId), was, usd, kind, how: t.how };
  if (kind === "moved" && Math.max(was, usd) >= 20 && (r.tcg_product_id ?? null) !== t.productId && !cleared[id]) {
    band.held++;
    held.set(id, change);
    continue;
  }
  band[kind]++;
  priceChanges.push(change);
}

const how = {};
for (const t of ties.values()) how[t.how] = (how[t.how] ?? 0) + 1;
console.log(`rows ${rows.length}: tied ${ties.size} (${Object.entries(how).map(([k, v]) => `${k} ${v}`).join(", ")}), untied ${untied.length}, two rows on one product ${shared.length}, unresolved clashes ${clashes.length}`);
const borrowed = add.rows.filter((r) => !r.image_url.includes(`/product/${r.tcg_product_id}_`)).length;
console.log(`add ${add.rows.length} new printings, ${borrowed} showing their booster card's picture (no TCGplayer photo) (skipped: ${add.skipped.unreleased} unreleased, ${add.skipped.noPrice} no TCGplayer price, ${add.skipped.maybeOurs} maybe a row of ours the tags could not tie, ${add.skipped.noPicture ?? 0} no photo yet)`);
console.log(`prices of tied rows: ${band.same} same, ${band.within25} within 25%, ${band.moved} moved over 25%, ${band.filled} filled (row had none), ${band.noTcgPrice} without a TCGplayer price keep the feed's; ${band.held} $20+ moves held for a hand check`);

if (REPORT) {
  const moved = [...ties].filter(([, t]) => t.how === "moved").map(([id, t]) => ({ id, from: byId.get(id)?.tcg_product_id ?? null, picture: byId.get(id)?.image_url ?? null, to: t.productId, product: prodById.get(t.productId)?.name ?? null }));
  const linked = [...ties].filter(([, t]) => t.how === "linked").map(([id, t]) => ({ id, productId: t.productId, product: prodById.get(t.productId)?.name ?? null, group: info.get(prodById.get(t.productId)?.groupId)?.abbreviation ?? null, was: byId.get(id)?.price_usd ?? null, usd: prices.get(t.productId) ?? null }));
  fs.writeFileSync(REPORT, JSON.stringify({ at: new Date().toISOString(), dry: DRY, counts: { rows: rows.length, tied: ties.size, how, untied: untied.length, shared: shared.length, clashes: clashes.length, add: add.rows.length, skipped: add.skipped, prices: band }, moved, linked, add: add.rows, maybe: add.maybe, waiting: add.waiting ?? [], priceChanges, held: [...held.values()], untied, shared, clashes }, null, 1));
  console.log(`report: ${REPORT}`);
}
if (DRY) {
  console.log("[dry] nothing written");
  process.exit(0);
}

if (!cols.has("tcg_product_id")) db.exec("ALTER TABLE tcg_cards ADD COLUMN tcg_product_id INTEGER");
const now = Date.now();
const insertCols = ["id", "game", "name", "subtitle", "set_code", "set_name", "collector_number", "set_total", "set_release_date", "rarity", "variant", "image_url", "price_usd", "price_usd_foil", "art_hash", "synced_at", "ref_image_url", "tcg_product_id"];
// An added row is ours alone (the feed never names "#tcg"): each night refreshes it whole, except its picture (the
// images pass owns image_url once it has looked at the product's scan).
const insert = db.prepare(
  `INSERT INTO tcg_cards (${insertCols.join(", ")}) VALUES (${insertCols.map(() => "?").join(", ")})
   ON CONFLICT(id) DO UPDATE SET ${insertCols.filter((c) => c !== "id" && c !== "image_url").map((c) => `${c} = excluded.${c}`).join(", ")}`,
);
const setProduct = db.prepare("UPDATE tcg_cards SET tcg_product_id = ?, synced_at = ? WHERE id = ? AND tcg_product_id IS NOT ?");
const setPrice = db.prepare("UPDATE tcg_cards SET price_usd = ?, synced_at = ? WHERE id = ?");
db.exec("BEGIN");
for (const r of add.rows) insert.run(...insertCols.map((c) => r[c] ?? null));
let tiedNow = 0;
for (const r of rows) {
  if (r.id.includes("#tcg") || held.has(r.id)) continue;
  const pid = ties.get(r.id)?.productId ?? null;
  tiedNow += setProduct.run(pid, now, r.id, pid).changes;
}
for (const c of priceChanges) setPrice.run(c.usd, now, c.id);
db.exec("COMMIT");
console.log(`written: ${add.rows.length} printings added or refreshed, ${tiedNow} rows' product changed, ${priceChanges.length} prices`);
