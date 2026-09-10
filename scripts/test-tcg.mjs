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
const { searchTcgCardsLocal, splitOnePieceNumber, hasTcgMirror } = await import(at("lib/server/tcgCards.ts"));
const { GAMES, GAME_IDS, isGameId, parseGame, displayCardNumber } = await import(at("lib/games.ts"));
const { isNearTie } = await import(at("lib/tiebreak.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

check("registry lists both games", GAME_IDS.includes("lorcana") && GAME_IDS.includes("onepiece"));
check("isGameId accepts them", isGameId("lorcana") && isGameId("onepiece") && !isGameId("yugioh"));
check("parseGame falls back to Pokémon", parseGame("yugioh"), "pokemon");
check("eBay Game aspects set", Boolean(GAMES.lorcana.ebayGameAspect) && Boolean(GAMES.onepiece.ebayGameAspect));
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
check("rankScore exposed", typeof (await searchTcgCardsLocal("onepiece", "Nami", null, 5))[0]?.rankScore === "number");
check("Lorcana card name carries the version", (await searchTcgCardsLocal("lorcana", "Ariel", pn("1", 204), 1))[0]?.name, "Ariel - On Human Legs");

console.log(failures === 0 ? "\nAll TCG checks passed" : `\n${failures} TCG check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
