// One Piece picture picker (scripts/lib/onepiecePick.mjs, 10-25): the measured cases from the 361 wrong pictures
// of 10-24, on real tcgcsv products + our rows frozen in scripts/fixtures/onepiece-pick.json (scripts/_op-pick-fixture.mjs).
import fs from "node:fs";
import path from "node:path";
import { classOf, pickPictures, sameSet, tagsOf } from "./lib/onepiecePick.mjs";
let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
};
console.log("sameSet: TCGplayer group names vs the feed's set names");
check("ST-05 group = the feed's starter deck name", sameSet("Starter Deck 5: Film Edition", "ST-05: Starter Deck 5 Film Edition"), true);
check("Vol. 2 is another set", [sameSet("Premium Booster -The Best-", "Premium Booster -The Best- Vol. 2"), sameSet("Premium Booster -The Best- Vol. 2", "Premium Booster -The Best-")], [false, false]);
check("another booster is not the set", sameSet("Emperors in the New World", "Premium Booster -The Best- Vol. 2"), false);
console.log("classOf: printing tags");
check("number tag dropped, parallel kept", classOf(tagsOf("Monkey.D.Luffy (003) (Parallel)")), "parallel");
check("manga beats alternate art", classOf(tagsOf("Shanks (Parallel) (Manga) (Alternate Art)")), "manga");
check("a reprint is a base print", classOf(tagsOf("Shanks - OP09-004 (Reprint)")), "base");

const fx = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "onepiece-pick.json"), "utf8"));
const byNumber = new Map();
for (const p of fx.products) {
  if (!byNumber.has(p.number)) byNumber.set(p.number, []);
  byNumber.get(p.number).push({ ...p, cls: classOf(tagsOf(p.name)) });
}
for (const list of byNumber.values()) list.sort((a, b) => a.id - b.id);
const { picks, unmatched } = pickPictures(fx.rows, byNumber);
const pickOf = (id) => picks.find((p) => p.row.id === id)?.pick.id ?? (unmatched.includes(id) ? "Bandai" : "missing");

console.log("pickPictures: the measured cases (10-24 dry run, eyeballed)");
check("OP10-065_p1 Sugar SP -> its own set's SP, not the Judge Pack promo", pickOf("OP10-065_p1"), 671455);
check("OP13-118_p3 $7,500 -> Red Super Alternate Art", pickOf("OP13-118_p3"), 657401);
check("OP13-118_p2 $2,116.43 -> Super Alternate Art", pickOf("OP13-118_p2"), 657402);
check("OP17-062#3630 $172.30 -> Super Alternate Art", pickOf("OP17-062#3630"), 712091);
check("OP17-062_p1 $12.95 -> Alternate Art", pickOf("OP17-062_p1"), 707135);
check("OP09-004_p6 silver -> SP Silver, not SP Gold", pickOf("OP09-004_p6"), 657443);
check("ST01-012_p3 -> Gold-Stamped Signature", pickOf("ST01-012_p3"), 529850);
check("OP01-120_p2 $1,532.80: no product near its price in its set -> Bandai", pickOf("OP01-120_p2"), "Bandai");
console.log("pickPictures: another set's product never wins on price over the row's own printing (10-25)");
check("OP09-004 base -> its own base, not Premium Booster Vol. 2's reprint", pickOf("OP09-004"), 596924);
check("OP05-069_p2 OP05 manga -> OP05's manga, not the Premium Booster manga", pickOf("OP05-069_p2"), 527019);
check("OP05-069_r1 Premium Booster manga -> the Premium Booster manga", pickOf("OP05-069_r1"), 587959);
check("OP05-066_r1 ST-18 reprint -> ST-18's Jinbe; _r2 ST-26 -> ST-26's", [pickOf("OP05-066_r1"), pickOf("OP05-066_r2")], [581024, 634311]);
check("OP09-089_r1 ST-27 reprint -> ST-27's, not OP09's or the anniversary card", pickOf("OP09-089_r1"), 634322);
check("every base row of its own set keeps that set's base", ["OP13-118", "OP17-062", "OP10-065", "OP01-120"].map(pickOf), [657400, 707133, 617108, 454664]);

console.log(failures === 0 ? "\nAll One Piece picture checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
