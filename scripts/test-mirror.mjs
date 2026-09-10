/**
 * The code that broke prod: en_cards ranking, and db.ts's ALTER-probe
 * migrations (which swallow errors by design — a typo'd probe column would
 * silently never exist). Run: npm run test:mirror
 *
 * Pins: every COLUMN_PROBES column actually exists after initSchema (the
 * probe list is the ONLY migration path for old databases, and its failures
 * are invisible); and searchEnglishCardsLocal's ranking ladder — exact
 * name+number beats exact name beats number, set-total/set-code agreement
 * outranks release date, the newest printing wins ties, a numerator can't
 * outvote a contradicting set total, and a full fraction identifies with no
 * name at all.
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
  // TCGdex hyphenates Shiny Vault names ("Charizard-GX"); the card and vision
  // say "Charizard GX". The 09-02 slab mismatch: this row was unfindable and
  // the rainbow decoy below won instead.
  ["sma-SV49", "Charizard-GX",     "sma",   "Shiny Vault","SV49","2019-08-23", 94,  "HIF"],
  // The mirror mixes apostrophes (curly here, straight elsewhere) and vision
  // writes either — Chris's Destined Rivals stack missed the mirror wholesale
  // on 09-02 and fell through to a 400ing upstream.
  ["dri-70",   "Team Rocket’s Zapdos", "dri", "Destined Rivals", "70", "2025-05-30", 182, "DRI"],
  ["sm3-150",  "Charizard GX",     "sm3",   "Burning Shadows","150","2017-08-05",147, ""],
  // 09-03 stress test: Destined Rivals 146/182 read as "140/182" picked
  // Rebel Clash 140/192 on the numerator alone.
  ["sv10-146", "Zamazenta",        "sv10",  "Destined Rivals","146","2025-05-30",182, "DRI"],
  ["swsh2-140","Zamazenta",        "swsh2", "Rebel Clash",    "140","2020-05-01",192, "RCL"],
  // Promo numbers carry the set code ("SVP 212"); the mirror files it as "212".
  ["svp-212",  "Reuniclus",        "svp",   "SVP Black Star Promos","212","2023-03-31",225, ""],
  ["sv10.5b-039","Reuniclus",      "sv10.5b","Black Bolt",    "039","2025-07-17",86,  ""],
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
check("same name, no number: newest printing wins the tie",
  await top("Pikachu", null), "swsh4-25");
check("misread numerator can't outvote an agreeing set total",
  await top("Zamazenta", { number: "140", setTotal: 182, setCode: null, isSecretRare: false }), "sv10-146");
check("misread numerator + agreeing set code + total: same answer",
  await top("Zamazenta", { number: "140", setTotal: 182, setCode: "DRI", isSecretRare: false }), "sv10-146");
check("promo number read with its set code prefix ('SVP 212') finds the promo",
  await top("Reuniclus", { number: "SVP 212", setTotal: null, setCode: "SVP", isSecretRare: false }), "svp-212");
check("numerator still counts when the total is unread",
  await top("Zamazenta", { number: "140", setTotal: null, setCode: null, isSecretRare: false }), "swsh2-140");
check("set code agreement steers between printings",
  await top("Charizard EX", { number: "12", setTotal: null, setCode: "FLF", isSecretRare: false }), "xy2-12");
check("hyphenated catalog name is found by the spaced name + SV number",
  await top("Charizard GX", { number: "SV49", setTotal: 94, setCode: null, isSecretRare: false }), "sma-SV49");
check("straight-apostrophe query finds the curly-apostrophe mirror row",
  await top("Team Rocket's Zapdos", { number: "70", setTotal: 182, setCode: null, isSecretRare: false }), "dri-70");
check("curly-apostrophe query finds it too",
  await top("Team Rocket’s Zapdos", null), "dri-70");
check("spaced-name secret rare still wins its own fraction",
  await top("Charizard GX", { number: "150", setTotal: 147, setCode: null, isSecretRare: false }), "sm3-150");

// --- 09-10 Pokémon panel rules (98% push, docs/STATE.md) -------------------
// Twins that share name, number AND total: only the set name / print year
// tells them apart. Plus the tier change (number+total beats an exact name
// with the wrong number), promo prefixes, Basic Energy, lettered totals.
const seed2 = [
  ["sm11-183", "Type: Null",        "sm11",  "Unified Minds",   "183", "2019-08-02", 236, "UNM"],
  ["sm12-183", "Type: Null",        "sm12",  "Cosmic Eclipse",  "183", "2019-11-01", 236, "CEC"],
  ["ex2-63",   "Eevee",             "ex2",   "Sandstorm",       "63",  "2003-09-18", 100, ""],
  ["dp5-63",   "Eevee",             "dp5",   "Majestic Dawn",   "63",  "2008-05-21", 100, ""],
  ["ex15-58",  "Pupitar",           "ex15",  "Dragon Frontiers","58",  "2006-11-08", 101, ""],
  ["ex15-59",  "Pupitar δ",         "ex15",  "Dragon Frontiers","59",  "2006-11-08", 101, ""],
  ["swshp-SWSH001", "Grookey",      "swshp", "SWSH Black Star Promos","SWSH001","2019-11-15", 307, "PR-SW"],
  ["2021swsh-8",    "Grookey",      "2021swsh","McDonald's Collection 2021","8","2021-02-09", 25, ""],
  ["sve-024",  "Metal Energy",      "sve",   "Scarlet & Violet Energies","024","2023-03-31", 8, "SVE"],
  ["sv06.5-099","Basic Metal Energy","sv06.5","Shrouded Fable", "099", "2024-08-02", 64, "SFA"],
  ["bw11-RC1", "Snivy",             "bw11",  "Legendary Treasures","RC1","2013-11-06", 113, "LTR"],
  ["2021swsh-5","Snivy",            "2021swsh","McDonald's Collection 2021","5","2021-02-09", 25, ""],
];
for (const [id, name, setId, setName, local, date, official, code] of seed2) {
  await db.prepare(
    `INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url, set_card_count_official, set_card_count_total, set_code, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, 0)`,
  ).run(id, name, setId, setName, local, date, official, official, code);
}
const pn = (number, setTotal, extra = {}) => ({ number, setTotal, setCode: null, isSecretRare: false, ...extra });

check("same fraction twins, no set name: newest wins (as before)",
  await top("Type: Null", pn("183", 236)), "sm12-183");
check("same fraction twins: vision's set name breaks the tie",
  await top("Type: Null", pn("183", 236, { setName: "Unified Minds" })), "sm11-183");
check("set name matches loosely ('Sun & Moon: Unified Minds')",
  await top("Type: Null", pn("183", 236, { setName: "Sun & Moon: Unified Minds" })), "sm11-183");
check("same fraction twins years apart: the copyright year breaks the tie",
  await top("Eevee", pn("63", 100, { copyrightYear: 2003 })), "ex2-63");
check("copyright year within a year of release still matches",
  await top("Eevee", pn("63", 100, { copyrightYear: 2008 })), "dp5-63");
check("set name cannot overrule a contradicting set total",
  await top("Zamazenta", pn("140", 182, { setName: "Rebel Clash" })), "sv10-146");
check("number+total agreeing beats an exact name with the wrong number (Pupitar δ 59)",
  await top("Pupitar", pn("59", 101)), "ex15-59");
check("exact name keeps the edge when the total is unread",
  await top("Pupitar", pn("59", null)), "ex15-58");
check("promo number filed with its code in the mirror ('SWSH001') matches the read 'SWSH001'",
  await top("Grookey", pn("SWSH001", null, { setCode: "SWSH" })), "swshp-SWSH001");
check("'Basic Metal Energy' read finds the mirror's 'Metal Energy' by number",
  await top("Basic Metal Energy", pn("024", null, { setCode: "SVE" })), "sve-024");
check("'Basic Metal Energy' with the Shrouded Fable number still finds that card",
  await top("Basic Metal Energy", pn("099", 64)), "sv06.5-099");
check("lettered sub-series total (RC1/25) is not a contradiction of the set count (113)",
  await top("Snivy", pn("RC1", 25)), "bw11-RC1");
// --- mtg ranking: special sets need evidence -------------------------------
// 09-02: a plain M11 Pyretic Ritual matched the Mystical Archive showcase —
// with nothing readable, the tie broke newest-first onto a masterpiece set.
const { searchMtgCardsLocal } = await import(at("lib/server/mtgCards.ts"));
const { isNearTie } = await import(at("lib/tiebreak.ts"));
for (const [id, name, code, setName, num, date, usd] of [
  ["m11-153", "Pyretic Ritual", "m11", "Magic 2011", "153", "2010-07-16", 6.13],
  ["soa-46",  "Pyretic Ritual", "soa", "Mystical Archive", "46", "2026-04-24", 6.3],
  // The List: normal-looking set_type ("masters"), priced, newer than M11 —
  // exactly the row that stole the top slot on prod after the first fix.
  ["plst-m11-153", "Pyretic Ritual", "plst", "The List", "M11-153", "2020-03-13", 5.5],
  // 09-03 MTG stress test: Final Fantasy tokens ("Hero", "Bird") aren't in
  // the mirror and substring-matched these priced Marvel cards.
  ["msc-17",  "Heroic Return",    "msc", "Marvel Super Heroes Commander", "17",  "2025-10-24", 1.79],
  ["msc-170", "Birds of Paradise", "msc", "Marvel Super Heroes Commander", "170", "2025-10-24", 7.99],
]) {
  await db.prepare(
    `INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, set_release_date, price_usd, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(id, name, code, setName, num, date, usd);
}
await db.prepare("INSERT INTO mtg_sets (code, name, set_type, synced_at) VALUES ('m11', 'Magic 2011', 'core', 0)").run();
await db.prepare("INSERT INTO mtg_sets (code, name, set_type, synced_at) VALUES ('soa', 'Mystical Archive', 'masterpiece', 0)").run();
await db.prepare("INSERT INTO mtg_sets (code, name, set_type, synced_at) VALUES ('plst', 'The List', 'masters', 0)").run();
const mtgTop = async (name, number, setCode, art) =>
  (await searchMtgCardsLocal(name, number, setCode, 5, art ?? null))[0]?.id ?? null;
check("name-only scan prefers the plain printing over the masterpiece",
  await mtgTop("Pyretic Ritual", null, null), "m11-153");
check("a special frame in the photo lifts the masterpiece back up (newest wins the tie)",
  await mtgTop("Pyretic Ritual", null, null, "full-art"), "soa-46");
check("an agreeing number is evidence enough for the special set",
  await mtgTop("Pyretic Ritual", "46", null), "soa-46");
check("set code still pins the printing exactly",
  await mtgTop("Pyretic Ritual", null, "soa"), "soa-46");
check("'Hero' (a token name) is not a prefix of Heroic Return",
  await mtgTop("Hero", "T0005", "fin"), null);
check("'Bird' is not inside Birds of Paradise",
  await mtgTop("Bird", null, null), null);
check("a whole first word still prefix-matches",
  await mtgTop("Heroic", null, null), "msc-17");
check("a whole inner word still matches",
  await mtgTop("Paradise", null, null), "msc-170");
// 09-06 (The Soul Stone): a misread name with a correct number + set code
// used to score Infinity on every by-number row — the fallback was dead.
check("a misread name still resolves when number + set code agree",
  await mtgTop("Pyrettc Ritval", "46", "soa"), "soa-46");
check("a misread name with the wrong set code stays a no-match",
  await mtgTop("Pyrettc Ritval", "46", "m11"), null);

// --- mtg printing cues (09-10, docs/MTG-IDENTIFICATION.md phase 1) --------
// Same name, same set, different treatment; and same name across sets with
// different artists / years. Each cue breaks the tie the printed key leaves,
// and never outvotes an agreeing set code.
for (const [id, name, code, setName, num, date, usd, artist, frame, border, effects] of [
  ["dmu-107", "Sheoldred, the Apocalypse", "dmu", "Dominaria United", "107", "2022-09-09", 60, "Chris Rahn", "2015", "black", ""],
  ["dmu-322", "Sheoldred, the Apocalypse", "dmu", "Dominaria United", "322", "2022-09-09", 65, "Chris Rahn", "2015", "black", "showcase"],
  ["dmu-380", "Sheoldred, the Apocalypse", "dmu", "Dominaria United", "380", "2022-09-09", 70, "Chris Rahn", "2015", "borderless", ""],
  ["cma-sr",  "Sol Ring", "cma", "Commander Anthology", "224", "2017-06-09", 2.5, "Mark Tedin", "2015", "black", ""],
  ["c21-sr",  "Sol Ring", "c21", "Commander 2021", "263", "2021-04-23", 2.4, "Mike Bierek", "2015", "black", ""],
]) {
  await db.prepare(
    `INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, set_release_date, price_usd, synced_at,
                            artist, frame, border_color, frame_effects, finishes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'nonfoil,foil')`,
  ).run(id, name, code, setName, num, date, usd, artist, frame, border, effects);
}
for (const [code, name] of [["dmu", "Dominaria United"], ["cma", "Commander Anthology"], ["c21", "Commander 2021"]]) {
  await db.prepare("INSERT INTO mtg_sets (code, name, set_type, synced_at) VALUES (?, ?, 'expansion', 0)").run(code, name);
}
const mtgTopC = async (name, number, setCode, cues) =>
  (await searchMtgCardsLocal(name, number, setCode, 5, null, false, cues))[0]?.id ?? null;
check("no treatment read: the plain printing edges out the special ones",
  await mtgTopC("Sheoldred, the Apocalypse", null, "dmu", null), "dmu-107");
check("treatment 'showcase' picks the showcase printing of the same set",
  await mtgTopC("Sheoldred, the Apocalypse", null, "dmu", { treatment: "showcase" }), "dmu-322");
check("treatment 'borderless' picks the borderless printing",
  await mtgTopC("Sheoldred, the Apocalypse", null, "dmu", { treatment: "borderless" }), "dmu-380");
check("treatment 'standard' picks the plain printing",
  await mtgTopC("Sheoldred, the Apocalypse", null, "dmu", { treatment: "standard" }), "dmu-107");
check("an agreeing collector number still beats a disagreeing treatment cue",
  await mtgTopC("Sheoldred, the Apocalypse", "322", "dmu", { treatment: "standard" }), "dmu-322");
check("artist breaks the tie between reprints",
  await mtgTopC("Sol Ring", null, null, { artist: "Mike Bierek" }), "c21-sr");
check("copyright year breaks the tie between reprints",
  await mtgTopC("Sol Ring", null, null, { copyrightYear: 2017 }), "cma-sr");
check("a misread artist cannot outvote an agreeing set code",
  await mtgTopC("Sol Ring", null, "cma", { artist: "Mike Bierek" }), "cma-sr");
check("The List icon lifts the PLST printing over the plain one",
  await mtgTopC("Pyretic Ritual", null, null, { marks: ["list-icon"] }), "plst-m11-153");
check("The List icon + the ORIGINAL's printed code and number lands on the PLST row",
  await mtgTopC("Pyretic Ritual", "153", "m11", { marks: ["list-icon"], copyrightYear: 2010 }), "plst-m11-153");
check("without the icon, the original's code and number stay on the original",
  await mtgTopC("Pyretic Ritual", "153", "m11", { copyrightYear: 2010 }), "m11-153");
check("vision read the card, corner unchecked: original still first but the List twin is a near-tie for the picture",
  isNearTie(await searchMtgCardsLocal("Pyretic Ritual", "153", "m11", 5, null, false, { marks: [], copyrightYear: 2010 })));
check("corner checked and empty: no near-tie, the original stands",
  !isNearTie(await searchMtgCardsLocal("Pyretic Ritual", "153", "m11", 5, null, false, { marks: [], copyrightYear: 2010, listIconSeen: false })));
check("no marks read at all leaves the plain printing on top",
  await mtgTopC("Pyretic Ritual", null, null, { finish: "foil" }), "m11-153");
// 09-10 pre-1998 rules: a printed year rules out the no-year sets (Beta,
// Unlimited, Revised …); a same-year set beats a one-year-off set; border
// colour separates Beta from Unlimited.
for (const [id, code, setName, num, date, border] of [
  ["leb-241", "leb", "Limited Edition Beta", "241", "1993-10-04", "black"],
  ["2ed-241", "2ed", "Unlimited Edition",    "241", "1993-12-01", "white"],
  ["3ed-242", "3ed", "Revised Edition",      "242", "1994-04-11", "white"],
  ["sum-242", "sum", "Summer Magic / Edgar", "242", "1994-06-21", "white"],
  ["4ed-311", "4ed", "Fourth Edition",       "311", "1995-04-01", "white"],
]) {
  await db.prepare(
    `INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, set_release_date, price_usd, synced_at,
                            artist, frame, border_color, frame_effects, finishes)
     VALUES (?, 'Cyclopean Tomb', ?, ?, ?, ?, 1, 0, 'Anson Maddocks', '1993', ?, '', 'nonfoil')`,
  ).run(id, code, setName, num, date, border);
}
check("no year read, black border: Beta over Unlimited",
  await mtgTopC("Cyclopean Tomb", null, null, { border: "black" }), "leb-241");
check("no year read, white border: Beta is out, the newest white-border set wins the tie the seller taps through",
  await mtgTopC("Cyclopean Tomb", null, null, { border: "white" }), "4ed-311");
check("a printed year rules out the no-year sets: © 1995 → 4th Edition",
  await mtgTopC("Cyclopean Tomb", null, null, { copyrightYear: 1995, border: "white" }), "4ed-311");
check("same-year set beats the one-year-off set: © 1994 → Summer Magic, not 4th",
  await mtgTopC("Cyclopean Tomb", null, null, { copyrightYear: 1994, border: "white" }), "sum-242");
check("second look saw no year line: 4th and Summer Magic (© 1994) lose, Revised wins the white tie",
  await mtgTopC("Cyclopean Tomb", null, null, { border: "white", noYearLine: true }), "3ed-242");
check("no year line + no bevel seen: still Revised — an unseen bevel is no evidence",
  await mtgTopC("Cyclopean Tomb", null, null, { border: "white", noYearLine: true, bevel: false }), "3ed-242");
check("no year line + the Unlimited bevel: Unlimited",
  await mtgTopC("Cyclopean Tomb", null, null, { border: "white", noYearLine: true, bevel: true }), "2ed-241");
check("bevel cue never touches a black-border row",
  await mtgTopC("Cyclopean Tomb", null, null, { border: "black", bevel: false }), "leb-241");
// 09-10 picture tiebreak: both rankers expose rankScore; a 1-point gap is a tie.
{
  const twins = (await searchEnglishCardsLocal("Type: Null", { number: "183", setTotal: 236, setCode: null, isSecretRare: false }, 5)).cards;
  check("Pokémon ranker exposes rankScore", typeof twins[0]?.rankScore === "number");
  check("same-fraction twins with nothing else read are a near-tie", isNearTie(twins));
  const settled = (await searchEnglishCardsLocal("Type: Null", { number: "183", setTotal: 236, setCode: "UNM", isSecretRare: false }, 5)).cards;
  check("an agreeing set code settles the tie", !isNearTie(settled));
  const mtgTwins = await searchMtgCardsLocal("Cyclopean Tomb", null, null, 5, null, false, { border: "white" });
  check("Magic ranker exposes rankScore", typeof mtgTwins[0]?.rankScore === "number");
  check("white-border no-year printings are a near-tie", isNearTie(mtgTwins));
}
const { hasTwinPrinting } = await import(at("lib/server/mtgCards.ts"));
check("twin lookup: a set+number The List reprinted", await hasTwinPrinting("m11", "153"), "list");
check("twin lookup: a set+number with no look-alike", await hasTwinPrinting("dmu", "107"), null);

check("finish is carried on the card, not used to rank",
  (await searchMtgCardsLocal("Sol Ring", null, "c21", 5, null, false, { finish: "foil" }))[0]?.finishes, ["nonfoil", "foil"]);

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

// This section must read and write through the SAME SQLite library
// seedMtgMirror uses internally (node:sqlite), NOT the libsql `db` client.
// The app runs the file in WAL mode (db.ts), and libsql ↔ node:sqlite WAL
// visibility across connections is platform-dependent: on Linux CI a libsql
// write wasn't seen by seedMtgMirror's node:sqlite reader, so the Run B merge
// found nothing and the read-back missed the replace (green on Windows, red
// on CI). Two node:sqlite connections coordinate WAL correctly, cross-platform.
const prodDb = new DatabaseSync(path.join(work, "data", "cardflip.db"));
prodDb.exec("PRAGMA busy_timeout = 5000");
const q1 = (sql) => prodDb.prepare(sql).get();

// Run A: fresh import copies mirror, sets, history and the TCGplayer map.
writeSeed({ series: [{ cardId: "lea-232", startDay: "2026-01-01", prices: [9.99, 7], updatedDay: "2026-01-02" }], mtime: 1000 });
await seedMtgMirror();
check("fresh seed: mirror copied", q1("SELECT COUNT(*) AS n FROM mtg_cards").n, 2);
check("fresh seed: sets copied", q1("SELECT COUNT(*) AS n FROM mtg_sets").n, 1);
check("fresh seed: seed-only price series straight-copied",
  q1("SELECT prices FROM price_series WHERE card_id = 'lea-232'")?.prices, "[9.99,7]");
check("fresh seed: tcgplayer map copied",
  q1("SELECT card_id FROM tcgplayer_products WHERE product_id = 1234")?.card_id, "lea-232");

// Marker: same seed mtime again is a no-op even after prod loses rows.
prodDb.prepare("DELETE FROM mtg_cards WHERE id = 'lea-48'").run();
await seedMtgMirror();
check("marker: unchanged seed is a no-op", q1("SELECT COUNT(*) AS n FROM mtg_cards").n, 1);

// Run B: prod is FRESHER but incomplete (the 08-16 bug) → replaced anyway.
// Prod's own price point must survive the merge; the seed's extra day fills in.
prodDb.prepare("UPDATE mtg_cards SET synced_at = 9999999999").run();
prodDb.prepare("UPDATE price_series SET prices = '[5]', updated_day = '2026-01-05' WHERE card_id = 'lea-232'").run();
writeSeed({ series: [{ cardId: "lea-232", startDay: "2026-01-01", prices: [9.99, 7], updatedDay: "2026-01-02" }], mtime: 2000 });
await seedMtgMirror();
check("fresh-but-incomplete prod mirror is replaced", q1("SELECT COUNT(*) AS n FROM mtg_cards").n, 2);
check("history merge keeps prod's point, fills the seed's gap day",
  q1("SELECT prices FROM price_series WHERE card_id = 'lea-232'")?.prices, "[5,7]");

// Run C: prod full (>= 80k floor) AND newer → mirror kept, seed ignored.
prodDb.exec(`
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 80100)
  INSERT INTO mtg_cards (id, oracle_id, name, set_code, set_name, collector_number, set_release_date,
    image_url, rarity, type_line, finishes, lang, synced_at)
  SELECT 'bulk-' || i, '', 'Bulk Card', 'blk', 'Bulk', CAST(i AS TEXT), '', '', '', '', '', 'en', 9999999999 FROM n`);
writeSeed({ series: [], mtime: 3000 });
await seedMtgMirror();
check("full + newer prod mirror is kept",
  q1("SELECT COUNT(*) AS n FROM mtg_cards").n >= 80_000);

prodDb.close();
console.log(failures === 0 ? "\nAll mirror checks passed" : `\n${failures} mirror check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
