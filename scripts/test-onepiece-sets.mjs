// One Piece set repairs (scripts/lib/onepiece-sets.mjs, 10-20): majority set names, tcgcsv release dates.
import { DatabaseSync } from "node:sqlite";
import { fillReleaseDates, fixSetNames, groupCode, releaseDates } from "./lib/onepiece-sets.mjs";
let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
};
console.log("groupCode: tcgcsv abbreviations to our set codes");
check("ST-01 -> ST01", groupCode("ST-01"), "ST01");
check("OP18 stays", groupCode("OP18"), "OP18");
check("a suffixed product (release event, pre-release) never matches", [groupCode("OP18 RE"), groupCode("ST-01 PRE")], [null, null]);
check("blank -> null", groupCode(""), null);
console.log("releaseDates: the earliest date per code, combined codes fall back to the booster");
const dateOf = releaseDates([
  { abbreviation: "OP14", publishedOn: "2026-01-16T00:00:00" },
  { abbreviation: "ST-01", publishedOn: "2022-12-02T00:00:00" },
  { abbreviation: "ST-01 PRE", publishedOn: "2022-09-30T00:00:00" },
  { abbreviation: "EB05", publishedOn: "" },
]);
check("ST01 from ST-01, not the pre-release", dateOf("ST01"), "2022-12-02");
check("OP14EB04 falls back to OP14", dateOf("OP14EB04"), "2026-01-16");
check("no date -> null", [dateOf("EB05"), dateOf("XX99")], [null, null]);
console.log("fixSetNames + fillReleaseDates on a tiny mirror");
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE tcg_cards (id TEXT PRIMARY KEY, game TEXT, set_code TEXT, set_name TEXT, set_release_date TEXT NOT NULL DEFAULT '')`);
const ins = db.prepare("INSERT INTO tcg_cards (id, game, set_code, set_name, set_release_date) VALUES (?, 'onepiece', ?, ?, ?)");
for (let i = 1; i <= 17; i++) ins.run(`ST01-${String(i).padStart(3, "0")}`, "ST01", i === 2 ? "The World's Strongest Warriors" : "Starter Deck 1: Straw Hat Crew", "");
for (let i = 1; i <= 5; i++) ins.run(`OP17-${String(i).padStart(3, "0")}`, "OP17", "The World's Strongest Warriors", "");
ins.run("ST01-002#1", "ST01", "The World's Strongest Warriors", ""); // a hidden duplicate never votes
ins.run("P-001#promo", "PROMO", "One Piece Promotion Cards", "");
ins.run("OP01-001", "OP01", "Romance Dawn", "2022-12-02"); // already dated: untouched
check("the reprint takes the starter deck's name", fixSetNames(db), ["ST01: 2 row(s) -> Starter Deck 1: Straw Hat Crew"]);
check("OP17 keeps its name", db.prepare("SELECT COUNT(*) n FROM tcg_cards WHERE set_code = 'OP17' AND set_name = 'The World''s Strongest Warriors'").get().n, 5);
check("a second pass changes nothing", fixSetNames(db), []);
const groups = [{ abbreviation: "ST-01", publishedOn: "2022-12-02T00:00:00" }, { abbreviation: "OP17", publishedOn: "2026-08-28T00:00:00" }, ...Array.from({ length: 40 }, (_, i) => ({ abbreviation: `ZZ${i}`, publishedOn: "2020-01-01T00:00:00" }))];
const fakeFetch = async () => ({ ok: true, json: async () => ({ results: groups }) });
check("dates land on the blank codes, promos skipped", await fillReleaseDates(db, { fetch: fakeFetch }), { filled: ["ST01=2022-12-02", "OP17=2026-08-28"], missing: [] });
check("every ST01 row is dated", db.prepare("SELECT COUNT(*) n FROM tcg_cards WHERE set_code = 'ST01' AND set_release_date = '2022-12-02'").get().n, 18);
check("the already-dated row kept its date", db.prepare("SELECT set_release_date d FROM tcg_cards WHERE id = 'OP01-001'").get().d, "2022-12-02");
check("a thin groups answer is refused", await fillReleaseDates(db, { fetch: async () => ({ ok: true, json: async () => ({ results: groups.slice(0, 3) }) }) }).catch((e) => e.message), "tcgcsv groups: 3 entries, expected 40+");
console.log(failures === 0 ? "\nAll One Piece set checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
