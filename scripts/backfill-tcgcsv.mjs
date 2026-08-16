/**
 * Backfill Pokémon price history from TCGCSV's daily TCGplayer archives.
 *
 *   npm run backfill:pokemon              # last 90 days
 *   npm run backfill:pokemon -- --days 180
 *
 * TCGCSV (tcgcsv.com) republishes TCGplayer's prices every day and keeps a
 * dated archive: https://tcgcsv.com/archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z
 * (~4 MB, every category, laid out as <date>/<categoryId>/<groupId>/prices —
 * Pokémon is category 3). That is the free Pokémon price history nothing
 * else offers. Needs 7-Zip on the PATH or at C:\Program Files\7-Zip.
 *
 * Steps:
 *   1. TCGplayer groups (sets) → our en_cards sets, by abbreviation
 *      (== set_code) else by normalised name, release date as tiebreak.
 *   2. Each group's products → our cards by collector number within the set.
 *      The productId → card map is saved to `tcgplayer_products` so the
 *      server's daily job (lib/server/pokemonPriceRefresh.ts) can use it and
 *      the seed can carry it to prod.
 *   3. Each day's archive → marketPrice per (product, subType) → compact
 *      price_series rows (game 'pokemon', source 'tcgplayer', USD), merged
 *      by day. Series that never reach 50¢ are skipped (bulk).
 * Then `npm run export:mtg` (the seed now carries every game's series) and
 * deploy — or let prod's daily job take it from there.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { addDays, decodePrices, encodePrices, setDay, todayUtc } from "../src/lib/priceSeries.ts";
import { matchGroupsToSets, productNumber, tcgplayerVariantKey } from "../src/lib/tcgcsv.ts";

const args = process.argv.slice(2);
const days = Number(args[args.indexOf("--days") + 1]) || 90;
const dataDir = path.join(process.cwd(), "data");
const cacheDir = path.join(dataDir, "tcgcsv");
const dbPath = process.env.CARDFLIP_DB_PATH ?? path.join(dataDir, "cardflip.db");
fs.mkdirSync(cacheDir, { recursive: true });

const SEVEN_ZIP = ["7z", "C:\\Program Files\\7-Zip\\7z.exe", "/c/Program Files/7-Zip/7z.exe"].find((p) => {
  try { execFileSync(p, ["--help"], { stdio: "ignore" }); return true; } catch { return false; }
});
if (!SEVEN_ZIP) { console.error("7-Zip not found (needed to open the .7z archives)"); process.exit(1); }

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS price_series (
    card_id TEXT NOT NULL, game TEXT NOT NULL, variant TEXT NOT NULL, source TEXT NOT NULL,
    currency TEXT NOT NULL, start_day TEXT NOT NULL, prices TEXT NOT NULL, updated_day TEXT NOT NULL,
    PRIMARY KEY (card_id, variant, source)
  );
  CREATE TABLE IF NOT EXISTS tcgplayer_products (
    product_id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL,
    card_id TEXT NOT NULL,
    game TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tcgplayer_products_group ON tcgplayer_products(group_id);
`);

const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip-superior.fly.dev)" };
async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// 1. groups → sets
const sets = db
  .prepare("SELECT set_name AS name, MAX(set_code) AS code, MIN(set_release_date) AS released FROM en_cards GROUP BY set_name")
  .all();
const groups = (await getJson("https://tcgcsv.com/tcgplayer/3/groups")).results;
const groupToSet = matchGroupsToSets(groups, sets);
console.log(`groups: ${groups.length} TCGplayer, ${sets.length} mirror sets, ${groupToSet.size} matched`);

// 2. products → cards
const cardsBySet = new Map();
for (const row of db.prepare("SELECT id, set_name, local_id FROM en_cards").iterate()) {
  let m = cardsBySet.get(row.set_name);
  if (!m) { m = new Map(); cardsBySet.set(row.set_name, m); }
  m.set(String(row.local_id).replace(/^0+/, "").toLowerCase(), row.id);
}
const upsertProduct = db.prepare("INSERT OR REPLACE INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES (?, ?, ?, 'pokemon')");
const productToCard = new Map();
let mapped = 0, unmapped = 0;
db.exec("BEGIN");
for (const [groupId, setName] of groupToSet) {
  const byNumber = cardsBySet.get(setName);
  if (!byNumber) continue;
  let products;
  try { products = (await getJson(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`)).results; }
  catch (err) { console.warn(`  products ${groupId} (${setName}): ${err.message}`); continue; }
  for (const p of products) {
    const num = productNumber(p);
    if (!num) continue;
    const cardId = byNumber.get(num);
    if (!cardId) { unmapped++; continue; }
    productToCard.set(p.productId, cardId);
    upsertProduct.run(p.productId, groupId, cardId);
    mapped++;
  }
  await new Promise((r) => setTimeout(r, 60));
}
db.exec("COMMIT");
console.log(`products: ${mapped} mapped to cards, ${unmapped} without a mirror match`);

// 3. daily archives → series
const acc = new Map(); // key card|variant → Map(day → price)
const wantedGroups = new Set([...groupToSet.keys()].map(String));
const today = todayUtc();
for (let i = days; i >= 1; i--) {
  const day = addDays(today, -i);
  const file = path.join(cacheDir, `prices-${day}.ppmd.7z`);
  if (!fs.existsSync(file)) {
    const res = await fetch(`https://tcgcsv.com/archive/tcgplayer/prices-${day}.ppmd.7z`, { headers: HEADERS });
    if (!res.ok) { console.warn(`  ${day}: no archive (HTTP ${res.status})`); continue; }
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const out = path.join(cacheDir, "x");
  fs.rmSync(out, { recursive: true, force: true });
  try {
    execFileSync(SEVEN_ZIP, ["x", "-y", `-o${out}`, file, `${day}/3/*`], { stdio: "ignore" });
  } catch {
    console.warn(`  ${day}: extract failed`);
    continue;
  }
  const catDir = path.join(out, day, "3");
  let points = 0;
  for (const gid of fs.existsSync(catDir) ? fs.readdirSync(catDir) : []) {
    if (!wantedGroups.has(gid)) continue;
    const pf = path.join(catDir, gid, "prices");
    if (!fs.existsSync(pf)) continue;
    let json;
    try { json = JSON.parse(fs.readFileSync(pf, "utf8")); } catch { continue; }
    for (const r of json.results ?? []) {
      const cardId = productToCard.get(r.productId);
      if (!cardId || !(r.marketPrice > 0)) continue;
      const variant = tcgplayerVariantKey(r.subTypeName);
      const key = `${cardId}|${variant}`;
      let m = acc.get(key);
      if (!m) { m = new Map(); acc.set(key, m); }
      m.set(day, r.marketPrice);
      points++;
    }
  }
  fs.unlinkSync(file);
  process.stdout.write(`  ${day}: ${points} points\r`);
}
fs.rmSync(path.join(cacheDir, "x"), { recursive: true, force: true });
console.log(`\n${acc.size} raw series over ${days} days`);

// 4. write compact rows, merged with whatever exists
const MIN_TRACKED_USD = 0.5;
const selectRow = db.prepare("SELECT start_day, prices FROM price_series WHERE card_id = ? AND variant = ? AND source = 'tcgplayer'");
const upsert = db.prepare(
  `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
   VALUES (?, 'pokemon', ?, 'tcgplayer', 'USD', ?, ?, ?)`,
);
let written = 0, skipped = 0;
db.exec("BEGIN");
for (const [key, m] of acc) {
  const [cardId, variant] = key.split("|");
  let max = 0;
  for (const v of m.values()) if (v > max) max = v;
  const existing = selectRow.get(cardId, variant);
  if (!existing && max < MIN_TRACKED_USD) { skipped++; continue; }
  let row = existing ? { startDay: existing.start_day, prices: decodePrices(existing.prices) } : null;
  for (const [day, price] of [...m.entries()].sort()) row = setDay(row, day, price);
  const last = row.prices.length ? addDays(row.startDay, row.prices.length - 1) : today;
  upsert.run(cardId, variant, row.startDay, encodePrices(row.prices), last);
  written++;
}
db.exec("COMMIT");
const span = db.prepare("SELECT MIN(start_day) lo, MAX(updated_day) hi, COUNT(*) n FROM price_series WHERE game = 'pokemon'").get();
console.log(`wrote ${written} series, skipped ${skipped} under $${MIN_TRACKED_USD}; pokemon series now ${span.n}, ${span.lo} → ${span.hi}`);
db.close();
