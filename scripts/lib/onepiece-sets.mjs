// One Piece set repairs after the optcgapi feeds (10-20, Chris's /cards/one-piece findings):
//   1. A reprint inside a booster keeps its own card code (ST01-002) but the feed names it after the booster ("The
//      World's Strongest Warriors"), so the set list showed that name 11 times as one-card ghost sets. Every row of a
//      set code takes the name most of its rows carry (the starter feed's 17 rows beat the booster's 2).
//   2. The feed has no release dates (all 5,549 rows blank), so "Newest first" on /cards/one-piece sorted A-Z. tcgcsv's
//      One Piece groups (category 68, the same source the nightly prices use) carry an abbreviation ("OP01", "ST-01",
//      "EB05") and publishedOn for every set: matched on the code, written once (the upsert never overwrites a date).
// Pure DB work on a node:sqlite DatabaseSync; the groups fetch is one small call, injectable for tests.
export const TCGCSV_ONEPIECE_GROUPS = "https://tcgcsv.com/tcgplayer/68/groups";
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "application/json" };

/** "ST-01" / "OP18 RE" / "ST-01 PRE" -> "ST01" (a suffix = another product: release event, pre-release; those never match). */
export function groupCode(abbreviation) {
  const a = String(abbreviation ?? "").trim().toUpperCase();
  if (!a || /\s/.test(a)) return null;
  return a.replace(/-/g, "");
}

/** set_code -> YYYY-MM-DD from tcgcsv groups (a combined code like OP14EB04 falls back to its first four characters). */
export function releaseDates(groups) {
  const byCode = new Map();
  for (const g of groups) {
    const code = groupCode(g.abbreviation);
    const day = String(g.publishedOn ?? "").slice(0, 10);
    if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!byCode.has(code) || day < byCode.get(code)) byCode.set(code, day);
  }
  return (setCode) => byCode.get(setCode) ?? byCode.get(setCode.slice(0, 4)) ?? null;
}

/** Step 1: the majority name per set code. Returns the codes renamed. */
export function fixSetNames(db) {
  const rows = db.prepare("SELECT set_code, set_name, COUNT(*) AS n FROM tcg_cards WHERE game = 'onepiece' AND id NOT LIKE '%#%' GROUP BY set_code, set_name ORDER BY set_code, n DESC").all();
  const best = new Map();
  for (const r of rows) if (!best.has(r.set_code)) best.set(r.set_code, r.set_name);
  const upd = db.prepare("UPDATE tcg_cards SET set_name = ? WHERE game = 'onepiece' AND set_code = ? AND set_name <> ?");
  const renamed = [];
  for (const [code, name] of best) {
    const n = upd.run(name, code, name).changes;
    if (n > 0) renamed.push(`${code}: ${n} row(s) -> ${name}`);
  }
  return renamed;
}

/** Step 2: release dates for codes still blank. Returns the codes filled. */
export async function fillReleaseDates(db, { fetch: f = fetch } = {}) {
  const res = await f(TCGCSV_ONEPIECE_GROUPS, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`tcgcsv groups ${res.status}`);
  const body = await res.json();
  const groups = Array.isArray(body) ? body : body.results ?? [];
  if (groups.length < 40) throw new Error(`tcgcsv groups: ${groups.length} entries, expected 40+`);
  const dateOf = releaseDates(groups);
  const codes = db.prepare("SELECT DISTINCT set_code FROM tcg_cards WHERE game = 'onepiece' AND set_release_date = '' AND set_code NOT IN ('PROMO', 'DON')").all().map((r) => r.set_code);
  const upd = db.prepare("UPDATE tcg_cards SET set_release_date = ? WHERE game = 'onepiece' AND set_code = ? AND set_release_date = ''");
  const filled = [];
  const missing = [];
  for (const code of codes) {
    const day = dateOf(code);
    if (!day) { missing.push(code); continue; }
    upd.run(day, code);
    filled.push(`${code}=${day}`);
  }
  return { filled, missing };
}

export async function fixOnePieceSets(db, deps = {}) {
  const renamed = fixSetNames(db);
  console.log(`onepiece sets: ${renamed.length} code(s) renamed to their majority name${renamed.length ? ": " + renamed.join("; ") : ""}`);
  try {
    const { filled, missing } = await fillReleaseDates(db, deps);
    console.log(`onepiece sets: ${filled.length} code(s) given a release date${filled.length ? ": " + filled.join(" ") : ""}${missing.length ? `; no tcgcsv group for ${missing.join(" ")}` : ""}`);
  } catch (err) {
    console.log(`  !! onepiece sets: release dates skipped: ${err.message}`);
  }
}
