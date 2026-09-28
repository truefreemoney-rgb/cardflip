/**
 * Sealed product price feed (Tier 2 #13). Run: npm run test:sealedprices
 *
 * Pins: TCGplayer product names classify to our sealed kinds (accessories,
 * cases and code cards to nothing); the sealed catalog id the feed writes
 * under is the id makeSealedProduct gives the queue item; a group's product
 * list keeps only numberless rows with a kind; groups come due when never
 * scanned or a month stale; the day's prices write one series per product
 * and the median under the (set, kind) id; sealedQuote reads both back; a
 * sealed ledger row carrying that id is priced by the Inventory live
 * refresh with no sealed-specific branch; scanSealedProducts names a group
 * by where its mapped cards live and marks it scanned.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-sealed-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});
console.error = () => {};
console.warn = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { classifySealedProduct, sealedProductRole, sealedProductId, sealedTcgplayerId, median } = await import(at("lib/sealedProducts.ts"));
const { makeSealedProduct } = await import(at("lib/grading.ts"));
const {
  storeSealedProducts, sealedGroupsDue, sealedSeriesUpserts, sealedQuote, scanSealedProducts, readSealedMap, SEALED_RESCAN_DAYS, SEALED_GROUPS_PER_RUN,
} = await import(at("lib/server/sealedPrices.ts"));
const { upsertSeriesRows, readSeriesMap } = await import(at("lib/server/priceBulkWrite.ts"));
const { createCard, getCardForUser } = await import(at("lib/server/cards.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { refreshLivePrices } = await import(at("lib/server/livePrices.ts"));
const { askingPriceFor } = await import(at("lib/listing.ts"));
const { addDays } = await import(at("lib/priceSeries.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

console.log("classify");
for (const [name, want] of [
  ["Scarlet & Violet Booster Box", "Booster Box"],
  ["Paldea Evolved Elite Trainer Box", "Elite Trainer Box"],
  ["Pokemon Center Elite Trainer Box", "Elite Trainer Box"],
  ["Obsidian Flames Booster Bundle", "Booster Bundle"],
  ["Scarlet & Violet Booster Pack", "Booster Pack"],
  ["Sleeved Booster Pack", "Booster Pack"],
  ["Scarlet & Violet 3-Pack Blister [Arcanine]", "Blister Pack"],
  ["Premium Checklane Blister [Spidops]", "Blister Pack"],
  ["Paldea Evolved Build & Battle Box", "Build & Battle Box"],
  ["Paldea Evolved Build & Battle Stadium", null],
  ["Scarlet & Violet Booster Box Case", null],
  ["Paldean Fates Mini Tin [Fidough]", "Tin"],
  ["Paradox Rift Ultra-Premium Collection", "Premium Collection"],
  ["Charizard ex Premium Collection", "Premium Collection"],
  ["Paldean Fates Tech Sticker Collection [Fidough]", "Collection Box"],
  ["Miraidon ex League Battle Deck", "Starter Deck"],
  ["Base Set Theme Deck - Overgrowth", "Theme Deck"],
  ["Ultra Ball Half Booster Box", "Half Booster Box"],
  ["Code Card - Scarlet & Violet Booster Pack", null],
  ["Paldea Evolved Card Sleeves", null],
  ["Pokemon TCG Coin - Pikachu", null],
  ["", null],
]) check(`"${name}" → ${want}`, classifySealedProduct(name), want);

console.log("roles (from the real Ascended Heroes / Chaos Rising lists, 09-27)");
for (const [name, want] of [
  ["Ascended Heroes Booster Bundle", "standard"],
  ["Ascended Heroes Booster Bundle Display", "lot"],
  ["Chaos Rising Build & Battle Display", "lot"],
  ["Ascended Heroes Mini Tin Display", "lot"],
  ["Ascended Heroes Mini Tins 5-Pack", "lot"],
  ["Ascended Heroes Tin [Set of 3]", "lot"],
  ["Mega Evolution: Ascended Heroes Collection [Set of 2]", "lot"],
  ["Chaos Rising Booster Pack Art Bundle [Set of 4]", "lot"],
  ["Costco Ascended Heroes Mega ex Box Bundle", "lot"],
  ["Scarlet & Violet Booster Box Case", "lot"],
  ["Chaos Rising 3-Pack Blister [Charmeleon]", "standard"],
  ["Chaos Rising Single Pack Blister [Toxel]", "standard"],
  ["Ascended Heroes Pokemon Center Elite Trainer Box (Exclusive)", "exclusive"],
  ["Chaos Rising Pokemon Center Elite Trainer Box", "exclusive"],
  ["Ascended Heroes Focused Fighters Premium Collection (Sam's Club)", "exclusive"],
  ["Chaos Rising Elite Trainer Box", "standard"],
]) check(`"${name}" is ${want}`, sealedProductRole(name), want);

console.log("ids");
const set = { name: "Scarlet & Violet", releaseDate: "2023-03-31", logoUrl: "" };
check("feed id == queue item id", sealedProductId("pokemon", set.name, "Booster Box"), makeSealedProduct(set, "Booster Box").id);
check("id shape", sealedProductId("pokemon", "Paldea Evolved", "Build & Battle Box"), "sealed-pokemon-paldea-evolved-build-battle-box");
check("median odd", median([3, 1, 2]), 2);
check("median even rounds to cents", median([10, 20.005, 30, 40]), 25);
check("median ignores non-prices", median([0, -1, NaN]), null);

console.log("store + due");
const DAY = "2026-09-27";
const GROUP = 23237;
const products = [
  { productId: 1, name: "Scarlet & Violet Booster Box" },
  { productId: 2, name: "Scarlet & Violet Elite Trainer Box" },
  { productId: 3, name: "Pokemon Center Elite Trainer Box" },
  { productId: 4, name: "Scarlet & Violet Booster Box Case" },
  { productId: 8, name: "Scarlet & Violet Elite Trainer Box Display" },
  { productId: 5, name: "Code Card - Scarlet & Violet Booster Box" },
  { productId: 6, name: "Pikachu", extendedData: [{ name: "Number", value: "062/198" }] },
];
check("stores the three sealed rows", await storeSealedProducts("pokemon", GROUP, set.name, products, DAY), 3);
const stored = (await db.prepare("SELECT product_id, product_type, role FROM tcgplayer_sealed ORDER BY product_id").all()).map((r) => [Number(r.product_id), r.product_type, r.role]);
check("numbered card, case, display and code card left out; PC ETB is exclusive", stored, [[1, "Booster Box", "standard"], [2, "Elite Trainer Box", "standard"], [3, "Elite Trainer Box", "exclusive"]]);
// The map's groups: this one (scanned today) and one never scanned.
await db.prepare("INSERT INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES (6, ?, 'sv01-062', 'pokemon'), (7, 999, 'sv02-001', 'pokemon')").run(GROUP);
check("never scanned is due, scanned today is not", await sealedGroupsDue("pokemon", DAY, 10), [999]);
check("a month stale comes due again, never-scanned first", await sealedGroupsDue("pokemon", addDays(DAY, SEALED_RESCAN_DAYS + 1), 10), [999, GROUP]);
check("limit", (await sealedGroupsDue("pokemon", addDays(DAY, SEALED_RESCAN_DAYS + 1), 1)).length, 1);

console.log("series");
const sealedMap = await readSealedMap("pokemon");
check("map has the three", [...sealedMap.keys()], [1, 2, 3]);
const prices = new Map([[1, 129.99], [2, 44.5], [3, 61.0], [4, 700], [99, 5]]);
const ups = sealedSeriesUpserts("pokemon", DAY, prices, sealedMap, new Map());
const byId = Object.fromEntries(ups.map((u) => [u.cardId, u]));
check("one series per product + one per kind", ups.map((u) => u.cardId).sort(), [
  sealedProductId("pokemon", set.name, "Booster Box"),
  sealedProductId("pokemon", set.name, "Elite Trainer Box"),
  sealedTcgplayerId(1), sealedTcgplayerId(2), sealedTcgplayerId(3),
].sort());
check("variant normal, source tcgplayer", [byId[sealedTcgplayerId(1)].variant, byId[sealedTcgplayerId(1)].source], ["normal", "tcgplayer"]);
await upsertSeriesRows(ups);
const q = await sealedQuote("pokemon", set.name, "Elite Trainer Box");
check("ETB price is the plain ETB, not a mean with the Pokemon Center one", q.market, 44.5);
check("each product's own price rides along, standard first", q.products.map((p) => [p.name, p.market, p.exclusive]), [["Scarlet & Violet Elite Trainer Box", 44.5, false], ["Pokemon Center Elite Trainer Box", 61, true]]);
check("a kind that only comes exclusive uses the exclusives", sealedSeriesUpserts("pokemon", DAY, new Map([[3, 61]]), sealedMap, new Map()).find((u) => u.cardId.startsWith("sealed-")).prices, JSON.stringify([61]));
check("booster box is its one price", (await sealedQuote("pokemon", set.name, "Booster Box")).market, 129.99);
check("unknown kind: nothing", await sealedQuote("pokemon", set.name, "Tin"), { market: null, products: [] });
// A second day extends the series instead of replacing it.
const existing = await readSeriesMap("pokemon", "tcgplayer");
const ups2 = sealedSeriesUpserts("pokemon", addDays(DAY, 1), new Map([[1, 135]]), sealedMap, existing);
check("next day keeps yesterday", ups2.find((u) => u.cardId === sealedTcgplayerId(1)).startDay, DAY);
check("a new sub-5¢ product is not tracked", sealedSeriesUpserts("pokemon", DAY, new Map([[2, 0.01]]), sealedMap, new Map()).length, 0);

console.log("ledger");
const u = await createUser("Seller", "seller@example.com", "hunter22", "user");
const box = makeSealedProduct(set, "Booster Box");
const row = await createCard(u.id, {
  kind: "sealed", cardName: box.name, setName: set.name, cardNumber: "", imageUrl: "", condition: "Factory Sealed",
  productType: "Booster Box", price: 0, catalogCardId: box.id,
});
const live = await refreshLivePrices(u.id);
check("live refresh prices the sealed row off the feed", live.map((l) => [l.cardId, l.market, l.suggested, l.applied]), [[row.id, 129.99, askingPriceFor(129.99, "Factory Sealed"), true]]);
check("ledger price moved", (await getCardForUser(row.id, u.id)).price, askingPriceFor(129.99, "Factory Sealed"));

console.log("scan");
await db.prepare("INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url, set_card_count_official, set_card_count_total, set_code, synced_at) VALUES ('sv02-001', 'Sprigatito', 'sv02', 'Paldea Evolved', '1', '2023-06-09', '', 1, 1, 'PAL', 0), ('sv01-062', 'Pikachu', 'sv01', 'Scarlet & Violet', '62', '2023-03-31', '', 1, 1, 'SVI', 0)").run();
const asked = [];
const scan = await scanSealedProducts(DAY, 10, async (gid) => {
  asked.push(gid);
  return [{ productId: 50, name: "Paldea Evolved Booster Bundle" }, { productId: 51, name: "Paldea Evolved Card Sleeves" }];
});
check("only the due group is read", asked, [999]);
check("result", scan, { groupsScanned: 1, groupsFailed: 0, products: 1 });
check("named after its cards' set", (await db.prepare("SELECT set_name, product_type FROM tcgplayer_sealed WHERE product_id = 50").get()), { set_name: "Paldea Evolved", product_type: "Booster Bundle" });
check("group marked scanned", await sealedGroupsDue("pokemon", DAY, 10), []);
const failed = await scanSealedProducts(addDays(DAY, SEALED_RESCAN_DAYS + 1), 1, async () => { throw new Error("HTTP 503"); });
check("a failed fetch counts and does not mark the group", [failed.groupsFailed, (await sealedGroupsDue("pokemon", addDays(DAY, SEALED_RESCAN_DAYS + 1), 10)).length], [1, 2]);

console.log("first fill");
// 40 more groups, nothing scanned yet: the daily-pace call reads them all in one go.
const extra = Array.from({ length: 40 }, (_, i) => `(${5000 + i}, ${2000 + i}, 'sv02-001', 'pokemon')`).join(", ");
await db.prepare(`INSERT INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES ${extra}`).run();
await db.prepare("DELETE FROM tcgplayer_sealed_groups").run();
const first = await scanSealedProducts(DAY, SEALED_GROUPS_PER_RUN, async () => []);
check("first run reads every group, not the daily 30", first.groupsScanned > SEALED_GROUPS_PER_RUN, true);
await db.prepare("DELETE FROM tcgplayer_sealed_groups WHERE group_id >= 2000").run();
const steady = await scanSealedProducts(DAY, SEALED_GROUPS_PER_RUN, async () => []);
check("later runs keep the daily pace", steady.groupsScanned, SEALED_GROUPS_PER_RUN);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exitCode = failures ? 1 : 0;
