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

console.log(failures === 0 ? "\nAll mirror checks passed" : `\n${failures} mirror check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
