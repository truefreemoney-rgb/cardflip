// One Piece row <-> TCGplayer product ties and the printings to add (scripts/lib/onepieceTie.mjs, 10-25): the measured
// cases of the 10-25 dry run, on real tcgcsv products + our rows frozen in scripts/fixtures/onepiece-tie.json.
import fs from "node:fs";
import path from "node:path";
import { groupInfo, parseName, productKeys, productPrices, rowKeys, rowsToAdd, tieRows } from "./lib/onepieceTie.mjs";
import { isOnePieceSideline, isOnePieceStampedTwin, onePieceProductPrice, printingLabel } from "../src/lib/onepiece.ts";
let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
};

console.log("parseName: TCGplayer product names");
check("number and tags split off", parseName("Roronoa Zoro - OP06-118 (Alternate Art) [Winner]"), { base: "Roronoa Zoro", tags: ["Alternate Art", "Winner"] });
check("collector-number tags are not printings", parseName("Monkey.D.Luffy (003) (Parallel)").tags, ["Parallel"]);
check("brackets inside a tag stay in it", parseName("Jesus Burgess (Beginners Deck Party [ST-23] - [ST-28] Winner Pack)").tags, ["Beginners Deck Party [ST-23] - [ST-28] Winner Pack"]);

const fx = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "onepiece-tie.json"), "utf8"));
const info = groupInfo(fx.groups);
const byAbbr = (a) => [...info.values()].find((g) => g.abbreviation === a);
console.log("groupInfo: event groups file under their booster");
check("OP08 PRE = pre-release of OP08", [byAbbr("OP08 PRE").stamp, byAbbr("OP08 PRE").parent], ["pre-release", "OP08"]);
check("OP15 RE = release event of OP15-EB04 (same name, another code)", [byAbbr("OP15 RE").stamp, byAbbr("OP15 RE").parent], ["release-event", "OP15EB04"]);
check("OP13 ANN = anniversary of OP13", [byAbbr("OP13 ANN").stamp, byAbbr("OP13 ANN").parent], ["anniversary", "OP13"]);
check("ST-01 PRE = super pre-release of ST01", [byAbbr("ST-01 PRE").stamp, byAbbr("ST-01 PRE").parent], ["super-pre-release", "ST01"]);
check("OP-PR is the promo group; PRB-02 a plain one", [byAbbr("OP-PR").promo, byAbbr("PRB-02").stamp, byAbbr("PRB-02").code], [true, null, "PRB02"]);

const prod = (id) => fx.products.find((p) => p.productId === id);
const keyOf = (id) => productKeys(prod(id), info.get(prod(id).groupId));
console.log("productKeys / rowKeys: one vocabulary");
check("(Parallel) (Manga) (Alternate Art) is the manga", keyOf(454666), "manga");
check("(SP) (Gold) is the gold one", keyOf(657442), "gold");
check("a reprint set's (Reprint) tag says nothing", keyOf(656164), "");
check("LT-01's (Luffy Deck) says which deck, not which printing", keyOf(656670), "");
check("a promo's [Finalist] is part of its printing", keyOf(583757), "finalist+offline-regional-2024-vol-3");
const row = (id) => fx.rows.find((r) => r.id === id);
check("a promo row's tags ride in its name", rowKeys(row("OP01-015_pr4#promo")), "finalist+offline-regional-2024-vol-3");
check("an untagged promo row is its variant slug", rowKeys(row("OP01-015_pr3#promo")), "offline-regional-2024-vol-3");
check("special / spr = TCGplayer's SP", [rowKeys(row("OP09-051_p5")), rowKeys(row("OP08-001_p2"))], ["sp", "sp"]);

const { ties, claimed, untied } = tieRows(fx.rows, fx.products, fx.groups);
const tie = (id) => (ties.has(id) ? `${ties.get(id).how} ${ties.get(id).productId}` : "untied");
console.log("tieRows: the 10-25 morning sort paired these wrong (brackets ignored, one tag enough)");
check("Chopper Offline Regional Vol. 3 [Finalist] $385.48 -> the Finalist product, not the plain one", tie("OP01-015_pr4#promo"), "linked 583757");
check("Chopper Offline Regional Vol. 3 (plain) -> the plain product", tie("OP01-015_pr3#promo"), "linked 586030");
check("Chopper Offline Regional Vol. 3 [Winner] -> the Winner product", tie("OP01-015#promo"), "linked 586029");
check("Hancock Binder Set -> the plain binder card; its Alternate Art row -> the alt art", [tie("OP07-051#promo"), tie("OP07-051_pr1#promo")], ["linked 648100", "linked 648101"]);
console.log("tieRows: today's pictures stand unless the tags say otherwise");
check("Kaido OP17-062#3630 'alt-art' $167.10 keeps the Super Alternate Art", tie("OP17-062#3630"), "kept 712091");
check("Kaido OP17-062_p1 keeps the plain Alternate Art", tie("OP17-062_p1"), "kept 707135");
check("Buggy OP09-051_p2 (feed number OP05-067) keeps its manga picture", tie("OP09-051_p2"), "kept 596984");
check("ST21-001_r1 in ST31: off LT-01's Luffy Deck card onto ST-31's own", tie("ST21-001_r1"), "moved 706313");
check("Sanji Demo Deck 2023 promo: off the plain OP01 card onto the promo", tie("OP01-013#promo"), "moved 497385");
check("EB02 SP Chopper stays tied to the EB02 SP (its price is a hand check)", tie("OP08-001_p2"), "kept 629185");
console.log("tieRows: rows with no product get theirs");
check("Shanks OP01-120_p2 'alt-art' = TCGplayer's manga (no other alt art in OP01)", tie("OP01-120_p2"), "linked 454666");
check("Gum-Gum Giant Gavel OP03-055_p2 jolly-roger-foil takes the Jolly Roger Foil, the loose 'reprint' row does not", [tie("OP03-055_p2"), tie("OP03-055_r1")], ["linked 593306", "kept 499985"]);
check("Usopp OP11-003_r1 (ST31 reprint) = LT-01's Luffy Deck card", tie("OP11-003_r1"), "linked 656670");
check("a feed duplicate with nothing left stays untied", untied.map((u) => u.id), ["OP03-094_r1"]);

