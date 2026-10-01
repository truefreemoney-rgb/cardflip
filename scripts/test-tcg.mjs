/**
 * Lorcana / One Piece ranking (lib/server/tcgCards.ts) and the game registry
 * bits the new games rely on. Run: npm run test:tcg
 *
 * Pins: exact name + number first; the Lorcana version line separates two
 * cards of one name; the One Piece id carries its set; enchanted / parallel
 * variants win only when seen; a bare id identifies with no name; rankScore
 * rides along for the picture tiebreak; the game registry knows both games.
 * Throwaway-db trick as in test-mirror.mjs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-tcg-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { db } = await import(at("lib/db.ts"));
const { searchTcgCardsLocal, splitOnePieceNumber, hasTcgMirror, yugiohKey } = await import(at("lib/server/tcgCards.ts"));
const { GAMES, GAME_IDS, isGameId, parseGame, displayCardNumber } = await import(at("lib/games.ts"));
const { isNearTie } = await import(at("lib/tiebreak.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

check("registry lists both games", GAME_IDS.includes("lorcana") && GAME_IDS.includes("onepiece"));
check("isGameId accepts them", isGameId("lorcana") && isGameId("onepiece") && isGameId("yugioh") && !isGameId("digimon"));
check("parseGame falls back to Pokémon", parseGame("digimon"), "pokemon");
check("eBay Game aspects set", Boolean(GAMES.lorcana.ebayGameAspect) && Boolean(GAMES.onepiece.ebayGameAspect) && Boolean(GAMES.yugioh.ebayGameAspect));
check("Yu-Gi-Oh! number displays as printed", displayCardNumber({ number: "LOB-EN005", setTotal: 126, game: "yugioh" }), "LOB-EN005");
check("Yu-Gi-Oh! key drops the language letters", [yugiohKey("lob-en005"), yugiohKey("LOB-005"), yugiohKey("SDY-E005"), yugiohKey("Dark Magician")], ["LOB-005", "LOB-005", "SDY-005", null]);
{
  const { foilChoices, foilLabel } = await import(at("lib/yugioh.ts"));
  const pick = { id: "a-1st", number: "RA02-EN001", rarity: "Secret Rare", variant: "secret-rare" };
  const rows = [pick, { id: "a", number: "RA02-EN001", rarity: "Secret Rare", variant: "secret-rare" }, { id: "b-1st", number: "RA02-EN001", rarity: "Super Rare", variant: "" }, { id: "b", number: "RA02-EN001", rarity: "Super Rare", variant: "" }, { id: "c-1st", number: "RA02-EN001", rarity: "Super Rare", variant: "alt-art" }, { id: "d", number: "LOB-EN001", rarity: "Ultra Rare", variant: "" }];
  check("Which foil: one chip per foil of the code, pick first, 1st Edition side kept", foilChoices(pick, rows).map((c) => c.id), ["a-1st", "b-1st", "c-1st"]);
  check("Which foil: a code in one foil asks nothing", foilChoices(rows[5], rows), []);
  check("foil label names tagged faces, not repeats", [foilLabel(rows[4]), foilLabel(pick), foilLabel({ rarity: "Ultra Rare", variant: "purple" }), foilLabel({ rarity: "Starfoil Rare", variant: "starfoil" })], ["Super Rare (Alt Art)", "Secret Rare", "Ultra Rare (Purple)", "Starfoil Rare"]);
}
check("Yu-Gi-Oh! key keeps a letter before the digits + tokens", [yugiohKey("MVP1-ENG53"), yugiohKey("LDK2-ENK14"), yugiohKey("SR03-ENTKN")], ["MVP1-G53", "LDK2-K14", "SR03-TKN"]);
check("One Piece number displays as printed", displayCardNumber({ number: "OP01-077", game: "onepiece" }), "OP01-077");
check("Lorcana number displays as a fraction", displayCardNumber({ number: "42", setTotal: 204, game: "lorcana" }), "42/204");
check("split OP id", splitOnePieceNumber("op01-077"), { setCode: "OP01", number: "OP01-077" });
check("split plain number", splitOnePieceNumber("77"), { setCode: null, number: "77" });
check("empty mirror reports missing", await hasTcgMirror("lorcana"), false);

for (const [id, game, name, subtitle, set, setName, num, total, date, rarity, variant, usd, foil] of [
  ["l-ariel-1", "lorcana", "Ariel", "On Human Legs", "1", "The First Chapter", "1", 204, "2023-08-18", "Uncommon", "", 0.21, 0.82],
  ["l-ariel-2", "lorcana", "Ariel", "Spectacular Singer", "1", "The First Chapter", "2", 204, "2023-08-18", "Super_rare", "", 3.1, 9.5],
  ["l-ariel-3", "lorcana", "Ariel", "Spectacular Singer", "3", "Into the Inklands", "2", 204, "2024-02-23", "Super_rare", "", 1.1, 4.5],
  ["l-hades-e", "lorcana", "Hades", "King of Olympus", "1", "The First Chapter", "205", 204, "2023-08-18", "Enchanted", "enchanted", null, 126.7],
  ["l-hades-b", "lorcana", "Hades", "King of Olympus", "1", "The First Chapter", "6", 204, "2023-08-18", "Legendary", "", 2.5, 8.0],
  ["op-zoro", "onepiece", "Roronoa Zoro", "", "OP01", "Romance Dawn", "OP01-001", null, "", "L", "", 2.12, null],
  ["op-zoro-p1", "onepiece", "Roronoa Zoro", "", "OP01", "Romance Dawn", "OP01-001", null, "", "L", "parallel", 568, null],
  ["op-zoro-st", "onepiece", "Roronoa Zoro", "", "ST01", "Straw Hat Crew", "ST01-013", null, "", "C", "", 0.3, null],
  ["op-nami", "onepiece", "Nami", "", "OP01", "Romance Dawn", "OP01-016", null, "", "R", "", 1.0, null],
  ["op-nami-2", "onepiece", "Nami", "", "OP03", "Pillars of Strength", "OP03-040", null, "2023-06-30", "L", "", 4.0, null],
  // 09-10 panel misses (run 3): rarity token in the read number, a full-art
  // read against a special + reprint twin, a feed key with its _r1 suffix,
  // and a catalog name carrying the number.
  ["op-buggy-p084", "onepiece", "Buggy", "", "OP17", "Promo", "P-084", null, "", "SP", "special", 40, null],
  ["op-buggy-st30", "onepiece", "Buggy", "", "ST30", "Starter 30", "ST30-011", null, "", "L", "full-art", 5, null],
  ["op-shanks", "onepiece", "Shanks", "", "ST16", "Starter 16", "ST16-004", null, "2023-01-01", "L", "", 1, null],
  ["op-shanks-sp", "onepiece", "Shanks", "", "OP11", "A Fist of Divine Speed", "ST16-004", null, "2025-01-01", "L", "special", 30, null],
  ["op-shanks-r1", "onepiece", "Shanks", "", "PRB02", "Premium Booster 2", "ST16-004", null, "2025-06-01", "L", "reprint", 1, null],
  ["op-sanji-r1", "onepiece", "Sanji", "", "ST15", "Starter 15", "P-029_r1", null, "", "C", "reprint", 1, null],
  ["op-law", "onepiece", "Trafalgar Law - OP05-069", "", "OP05", "Awakening", "OP05-069", null, "", "SR", "", 3, null],
  ["op-law-2", "onepiece", "Trafalgar Law", "", "OP01", "Romance Dawn", "OP01-047", null, "", "L", "", 2, null],
  // Glare read "OP10-018" off OP13-118 (09-10 seller photo): the one-off
  // row OP10-118 leads, the two-off rows must sit inside the tiebreak gap.
  ["op-luffy-10", "onepiece", "Monkey.D.Luffy", "", "OP10", "Royal Blood", "OP10-118", null, "2025-01-01", "SEC", "", 5, null],
  ["op-luffy-10-p1", "onepiece", "Monkey.D.Luffy", "", "OP10", "Royal Blood", "OP10-118", null, "2025-01-01", "SEC", "parallel", 43, null],
  ["op-luffy-10-111", "onepiece", "Monkey.D.Luffy", "", "OP10", "Royal Blood", "OP10-111", null, "2025-01-01", "R", "parallel", 3, null],
  ["op-luffy-13", "onepiece", "Monkey.D.Luffy", "", "OP13", "Carrying On His Will", "OP13-118", null, "2025-09-01", "SEC", "", 12, null],
  ["op-luffy-13-p1", "onepiece", "Monkey.D.Luffy", "", "OP13", "Carrying On His Will", "OP13-118", null, "2025-09-01", "SEC", "parallel", 80, null],
  // Event card whose art the read names ("Cross Guild" read as Buggy OP09-057, 09-30 seller photo).
  ["op-crossguild", "onepiece", "Cross Guild", "", "OP09", "Emperors in the New World", "OP09-057", null, "2024-12-01", "R", "", 1, null],
  ["op-crossguild-p1", "onepiece", "Cross Guild", "", "OP09", "Emperors in the New World", "OP09-057", null, "2024-12-01", "R", "manga", 60, null],
  ["op-buggy-051-p1", "onepiece", "Buggy", "", "OP09", "Emperors in the New World", "OP09-051", null, "2024-12-01", "SR", "alt-art", 20, null],
  // Three digits lost to glare ("OP06-119" read as "OP06-093", 09-30 seller photo): name + set prefix survive.
  ["op-sanji-119", "onepiece", "Sanji", "", "OP06", "Wings of the Captain", "OP06-119", null, "2024-03-01", "SEC", "", 5, null],
  ["op-sanji-119-p1", "onepiece", "Sanji", "", "OP06", "Wings of the Captain", "OP06-119", null, "2024-03-01", "SEC", "alt-art", 32, null],
  ["op-sanji-op01", "onepiece", "Sanji", "", "OP01", "Romance Dawn", "OP01-013", null, "2022-12-01", "R", "alt-art", 9, null],
  ["op-perona-093-p1", "onepiece", "Perona", "", "OP06", "Wings of the Captain", "OP06-093", null, "2024-03-01", "SR", "alt-art", 15, null],
  // Promo printings (10-01, sync-onepiece.mjs --with-promos): set_code PROMO, id "<image id>#promo".
  ["op-gum", "onepiece", "Gum-Gum Lightning", "", "OP09", "Emperors in the New World", "OP09-077", null, "2024-12-01", "UC", "", 0.2, null],
  ["OP09-077#promo", "onepiece", "Gum-Gum Lightning", "", "PROMO", "One Piece Promotion Cards", "OP09-077", null, "", "UC", "premium-card-collection-best-selection-vol-4", 32.4, null],
  ["P-115#promo", "onepiece", "Boa Hancock", "", "PROMO", "One Piece Promotion Cards", "P-115", null, "", "PR", "op15-release-event-winner", 107.42, null],
  ["P-115_pr1#promo", "onepiece", "Boa Hancock", "", "PROMO", "One Piece Promotion Cards", "P-115", null, "", "PR", "op15-release-event", 1.79, null],
  // Yu-Gi-Oh! (09-29): shapes from the TCGplayer sync — the first LOB run
  // prints "LOB-005", 1st Edition is a "-1st" twin, one reprint code in two rarities.
  ["ygo-21876", "yugioh", "Dark Magician", "", "LOB", "The Legend of Blue Eyes White Dragon", "LOB-005", null, "2002-03-08", "Ultra Rare", "", 42.7, null],
  ["ygo-21876-1st", "yugioh", "Dark Magician", "", "LOB", "The Legend of Blue Eyes White Dragon", "LOB-005", null, "2002-03-08", "Ultra Rare", "", 1207.76, null],
  ["ygo-22612", "yugioh", "Dark Magician", "", "SDY", "Starter Deck: Yugi", "SDY-006", null, "2002-03-29", "Ultra Rare", "", 33.1, null],
  ["ygo-ra01-ur", "yugioh", "Dark Magician", "", "RA01", "25th Anniversary Rarity Collection", "RA01-EN052", null, "2023-11-03", "Ultra Rare", "", 1.5, null],
  ["ygo-ra01-qcsr", "yugioh", "Dark Magician", "", "RA01", "25th Anniversary Rarity Collection", "RA01-EN052", null, "2023-11-03", "Quarter Century Secret Rare", "quarter-century-secret-rare", 30, null],
  ["ygo-bewd", "yugioh", "Blue-Eyes White Dragon", "", "LOB", "The Legend of Blue Eyes White Dragon", "LOB-001", null, "2002-03-08", "Ultra Rare", "", 90, null],
]) {
  await db
    .prepare(
      `INSERT INTO tcg_cards (id, game, name, subtitle, set_code, set_name, collector_number, set_total, set_release_date, rarity, variant, image_url, price_usd, price_usd_foil, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 0)`,
    )
    .run(id, game, name, subtitle, set, setName, num, total, date, rarity, variant, usd, foil);
}
const pn = (number, setTotal = null, setCode = null) => ({ number, setTotal, setCode, isSecretRare: false });
const top = async (game, name, printed, sub = null, variant = null) => (await searchTcgCardsLocal(game, name, printed, 5, sub, variant))[0]?.id ?? null;

check("mirror present", await hasTcgMirror("lorcana"));
check("Lorcana: name + number + total → the card", await top("lorcana", "Ariel", pn("2", 204)), "l-ariel-3");
check("Lorcana: set number picks the printing of a reprinted version", await top("lorcana", "Ariel", pn("2", 204, "1")), "l-ariel-2");
check("Lorcana: the version line separates two Ariels with no number read", await top("lorcana", "Ariel", null, "On Human Legs"), "l-ariel-1");
check("Lorcana: enchanted number above the total lands on the enchanted row", await top("lorcana", "Hades", pn("205", 204)), "l-hades-e");
check("Lorcana: no number, 'enchanted' seen → enchanted", await top("lorcana", "Hades", null, null, "enchanted"), "l-hades-e");
check("Lorcana: no number, nothing seen → the plain print", await top("lorcana", "Hades", null, null, null), "l-hades-b");
check("Lorcana: fraction alone identifies with no name", await top("lorcana", "", pn("6", 204)), "l-hades-b");
check("One Piece: id alone identifies", await top("onepiece", "", pn("OP01-001")), "op-zoro");
check("One Piece: name + id, nothing special seen → base print", await top("onepiece", "Roronoa Zoro", pn("OP01-001"), null, "standard"), "op-zoro");
check("One Piece: parallel seen → the parallel row", await top("onepiece", "Roronoa Zoro", pn("OP01-001"), null, "parallel"), "op-zoro-p1");
check("One Piece: the id's set beats a same-name card in another set", await top("onepiece", "Roronoa Zoro", pn("ST01-013")), "op-zoro-st");
check("One Piece: base vs parallel with no variant read is a near-tie for the picture",
  isNearTie(await searchTcgCardsLocal("onepiece", "Roronoa Zoro", pn("OP01-001"), 5, null, null)));
check("One Piece: rarity token before the number is ignored ('SP P-084')", await top("onepiece", "Buggy", pn("SP P-084"), null, "full-art"), "op-buggy-p084");
check("One Piece: full-art read prefers the special row over the plain reprint twin", await top("onepiece", "Shanks", pn("ST16-004"), null, "full-art"), "op-shanks-sp");
check("One Piece: a feed key with its _r1 suffix still matches the printed number", await top("onepiece", "Sanji", pn("P-029")), "op-sanji-r1");
check("One Piece: a catalog name carrying the number still counts as an exact name", await top("onepiece", "Trafalgar Law", pn("OP05-069")), "op-law");
check("One Piece: a one-digit number misread with an exact name lands on the nearest number", await top("onepiece", "Nami", pn("OP01-017")), "op-nami");
{
  const { tiebreakIds } = await import(at("lib/tiebreak.ts"));
  const { onePieceKey, printingChoices, printingLabel } = await import(at("lib/onepiece.ts"));
  const found = await searchTcgCardsLocal("onepiece", "Monkey.D.Luffy", pn("OP10-018", null, "OP10"), 8, null, "parallel");
  check("One Piece: two-digit misread — the one-off row still leads", found[0]?.id, "op-luffy-10-p1");
  check("One Piece: two-digit misread — digits read as 0 (glare) rank before a firmly read digit", found.map((c) => c.id).indexOf("op-luffy-13-p1") < found.map((c) => c.id).indexOf("op-luffy-10-111"));
  check("One Piece: the picture tiebreak sees each number once, the two-off card included", tiebreakIds(found, "onepiece"), ["op-luffy-10-p1", "op-luffy-13-p1", "op-luffy-10-111"]);
  const cg = await searchTcgCardsLocal("onepiece", "Buggy", pn("OP09-057", null, "OP09"), 8, null, "full-art");
  check("One Piece: the read key's own card joins the candidates and reaches the picture next to the same-name digit-off row",
    tiebreakIds(cg, "onepiece").map((id) => id.replace(/-p1$/, "")).sort(), ["op-buggy-051", "op-crossguild"]);
  const sj = await searchTcgCardsLocal("onepiece", "Sanji", pn("OP06-093", null, "OP06"), 8, null, "parallel");
  check("One Piece: three digits lost — that name's card in the read set reaches the picture next to the read key's card",
    tiebreakIds(sj, "onepiece"), ["op-perona-093-p1", "op-sanji-op01", "op-sanji-119-p1"]);
  check("One Piece: a key that names nothing — the read set's card of that name leads the other sets",
    await top("onepiece", "Sanji", pn("OP06-240", null, "OP06"), null, "parallel"), "op-sanji-119-p1");
  const shaky = await searchTcgCardsLocal("onepiece", "Monkey.D.Luffy", { ...pn("OP10-118", null, "OP10"), shaky: true }, 8, null, "parallel");
  check("One Piece: a shaky read that names a real card still leads with it", shaky[0]?.id, "op-luffy-10-p1");
  check("One Piece: a shaky read — the same name one character off reaches the picture",
    tiebreakIds(shaky, "onepiece"), ["op-luffy-10-p1", "op-luffy-13-p1", "op-luffy-10-111"]);
  check("One Piece: a firm read of the same key asks the picture only about its own printings",
    tiebreakIds(await searchTcgCardsLocal("onepiece", "Monkey.D.Luffy", pn("OP10-118", null, "OP10"), 8, null, "parallel"), "onepiece").every((id) => id.startsWith("op-luffy-10") && id !== "op-luffy-10-111"));
  check("One Piece: a promo key with a name the catalog does not hold (Japanese print) still finds the card",
    await top("onepiece", "モンキー・D・ルフィ", pn("P-084", null, "P"), null, "parallel"), "op-buggy-p084");
  check("One Piece: a key alone finds its reprint filed under another set",
    await top("onepiece", "", pn("ST16-004", null, "ST16"), null, "full-art"), "op-shanks-sp");
  {
    const gum = await searchTcgCardsLocal("onepiece", "Gum-Gum Lightning", pn("OP09-077", null, "OP09"), 8, null, "standard");
    check("One Piece promos: the regular card leads its promo printing, and the promo is offered", gum.map((c) => c.id), ["op-gum", "OP09-077#promo"]);
    check("One Piece promos: a promo printing behind a regular card costs no picture call", tiebreakIds(gum, "onepiece"), []);
    const boa = await searchTcgCardsLocal("onepiece", "Boa Hancock", pn("P-115", null, "P"), 8, null, "standard");
    check("One Piece promos: a promo-only number leads with its cheapest printing", boa.map((c) => c.id), ["P-115_pr1#promo", "P-115#promo"]);
    check("One Piece promos: two promo printings of one number cost no picture call (the seller's tap decides)", tiebreakIds(boa, "onepiece"), []);
    check("One Piece promos: both printings are in 'Which printing is yours?'", printingChoices(boa[0], boa).map((c) => printingLabel(c)), ["OP15 Release Event · PR", "OP15 Release Event Winner · PR"]);
    check("One Piece promos: labels", [printingLabel({ rarity: "UC", variant: "premium-card-collection-best-selection-vol-4", setCode: "PROMO" }), printingLabel({ rarity: "PR", variant: "cs-2023-celebration-pack", setCode: "PROMO" }), printingLabel({ rarity: "PR", variant: "promo-pr2", setCode: "PROMO" }), printingLabel({ rarity: "PR", variant: "alt-art", setCode: "PROMO" })],
      ["Premium Card Collection Best Selection Vol 4 · UC", "CS 2023 Celebration Pack · PR", "Promo · PR", "Promo Alt Art · PR"]);
    const { listTcgSets } = await import(at("lib/server/tcgCards.ts"));
    check("One Piece promos: not a set in the By set browser", (await listTcgSets("onepiece")).some((s) => s.code.startsWith("PROMO|")), false);
  }
  check("One Piece: base vs parallel of one number still sends #1 and #2",
    tiebreakIds(await searchTcgCardsLocal("onepiece", "Roronoa Zoro", pn("OP01-001"), 5, null, null), "onepiece").length, 2);
  check("One Piece key drops the printing suffix", [onePieceKey("OP13-118_p2"), onePieceKey("p-030_r1"), onePieceKey("OP04-056_p2#2072"), onePieceKey("OP01-001")], ["OP13-118", "P-030", "OP04-056", "OP01-001"]);
  const rows = [
    { id: "b", number: "OP13-118", rarity: "SEC", variant: "", setCode: "OP13", imageSmall: "b.jpg" },
    { id: "p", number: "OP13-118", rarity: "SEC", variant: "parallel", setCode: "OP13", imageSmall: "b.jpg" },
    { id: "a2", number: "OP13-118", rarity: "SEC", variant: "alt-art", setCode: "OP13", imageSmall: "a2.jpg" },
    { id: "a3", number: "OP13-118", rarity: "SEC", variant: "alt-art", setCode: "OP13", imageSmall: "a3.jpg" },
    { id: "r", number: "OP13-118_r1", rarity: "SEC", variant: "reprint", setCode: "PRB03", imageSmall: "b.jpg" },
    { id: "other", number: "OP10-118", rarity: "SEC", variant: "", setCode: "OP10", imageSmall: "o.jpg" },
  ];
  check("Which printing: one chip per printing of the number, pick first, two alt arts kept apart by picture", printingChoices(rows[1], rows).map((c) => c.id), ["p", "b", "a2", "a3", "r"]);
  check("Which printing: a number in one printing asks nothing", printingChoices(rows[5], rows), []);
  check("printing labels", [printingLabel(rows[0]), printingLabel(rows[1]), printingLabel(rows[4]), printingLabel({ rarity: "R", variant: "op15-109" }), printingLabel({ rarity: "SR", variant: "bentham" })], ["Standard · SEC", "Parallel · SEC", "Reprint (PRB03) · SEC", "Alt Art · R", "Bentham · SR"]);
}
const ygo = async (name, number, rarity = null, first = null) => (await searchTcgCardsLocal("yugioh", name, number ? pn(number) : null, 5, null, rarity, first))[0]?.id ?? null;
check("Yu-Gi-Oh!: LOB-EN005 read finds the LOB-005 row", await ygo("Dark Magician", "LOB-EN005", null, false), "ygo-21876");
check("Yu-Gi-Oh!: 1st Edition stamp seen → the -1st twin", await ygo("Dark Magician", "LOB-EN005", "ultra-rare", true), "ygo-21876-1st");
check("Yu-Gi-Oh!: set code alone identifies", await ygo("", "SDY-006"), "ygo-22612");
check("Yu-Gi-Oh!: rarity read separates one code's Ultra from its Quarter Century", await ygo("Dark Magician", "RA01-EN052", "quarter-century-secret-rare"), "ygo-ra01-qcsr");
check("Yu-Gi-Oh!: nothing seen on a two-rarity code → the plain untagged row", await ygo("Dark Magician", "RA01-EN052"), "ygo-ra01-ur");
check("Yu-Gi-Oh!: a hyphenated name matches folded", await ygo("Blue-Eyes White Dragon", null), "ygo-bewd");
check("Yu-Gi-Oh!: a misread code with the name exact still lands on the name", await ygo("Blue-Eyes White Dragon", "LOB-O01"), "ygo-bewd");
check("rankScore exposed", typeof (await searchTcgCardsLocal("onepiece", "Nami", null, 5))[0]?.rankScore === "number");
check("Lorcana card name carries the version", (await searchTcgCardsLocal("lorcana", "Ariel", pn("1", 204), 1))[0]?.name, "Ariel - On Human Legs");

console.log(failures === 0 ? "\nAll TCG checks passed" : `\n${failures} TCG check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
