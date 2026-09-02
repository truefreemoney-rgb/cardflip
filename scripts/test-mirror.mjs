/**
 * The code that broke prod: en_cards ranking, and db.ts's ALTER-probe
 * migrations (which swallow errors by design — a typo'd probe column would
 * silently never exist). Run: npm run test:mirror
 *
 * Pins: every COLUMN_PROBES column actually exists after initSchema (the
 * probe list is the ONLY migration path for old databases, and its failures
 * are invisible); and searchEnglishCardsLocal's ranking ladder — exact
 * name+number beats exact name beats number, set-total/set-code agreement
 * outranks release date, the oldest printing wins ties, and a full fraction
 * identifies with no name at all.
 *
 * Same throwaway-db trick as test-auth.mjs: chdir to a temp dir before any
 * import so `data/cardflip.db` lands there.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-mirror-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { db } = await import(at("lib/db.ts"));
const { searchEnglishCardsLocal, englishCardById } = await import(at("lib/server/enCards.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

// --- ALTER probes: every probed column must actually exist ----------------
// Re-parse COLUMN_PROBES from source so the test can't drift from the code.
const { readFileSync } = await import("node:fs");
const dbSource = readFileSync(new URL("../src/lib/db.ts", import.meta.url), "utf8");
const probesBlock = dbSource.slice(
  dbSource.indexOf("const COLUMN_PROBES"),
  dbSource.indexOf("async function initSchema"),
);
const tableRe = /\[\s*\n?\s*"(\w+)",\s*\[([\s\S]*?)\]\s*,?\s*\]/g;
const flatRe = /\["(\w+)",\s*\[([\s\S]*?)\]\]/g;
const probed = new Map();
for (const re of [tableRe, flatRe]) {
  let m;
  while ((m = re.exec(probesBlock))) {
    // Columns only — an element is "name TYPE..."; comment prose inside the
    // block also contains quoted words, so require the SQL type.
    const cols = [...m[2].matchAll(/"([a-z_]+) (?:TEXT|INTEGER|REAL)/g)].map((c) => c[1]);
    if (cols.length) probed.set(m[1], [...new Set([...(probed.get(m[1]) ?? []), ...cols])]);
  }
}
check("parsed COLUMN_PROBES from source (sanity: >= 4 tables)", probed.size >= 4);
for (const [table, cols] of probed) {
  const info = (await db.prepare(`PRAGMA table_info(${table})`).all()).map((r) => r.name);
  const missing = cols.filter((c) => !info.includes(c));
  check(`probes landed on ${table} (${cols.length} columns)`, missing, []);
}

// --- en_cards ranking ------------------------------------------------------
const seed = [
  // Base Set Charizard 4/102 (oldest), and decoys that each beat it on ONE axis.
  ["base1-4",  "Charizard",        "base1", "Base Set",   "4",   "1999-01-09", 102, "BS"],
  ["ex3-100",  "Charizard ex",     "ex3",   "FireRed",    "100", "2004-08-30", 112, "FR"],
  ["xy2-12",   "Charizard EX",     "xy2",   "Flashfire",  "12",  "2014-05-07", 106, "FLF"],
  ["mega-4",   "Mega Charizard Y", "xy2b",  "Flashfire",  "4",   "2014-05-07", 106, "FLF"],
  ["swsh4-25", "Pikachu",          "swsh4", "Vivid Volt", "25",  "2020-11-13", 185, "VIV"],
  ["base1-58", "Pikachu",          "base1", "Base Set",   "58",  "1999-01-09", 102, "BS"],
];
for (const [id, name, setId, setName, local, date, official, code] of seed) {
  await db.prepare(
    `INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url, set_card_count_official, set_card_count_total, set_code, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, 0)`,
  ).run(id, name, setId, setName, local, date, official, official, code);
}

const top = async (name, printed) =>
  (await searchEnglishCardsLocal(name, printed, 5)).cards[0]?.id ?? null;

check("exact name + number beats everything",
  await top("Charizard", { number: "4", setTotal: 102, setCode: null, isSecretRare: false }), "base1-4");
check("exact name beats substring match despite age",
  await top("Charizard", null), "base1-4");
check("exact name+number survives a misread set total (name is stronger evidence)",
  await top("Charizard", { number: "4", setTotal: 106, setCode: null, isSecretRare: false }), "base1-4");
check("substring name + agreeing number/total wins when no exact-name row has the number",
  await top("Mega Charizard", { number: "4", setTotal: 106, setCode: null, isSecretRare: false }), "mega-4");
check("full fraction with NO name still identifies",
  await top("", { number: "58", setTotal: 102, setCode: null, isSecretRare: false }), "base1-58");
check("same name, no number: oldest printing wins the tie",
  await top("Pikachu", null), "base1-58");
check("set code agreement steers between printings",
  await top("Charizard EX", { number: "12", setTotal: null, setCode: "FLF", isSecretRare: false }), "xy2-12");
check("id fetch returns exactly the row (fast path)",
  (await englishCardById("ex3-100")).cards.map((c) => c.id), ["ex3-100"]);
check("id fetch misses cleanly", (await englishCardById("nope-1")).cards, []);

// --- seedMtgMirror completeness -------------------------------------------
// The seed path's decisions, pinned: fresh import copies everything; the
// marker makes reruns no-ops; a fresh-but-incomplete prod mirror is REPLACED
// (recency alone burned prod on 08-16); history merge fills gaps without
// overwriting prod's own points; a full+newer prod mirror is KEPT.
const { seedMtgMirror } = await import(at("lib/db.ts"));
const { gzipSync } = await import("node:zlib");
const { mkdirSync, writeFileSync, utimesSync, readFileSync: readF } = await import("node:fs");
const { DatabaseSync } = await import("node:sqlite");

const seedDir = path.join(work, "seed");
mkdirSync(seedDir, { recursive: true });
const seedGz = path.join(seedDir, "mtg-mirror.db.gz");

function writeSeed({ series, mtime }) {
  const raw = path.join(work, "seed-src.db");
  try { rmSync(raw); } catch { /* first run */ }
  const s = new DatabaseSync(raw);
  s.exec(`
    CREATE TABLE mtg_sets (code TEXT PRIMARY KEY, name TEXT, released_at TEXT, card_count INTEGER,
      printed_size INTEGER, set_type TEXT, icon_url TEXT, synced_at INTEGER);
    CREATE TABLE mtg_cards (id TEXT PRIMARY KEY, oracle_id TEXT, name TEXT, set_code TEXT, set_name TEXT,
      collector_number TEXT, set_release_date TEXT, image_url TEXT, rarity TEXT, type_line TEXT,
      finishes TEXT, lang TEXT, price_usd REAL, price_usd_foil REAL, price_usd_etched REAL,
      price_eur REAL, price_eur_foil REAL, synced_at INTEGER);
    CREATE TABLE price_series (card_id TEXT, game TEXT, variant TEXT, source TEXT, currency TEXT,
      start_day TEXT, prices TEXT, updated_day TEXT, PRIMARY KEY (card_id, variant, source));
    CREATE TABLE tcgplayer_products (product_id INTEGER PRIMARY KEY, group_id INTEGER, card_id TEXT, game TEXT);
    INSERT INTO mtg_sets VALUES ('lea', 'Limited Edition Alpha', '1993-08-05', 295, 295, 'core', '', 100);
    INSERT INTO mtg_cards VALUES ('lea-232', '', 'Black Lotus', 'lea', 'Limited Edition Alpha', '232',
      '1993-08-05', '', 'rare', 'Artifact', 'nonfoil', 'en', 20000, NULL, NULL, NULL, NULL, 100);
    INSERT INTO mtg_cards VALUES ('lea-48', '', 'Ancestral Recall', 'lea', 'Limited Edition Alpha', '48',
      '1993-08-05', '', 'rare', 'Instant', 'nonfoil', 'en', 5000, NULL, NULL, NULL, NULL, 100);
    INSERT INTO tcgplayer_products VALUES (1234, 7, 'lea-232', 'mtg');
  `);
  const ins = s.prepare("INSERT INTO price_series VALUES (?, 'mtg', ?, ?, ?, ?, ?, ?)");
  for (const r of series) ins.run(r.cardId, r.variant ?? "normal", r.source ?? "scryfall", "USD", r.startDay, JSON.stringify(r.prices), r.updatedDay);
  s.close();
  writeFileSync(seedGz, gzipSync(readF(raw)));
  utimesSync(seedGz, mtime, mtime);
}

