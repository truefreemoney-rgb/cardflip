/**
 * Query-plan budget for the catalog mirrors. Run: npm run test:queryplans
 *
 * Why this exists: on 2026-09-06 Turso blocked the whole production account
 * after the free tier's 500M row reads/month were burned in six days — the
 * Magic set list ran a correlated EXISTS over all 94k mtg_cards once per set,
 * hasEnglishMirror COUNT(*)'d 20k rows twice per search, and so on. Row reads
 * count every row the engine scans, so one missing index is an outage.
 *
 * How: intercept every SELECT the hot server functions issue, ask SQLite for
 * EXPLAIN QUERY PLAN, and FAIL if any big table is walked with a bare
 * `SCAN <table>` (no index). Known LIKE '%x%' name searches are allow-listed
 * by function until the folded-name columns land (BACKLOG → Turso outage).
 *
 * Same throwaway-db trick as test-settings.mjs: chdir to a temp dir before
 * any import so `data/cardflip.db` lands there with the real schema.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-queryplan-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { db } = await import(at("lib/db.ts"));
const mtg = await import(at("lib/server/mtgCards.ts"));
const en = await import(at("lib/server/enCards.ts"));
const bulk = await import(at("lib/server/priceBulkWrite.ts"));

// Tables where a bare scan is an outage waiting to happen.
const BIG = ["en_cards", "mtg_cards", "mtg_sets", "price_series", "tcgplayer_products", "jp_cards", "zh_cards"];

// --- seed a few rows so the planner has real tables ---------------------------
const now = Date.now();
await db.prepare(
  `INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url, set_card_count_official, set_card_count_total, set_code, synced_at)
   VALUES ('base1-4', 'Charizard', 'base1', 'Base Set', '4', '1999-01-09', '', 102, 102, 'BS', ?)`,
).run(now);
await db.prepare(
  `INSERT INTO mtg_sets (code, name, released_at, card_count, printed_size, set_type, icon_url, synced_at)
   VALUES ('fin', 'Final Fantasy', '2025-06-13', 300, 300, 'expansion', '', ?)`,
).run(now);
await db.prepare(
  `INSERT INTO mtg_cards (id, oracle_id, name, set_code, set_name, collector_number, set_release_date, image_url, rarity, type_line, finishes, lang, synced_at)
   VALUES ('fin-564', 'o1', 'Cloud, Midgar Mercenary', 'fin', 'Final Fantasy', '564', '2025-06-13', '', 'rare', 'Creature', 'nonfoil', 'en', ?)`,
).run(now);
await db.prepare(
  `INSERT INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
   VALUES ('base1-4', 'pokemon', 'holofoil', 'tcgplayer', 'USD', '2026-01-01', '[1]', '2026-01-01')`,
).run();

// --- intercept SELECTs and grade their plans ----------------------------------
const origPrepare = db.prepare.bind(db);
let current = null; // { fn, allow }
const violations = [];
const seen = new Map(); // fn -> count of SELECTs graded

db.prepare = (sql) => {
  const stmt = origPrepare(sql);
  if (!current || !/^\s*select/i.test(sql)) return stmt;
  const wrap = (method) => async (...args) => {
    await grade(sql, args);
    return stmt[method](...args);
  };
  return { get: wrap("get"), all: wrap("all"), run: stmt.run.bind(stmt) };
};

async function grade(sql, args) {
  const { fn, allow } = current;
  seen.set(fn, (seen.get(fn) ?? 0) + 1);
  let plan;
  try {
    plan = await origPrepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args);
  } catch (err) {
    violations.push({ fn, sql, detail: `EXPLAIN failed: ${err.message}` });
    return;
  }
  if (process.env.SHOW_PLANS) console.log("   plan", fn, "::", plan.map((r) => r.detail).join(" | "));
  // Aliases: "FROM mtg_cards c" / "JOIN mtg_sets AS s" → plan lines say "SCAN c".
  const alias = new Map();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)(?:\s+AS)?\s+(\w+)/gi)) {
    if (!/^(WHERE|ON|LEFT|INNER|JOIN|GROUP|ORDER|LIMIT|SET|AS)$/i.test(m[2])) alias.set(m[2], m[1]);
  }
  // "SCAN t" (bare) and "SCAN t USING [COVERING] INDEX" both walk every row of
  // t — Turso bills each one. Only SEARCH is cheap. The single exception is
  // LIMIT 1 without ORDER BY, which stops after the first row.
  const limitOne = /\bLIMIT\s+1\b/i.test(sql) && !/\bORDER\s+BY\b/i.test(sql);
  for (const row of plan) {
    const line = String(row.detail ?? "");
    const m = /^SCAN (\w+)/.exec(line);
    if (!m) continue;
    const table = alias.get(m[1]) ?? m[1];
    if (BIG.includes(table) && !allow.includes(table) && !limitOne) {
      violations.push({ fn, sql, detail: line });
    }
  }
}

async function run(fn, allow, body) {
  current = { fn, allow };
  try {
    await body();
  } catch (err) {
    violations.push({ fn, sql: "(threw)", detail: err.message });
  } finally {
    current = null;
  }
}

// --- the hot paths -------------------------------------------------------------
// listMtgSets walks the whole set_code index once (DISTINCT subquery, ~94k
// index rows) — down from ~85M; the next step is caching it. Allowed, noted.
await run("listMtgSets", ["mtg_cards"], () => mtg.listMtgSets());
await run("mtgCardsBySet", [], () => mtg.mtgCardsBySet("fin"));
await run("hasMtgMirror", [], () => mtg.hasMtgMirror());
await run("hasEnglishMirror", [], () => en.hasEnglishMirror());
await run("englishCardsBySet", [], () => en.englishCardsBySet("Base Set"));
await run("lookupByPrintedNumber", [], () => en.lookupByPrintedNumber({ number: "4", setTotal: 102, setCode: null }));
await run("readSeriesMap", [], () => bulk.readSeriesMap("pokemon", "tcgplayer"));
// The /api/sets Pokémon query lives inline in the route; pinned here verbatim.
// GROUP BY over every set is an inherent 20k index walk per call — cache next.
await run("api/sets (pokemon)", ["en_cards"], () =>
  db.prepare(
    `SELECT set_name, MIN(set_release_date) AS release_date, MAX(image_url) AS sample_image
       FROM en_cards WHERE set_name != '' GROUP BY set_name ORDER BY release_date DESC`,
  ).all(),
);
// Name searches still LIKE '%x%' over the whole mirror — allow-listed until
// folded-name columns exist. Everything ELSE they touch must still use indexes.
await run("searchMtgCardsLocal", ["mtg_cards"], () => mtg.searchMtgCardsLocal("Cloud, Midgar Mercenary", "564", "fin"));
await run("searchEnglishCardsLocal", ["en_cards"], () => en.searchEnglishCardsLocal("Charizard", { number: "4", setTotal: 102, setCode: null }));

// --- set lists are memoed: the second call must not touch the catalog at all ---
const before = violations.length;
await run("listMtgSets (cached)", [], () => mtg.listMtgSets());
const cachedHit = violations.length === before && (seen.get("listMtgSets (cached)") ?? 0) === 1;
if (!cachedHit) violations.push({ fn: "listMtgSets (cached)", sql: "(second call)", detail: "expected one card_cache read and no catalog walk" });

// --- self-check: the detector must flag a known full scan ------------------------
await run("self-check", [], () => db.prepare("SELECT COUNT(*) AS c FROM en_cards").get());
const selfIdx = violations.findIndex((v) => v.fn === "self-check");
const selfCheckOk = selfIdx >= 0;
if (selfCheckOk) violations.splice(selfIdx, 1);

// --- report ----------------------------------------------------------------------
let failures = 0;
if (!selfCheckOk) {
  failures++;
  console.log("  FAIL  self-check — COUNT(*) FROM en_cards was not flagged; the detector is broken");
} else {
  console.log("  PASS  self-check — bare SCAN en_cards is detected");
}
seen.delete("self-check");
for (const [fn, n] of seen) console.log(`  PASS  ${fn} — ${n} SELECT${n === 1 ? "" : "s"} graded`);
for (const v of violations) {
  failures++;
  console.log(`  FAIL  ${v.fn}\n         plan  ${v.detail}\n         sql   ${v.sql.replace(/\s+/g, " ").trim().slice(0, 160)}`);
}
if (seen.size < 10) {
  failures++;
  console.log(`  FAIL  only ${seen.size} functions issued SELECTs — interception broke?`);
}
console.log(failures ? `\n${failures} query-plan failure(s)` : "\nquery plans: all indexed");
process.exitCode = failures ? 1 : 0;