const prices = productPrices(fx.prices);
const sets = new Map([["OP17", { name: "The World's Strongest Warriors", day: "2026-08-28" }]]);
const add = rowsToAdd(fx.products, info, claimed, prices, sets, "2026-10-25", untied);
const added = (id) => add.rows.find((r) => r.id === id);
console.log("rowsToAdd: the printings no row is");
check("Kingdew release event: under OP17, own id, own price", (({ set_code, set_name, set_release_date, variant, name, price_usd, tcg_product_id }) => ({ set_code, set_name, set_release_date, variant, name, price_usd, tcg_product_id }))(added("OP17-006#tcg712668")), { set_code: "OP17", set_name: "The World's Strongest Warriors", set_release_date: "2026-08-28", variant: "release-event", name: "Kingdew", price_usd: 1.77, tcg_product_id: 712668 });
check("Shanks SP Gold (OP13) is added beside the SP Silver row", [added("OP09-004#tcg657442")?.set_code, added("OP09-004#tcg657442")?.variant], ["OP13", "gold"]);
check("Luffy ST01-001 super pre-release under ST01", [added("ST01-001#tcg412113")?.set_code, added("ST01-001#tcg412113")?.variant], ["ST01", "super-pre-release"]);
check("LT-01's Luffy Deck Luffy (freed by ST21-001_r1) is its own LT01 reprint", [added("ST21-001#tcg656655")?.set_code, added("ST21-001#tcg656655")?.set_name, added("ST21-001#tcg656655")?.variant], ["LT01", "Learn Together Deck Set", "reprint"]);
check("a new promo files under PROMO with its pack", [added("OP01-013#tcg557285")?.set_code, added("OP01-013#tcg557285")?.variant], ["PROMO", "english-version-1st-anniversary-set"]);
check("no row twice: the Shanks manga and the Buggy manga are not added", [added("OP01-120#tcg454666"), added("OP09-051#tcg596984")], [undefined, undefined]);
check("an unreleased group waits", rowsToAdd(fx.products, info, claimed, prices, sets, "2022-01-01", untied).skipped.unreleased > 0, true);

console.log("onePieceProductPrice: one rule for the 2am push and the 5am refresh");
check("market", onePieceProductPrice([{ subTypeName: "Foil", marketPrice: 6835.94 }]), 6835.94);
check("Normal beside Foil = the Normal line (P-043 $63.65 / $342.55)", onePieceProductPrice([{ subTypeName: "Normal", marketPrice: 63.65 }, { subTypeName: "Foil", marketPrice: 342.55 }]), 63.65);
check("no sale: asking up to $20", [onePieceProductPrice([{ subTypeName: "Normal", marketPrice: null, midPrice: 3.5 }]), onePieceProductPrice([{ subTypeName: "Normal", marketPrice: null, midPrice: 25 }])], [3.5, null]);
console.log("lib/onepiece.ts: stamped twins");
check("release event / pre-release are stamped twins; a promo's pack word is not", [isOnePieceStampedTwin({ variant: "release-event", setCode: "OP17" }), isOnePieceStampedTwin({ variant: "pre-release-winner", setCode: "PROMO" }), isOnePieceStampedTwin({ variant: "alt-art", setCode: "OP17" })], [true, false, false]);
check("sideline = promo or stamped twin", [isOnePieceSideline({ variant: "x", setCode: "PROMO" }), isOnePieceSideline({ variant: "anniversary", setCode: "OP05" }), isOnePieceSideline({ variant: "", setCode: "OP05" })], [true, true, false]);
check("labels", [printingLabel({ variant: "release-event", setCode: "OP17", rarity: "C" }), printingLabel({ variant: "release-event-bentham", setCode: "OP16", rarity: "C" }), printingLabel({ variant: "anniversary-3rd-anniversary-tournament-3-brothers-pack", setCode: "OP13", rarity: "R" }), printingLabel({ variant: "super-alt-art", setCode: "OP17", rarity: "SR" })], ["Release Event · C", "Release Event Bentham · C", "Anniversary 3rd Anniversary Tournament 3 Brothers Pack · R", "Super Alt Art · SR"]);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