const q1 = async (sql) => (await db.prepare(sql).get());

// Run A: fresh import copies mirror, sets, history and the TCGplayer map.
writeSeed({ series: [{ cardId: "lea-232", startDay: "2026-01-01", prices: [9.99, 7], updatedDay: "2026-01-02" }], mtime: 1000 });
await seedMtgMirror();
check("fresh seed: mirror copied", (await q1("SELECT COUNT(*) AS n FROM mtg_cards")).n, 2);
check("fresh seed: sets copied", (await q1("SELECT COUNT(*) AS n FROM mtg_sets")).n, 1);
check("fresh seed: seed-only price series straight-copied",
  (await q1("SELECT prices FROM price_series WHERE card_id = 'lea-232'"))?.prices, "[9.99,7]");
check("fresh seed: tcgplayer map copied",
  (await q1("SELECT card_id FROM tcgplayer_products WHERE product_id = 1234"))?.card_id, "lea-232");

// Marker: same seed mtime again is a no-op even after prod loses rows.
await db.prepare("DELETE FROM mtg_cards WHERE id = 'lea-48'").run();
await seedMtgMirror();
check("marker: unchanged seed is a no-op", (await q1("SELECT COUNT(*) AS n FROM mtg_cards")).n, 1);

// Run B: prod is FRESHER but incomplete (the 08-16 bug) → replaced anyway.
// Prod's own price point must survive the merge; the seed's extra day fills in.
await db.prepare("UPDATE mtg_cards SET synced_at = 9999999999").run();
await db.prepare("UPDATE price_series SET prices = '[5]', updated_day = '2026-01-05' WHERE card_id = 'lea-232'").run();
writeSeed({ series: [{ cardId: "lea-232", startDay: "2026-01-01", prices: [9.99, 7], updatedDay: "2026-01-02" }], mtime: 2000 });
await seedMtgMirror();
check("fresh-but-incomplete prod mirror is replaced", (await q1("SELECT COUNT(*) AS n FROM mtg_cards")).n, 2);
check("history merge keeps prod's point, fills the seed's gap day",
  (await q1("SELECT prices FROM price_series WHERE card_id = 'lea-232'"))?.prices, "[5,7]");

// Run C: prod full (>= 80k floor) AND newer → mirror kept, seed ignored.
await db.exec(`
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 80100)
  INSERT INTO mtg_cards (id, oracle_id, name, set_code, set_name, collector_number, set_release_date,
    image_url, rarity, type_line, finishes, lang, synced_at)
  SELECT 'bulk-' || i, '', 'Bulk Card', 'blk', 'Bulk', CAST(i AS TEXT), '', '', '', '', '', 'en', 9999999999 FROM n`);
writeSeed({ series: [], mtime: 3000 });
await seedMtgMirror();
check("full + newer prod mirror is kept",
  (await q1("SELECT COUNT(*) AS n FROM mtg_cards")).n >= 80_000);

console.log(failures === 0 ? "\nAll mirror checks passed" : `\n${failures} mirror check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
