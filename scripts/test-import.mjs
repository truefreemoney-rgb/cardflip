/**
 * Import from other apps (Tier 2 #12). Run: npm run test:import
 *
 * Pins: the CSV reader (quotes, BOM, tabs, semicolons, header aliases from
 * Collectr / TCGplayer / TCG Collector shapes); condition + printing split
 * ("Lightly Played Holofoil", "NM", "1st Edition"); name cleanup
 * ("Charizard ex - 199/165", "(Reverse Holo)"); matching by TCGplayer id,
 * by name + number + set, set-name doubt, number-mismatch doubt, 1st Edition
 * twins, sealed / Magic / non-English rows skipped; pricing by condition;
 * quantity → one row per copy; the 500-card cap; commit writes verified
 * rows with cost basis and unticked lines left out.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-import-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { parseCsv, parseImport, splitCondition, cleanName } = await import(at("lib/importCsv.ts"));
const { previewImport, commitImport, MAX_IMPORT_CARDS } = await import(at("lib/server/collectionImport.ts"));
const { listCardsForUser } = await import(at("lib/server/cards.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { askingPriceFor } = await import(at("lib/listing.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

console.log("csv reader");
check("quotes, escaped quotes, blank cells", parseCsv('a,b,c\n"x, y","he said ""hi""",\n'), [["a", "b", "c"], ["x, y", 'he said "hi"', ""]]);
check("BOM + CRLF + tabs", parseCsv("﻿Name\tQty\r\nPikachu\t2\r\n"), [["Name", "Qty"], ["Pikachu", "2"]]);
check("semicolons (Excel locales)", parseCsv("Name;Set\nPikachu;151"), [["Name", "Set"], ["Pikachu", "151"]]);

console.log("\ncondition + printing");
check("TCGplayer combined cell", splitCondition("Lightly Played Holofoil"), { condition: "Lightly Played", printing: "holofoil", firstEdition: false });
check("short codes", splitCondition("NM"), { condition: "Near Mint", printing: null, firstEdition: false });
check("1st Edition", splitCondition("Near Mint 1st Edition"), { condition: "Near Mint", printing: null, firstEdition: true });
check("reverse holo alone", splitCondition("Reverse Holofoil"), { condition: null, printing: "reverse holofoil", firstEdition: false });
check("unknown text is no condition", splitCondition("Graded PSA 9").condition, null);

console.log("\nname cleanup");
check("fraction in the name", cleanName("Charizard ex - 199/165", null), { name: "Charizard ex", number: "199/165" });
check("bracketed printing", cleanName("Pikachu (Reverse Holo)", "25"), { name: "Pikachu", number: "25" });
check("trailing dash number", cleanName("Mew - 151", null), { name: "Mew", number: "151" });
check("a real hyphenated name survives", cleanName("Ho-Oh", "10"), { name: "Ho-Oh", number: "10" });

console.log("\nheader aliases");
const tcg = parseImport("TCGplayer Id,Product Line,Set Name,Product Name,Number,Rarity,Condition,Quantity\n12345,Pokemon,Base Set,Charizard,4/102,Holo Rare,Lightly Played Holofoil,2\n");
check("TCGplayer shape", [tcg.rows[0].tcgplayerId, tcg.rows[0].name, tcg.rows[0].setName, tcg.rows[0].number, tcg.rows[0].condition, tcg.rows[0].printing, tcg.rows[0].quantity, tcg.rows[0].game], [12345, "Charizard", "Base Set", "4/102", "Lightly Played", "holofoil", 2, "pokemon"]);
const col = parseImport("Card Name,Set,Card Number,Grade,Variant,Qty,Purchase Price,Language\nPikachu,151,025/165,NM,Reverse Holo,1,$3.50,English\n");
check("Collectr-ish shape", [col.rows[0].name, col.rows[0].setName, col.rows[0].number, col.rows[0].condition, col.rows[0].printing, col.rows[0].paid, col.rows[0].language], ["Pikachu", "151", "025/165", "Near Mint", "reverse holo", 3.5, "english"]);
check("columns reported", col.columns, { set: "Set", number: "Card Number", condition: "Grade", printing: "Variant", quantity: "Qty", paid: "Purchase Price", language: "Language", name: "Card Name" });
check("zero quantity and blank names are skipped", parseImport("Name,Quantity\n,1\nPikachu,0\nMew,\n").skipped, [{ line: 2, reason: "No card name" }, { line: 3, reason: "Quantity is 0" }]);
check("blank quantity = 1", parseImport("Name,Quantity\nMew,\n").rows[0].quantity, 1);
let threw = null;
try { parseImport("Foo,Bar\n1,2\n"); } catch (e) { threw = e.message; }
check("no name column throws", typeof threw === "string" && threw.includes("card name column"), true);

console.log("\nmatching");
const seed = db.prepare(
  `INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url, set_card_count_official, set_card_count_total, set_code, synced_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
);
await seed.run("base1-4", "Charizard", "base1", "Base Set", "4", "1999-01-09", "https://img/base1-4/low.webp", 102, 102, "BS");
await seed.run("base1-4-1st", "Charizard", "base1", "Base Set", "4", "1999-01-09", "https://img/base1-4/low.webp", 102, 102, "BS");
await seed.run("base2-4", "Charizard", "base2", "Base Set 2", "4", "2000-02-24", "https://img/base2-4/low.webp", 130, 130, "B2");
await seed.run("sv03.5-25", "Pikachu", "sv03.5", "151", "25", "2023-09-22", "https://img/sv03.5-25/low.webp", 165, 207, "MEW");
await seed.run("sv03.5-173", "Pikachu", "sv03.5", "151", "173", "2023-09-22", "https://img/sv03.5-173/low.webp", 165, 207, "MEW");
await seed.run("swshp-1", "Grookey", "swshp", "SWSH Black Star Promos", "SWSH001", "2019-11-15", "https://img/swshp-1/low.webp", null, null, "SWSHP");
await db.prepare("INSERT INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES (?, ?, ?, ?)").run(777, 1, "base2-4", "pokemon");
// $100+ needs a real history (the site price guard): a liquid 60-day series ending on the price.
const { liquidPrices, junkPrices, recordSeries } = await import("./lib/liquid-series.mjs");
const { addDays, todayUtc } = await import(at("lib/priceSeries.ts"));
await recordSeries(recordPoint, addDays, todayUtc(), "base1-4", "pokemon", "holofoil", liquidPrices(800));
await recordSeries(recordPoint, addDays, todayUtc(), "base2-4", "pokemon", "holofoil", liquidPrices(400));
await recordPoint("sv03.5-25", "pokemon", "normal", "tcgplayer", "USD", 10);

const csv = [
  "TCGplayer Id,Product Line,Set Name,Product Name,Number,Condition,Quantity,Purchase Price,Language",
  "777,Pokemon,Whatever,Charizard,4/102,Near Mint,1,300,English", // id wins over the set/number text
  ",Pokemon,Base Set,Charizard,4/102,Lightly Played Holofoil,2,,English", // name+number+set, ×2, LP
  ",Pokemon,Base Set,Charizard,4/102,Near Mint 1st Edition,1,,English", // the twin
  ",Pokemon,Base Set 2,Charizard,4,Near Mint,1,,English", // no total: set name settles it
  ",Pokemon,151,Pikachu,025/165,NM,1,3.50,English", // padded number, set as digits
  ",Pokemon,Jungle,Charizard,4,Near Mint,1,,English", // wrong set → doubt, still matched
  ",Pokemon,151,Pikachu,,Near Mint,1,,English", // no number, two Pikachu in 151 → doubt
  ",Pokemon,SWSH Black Star Promos,Grookey,SWSH001,Near Mint,1,,English", // promo number with code
  ",Pokemon,Obsidian Flames,Charizard ex,125/197,Near Mint,1,,English", // not in the mirror
  ",Magic: The Gathering,Alpha,Black Lotus,232,Near Mint,1,,English", // wrong game
  ",Pokemon,151,Pikachu,25,Near Mint,1,,Japanese", // wrong language
  ",Pokemon,Scarlet & Violet,Scarlet & Violet Booster Box,,Near Mint,1,,English", // sealed
].join("\n");

const p = await previewImport(csv);
const row = (line) => p.rows.find((r) => r.line === line);
check("TCGplayer id resolves exactly, ignoring the text", [row(2).status, row(2).catalogCardId, row(2).paid], ["ok", "base2-4", 300]);
check("name+number+set, LP priced by condition, ×2", [row(3).status, row(3).catalogCardId, row(3).quantity, row(3).price], ["ok", "base1-4", 2, askingPriceFor(800, "Lightly Played")]);
check("1st Edition picks the twin", [row(4).status, row(4).catalogCardId, row(4).firstEdition], ["ok", "base1-4-1st", true]);
check("bare number, set name settles Base Set 2", [row(5).status, row(5).catalogCardId], ["ok", "base2-4"]);
check("padded number, numeric set name", [row(6).status, row(6).catalogCardId, row(6).price, row(6).paid], ["ok", "sv03.5-25", askingPriceFor(10, "Near Mint"), 3.5]);
// Newest printing wins a tie the file can't settle (the ranker's rule: the cheaper reprint is the safer wrong answer).
check("unknown set → doubt, newest printing kept", [row(7).status, row(7).catalogCardId, row(7).reason], ["check", "base2-4", 'Set "Jungle" not found — matched Base Set 2']);
check("no number, two in the set → doubt", [row(8).status, row(8).reason], ["check", "No card number in the file — check the printing"]);
check("promo number with code", [row(9).status, row(9).catalogCardId, row(9).price], ["ok", "swshp-1", 0]);
check("not in the catalog → skipped", [row(10).status, row(10).reason], ["skip", "Not in our catalog"]);
check("Magic → skipped", [row(11).status, row(11).reason], ["skip", "Only Pokémon imports for now"]);
check("Japanese → skipped", [row(12).status, row(12).reason], ["skip", "Only English cards for now (japanese)"]);
check("sealed → skipped", [row(13).status, row(13).reason], ["skip", "Sealed products can't be added to CardFlip — single cards only"]);
check("totals", [p.cards, p.matched, p.doubtful, p.skipped, p.truncated], [9, 6, 2, 4, false]);
check("value = priced rows × quantity", p.value, Math.round((askingPriceFor(400, "Near Mint") + 2 * askingPriceFor(800, "Lightly Played") + askingPriceFor(400, "Near Mint") + askingPriceFor(10, "Near Mint") + askingPriceFor(400, "Near Mint") + askingPriceFor(10, "Near Mint")) * 100) / 100);

console.log("\nthe price guard");
await seed.run("col1-20", "Rayquaza", "col1", "Call of Legends", "20", "2011-02-09", "https://img/col1-20/low.webp", 95, 95, "CL");
await recordSeries(recordPoint, addDays, todayUtc(), "col1-20", "pokemon", "holofoil", junkPrices(500)); // a 5x spike that never came back (hidden); a flat series is a note now, not a hide
const flagged = await previewImport("Name,Set,Number,Quantity\nRayquaza,Call of Legends,20/95,1\nCharizard,Base Set,4/102,1");
const [junkRow, fineRow] = flagged.rows;
check("a flagged market imports unpriced, with the flag for the review", [junkRow.status, junkRow.price, junkRow.flag], ["ok", 0, { hard: true, reason: "spike 5.0x still 5.0x" }]);
check("a normal card next to it is priced as before", [fineRow.price, fineRow.flag], [askingPriceFor(800, "Near Mint"), undefined]);
check("the flagged card adds nothing to the value", flagged.value, askingPriceFor(800, "Near Mint"));

console.log("\ncap");
const big = "Name,Set,Number,Quantity\n" + Array.from({ length: 12 }, () => "Pikachu,151,25,50").join("\n");
const capped = await previewImport(big);
check("500 cards then the rest is over the limit", [capped.cards, capped.truncated, capped.truncatedBy, capped.rows.filter((r) => r.status === "skip").length], [MAX_IMPORT_CARDS, true, "file", 2]);
console.log("\nscans (every imported card is one scan)");
const scanCapped = await previewImport(csv, 4);
// The balance check runs before the catalog lookup, so the unknown-card row is "waiting" too (6 rows), never a wasted lookup.
check("4 scans left → 4 cards, the rest wait", [scanCapped.cards, scanCapped.truncatedBy, scanCapped.scansLeft, scanCapped.rows.filter((r) => r.reason?.startsWith("Only 4 scans left")).length], [4, "scans", 4, 6]);
check("a ×2 row is split at the balance", scanCapped.rows.find((r) => r.line === 3).quantity, 2);
const none = await previewImport(csv, 0);
check("0 scans left → nothing to import, reasons say so", [none.cards, none.rows.filter((r) => r.reason?.startsWith("You're out of scans")).length], [0, 9]);
check("null = unlimited", (await previewImport(csv, null)).cards, 9);

console.log("\ncommit");
const u = await createUser("Seller", "seller@example.com", "hunter22", "user");
const result = await commitImport(u.id, csv, [7]);
check("one row per copy, unticked line 7 left out", result.created, 8);
const cards = await listCardsForUser(u.id);
const byCatalog = (id) => cards.filter((c) => c.catalogCardId === id);
check("Charizard LP ×2 written verified with the condition + price", byCatalog("base1-4").map((c) => [c.condition, c.price, c.verifiedAt != null, c.matchDoubt]), [["Lightly Played", askingPriceFor(800, "Lightly Played"), true, null], ["Lightly Played", askingPriceFor(800, "Lightly Played"), true, null]]);
check("twin row carries firstEdition", byCatalog("base1-4-1st").map((c) => c.firstEdition), [true]);
check("cost basis from the file", byCatalog("base2-4").map((c) => c.costBasis).sort((a, b) => (a ?? 0) - (b ?? 0)), [null, 300]);
check("doubtful row is unverified with the reason", byCatalog("sv03.5-25").map((c) => [c.verifiedAt != null, c.matchDoubt]).sort((a, b) => Number(a[0]) - Number(b[0])), [[false, "No card number in the file — check the printing"], [true, null]]);
check("unpriced promo has no scan price", byCatalog("swshp-1").map((c) => [c.price, c.scanPrice]), [[0, null]]);
check("imported rows are tagged", new Set(cards.map((c) => c.category)).size === 1 && cards[0].category, "Imported");

console.log("\nreserving scans (Chris 09-30: taken before any card is written, given back when unused)");
const { reserveScans, giveBackScans, scanQuota } = await import(at("lib/server/scanQuota.ts"));
const { findUserById, PLAN_SCANS } = await import(at("lib/server/users.ts"));
// The same hooks the import route hands commitImport.
const hooksFor = (user) => {
  const s = { held: null, given: 0 };
  return { s, reserve: async (n) => { s.held = await reserveScans(user, n); return s.held.taken; }, release: async (n) => { s.given = n; await giveBackScans(user, s.held, n); } };
};
const setBalance = (id, plan, bonus, pack) =>
  db.prepare("UPDATE users SET sub_status = 'active', plan = 'standard', plan_scans = ?, bonus_scans = ?, extra_scans = ? WHERE id = ?").run(plan, bonus, pack, id);
// A subscriber with 3 plan scans, 2 bonus, 5 pack: 8 imported cards take the plan balance, the bonus, then 3 of the pack.
await setBalance(u.id, 3, 2, 5);
let sub = await findUserById(u.id);
const q = (await reserveScans(sub, 8)).usage;
check("plan balance first, then bonus, then pack", [q.plan, q.bonus, q.pack, q.remaining], [0, 0, 2, 2]);
sub = await findUserById(u.id);
check("written to the row", [sub.planScans, sub.bonusScans, sub.extraScans], [0, 0, 2]);
check("zero is a no-op", (await reserveScans(sub, 0)).usage.remaining, 2);
const cap = scanQuota(sub).remaining;
const h1 = hooksFor(sub);
const commitCapped = await commitImport(u.id, csv, [], cap, h1);
check("commit honours the balance, takes exactly what it writes, gives nothing back", [commitCapped.created, h1.s.held.taken, h1.s.given, (await findUserById(u.id)).extraScans], [2, 2, 0, 0]);

// A file bigger than the balance (the caller passes no cap): only the paid-for cards are written.
await setBalance(u.id, 5, 0, 0);
const h2 = hooksFor(await findUserById(u.id));
const big2 = await commitImport(u.id, csv, [], null, h2);
check("a balance of 5 against a 9-card file writes 5 cards, never one it did not pay for", [big2.created, (await findUserById(u.id)).planScans], [5, 0]);

// Double submit: two commits in flight against one balance of 6.
await setBalance(u.id, 6, 0, 0);
const sub6 = await findUserById(u.id);
const [d1, d2] = await Promise.all([commitImport(u.id, csv, [], null, hooksFor(sub6)), commitImport(u.id, csv, [], null, hooksFor(sub6))]);
check("double submit with 6 scans: 6 cards in all, balance zero, never negative", [d1.created + d2.created, (await findUserById(u.id)).planScans], [6, 0]);

// A card write that throws: the scans for the cards never written go back.
await setBalance(u.id, 20, 0, 0);
const realPrepare = db.prepare.bind(db);
let inserts = 0;
db.prepare = (sql) => {
  if (/INSERT INTO cards/.test(sql) && ++inserts === 4) throw new Error("db down");
  return realPrepare(sql);
};
const h3 = hooksFor(await findUserById(u.id));
let writeThrew = false;
try { await commitImport(u.id, csv, [], null, h3); } catch { writeThrew = true; }
db.prepare = realPrepare;
check("a failing write throws, and the scans for the cards not written are given back",
  [writeThrew, h3.s.held.taken, h3.s.given, (await findUserById(u.id)).planScans], [true, 9, 6, 20 - 3]);
if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
