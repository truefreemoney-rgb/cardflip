/**
 * Lorcana / One Piece / Yu-Gi-Oh! daily prices → price_series history.
 * Run: npm run test:tcgprices
 *
 * Pins (09-30, Chris: "we need the history price data like pokemon has"):
 * these games kept one current price and no history. planTcgRefresh must
 * append today's point per printing ("normal" = plain, "foil" = foil), move
 * the price columns only when the price moved, keep the last known price on
 * a day the source is missing a card, and give One Piece's "#n" duplicate
 * rows the same printing's price. Then a real end-to-end write on a
 * throwaway DB proves the series lands where getPriceHistory reads it.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-tcgprices-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const { planTcgRefresh, onePieceNameVariant, matchLorcanaProducts, matchOnePiecePromos, yugiohGroupPoints } = await import("../src/lib/server/tcgPriceRefresh.ts");
const { upsertSeriesRows, readSeriesMap } = await import("../src/lib/server/priceBulkWrite.ts");
const { getPriceHistory } = await import("../src/lib/server/priceHistory.ts");

let passed = 0;
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); passed++; console.log(`  PASS  ${label}`); };

const mirror = new Map([
  ["crd_elsa", { usd: 2, foil: 9 }],
  ["crd_same", { usd: 1.5, foil: null }],
  ["crd_gone", { usd: 4, foil: null }],
  ["crd_penny", { usd: null, foil: null }],
]);
const points = [
  { id: "crd_elsa", usd: 2.5, foil: 9 },
  { id: "crd_same", usd: 1.5, foil: null },
  { id: "crd_penny", usd: 0.02, foil: null },
  { id: "crd_not_in_mirror", usd: 10, foil: null },
];
const day1 = planTcgRefresh("lorcana", points, mirror, new Map(), "2026-09-30");
check("columns move only when the price moved (Elsa, the newly priced penny)",
  day1.columns.map((c) => c.id).sort(), ["crd_elsa", "crd_penny"]);

// One Piece: OP09-077 is both the base card and a Premium Card Collection
// promo (same image id, different set, $0.10 vs $32); OP01-001#7 is the
// sync's repeat row for a reprint set; two same-set rows split by tag.
const opMirror = new Map([
  ["OP09-077", { usd: 0.1, foil: null, setName: "Emperors in the New World", variant: "" }],
  ["OP09-077#4000", { usd: 30, foil: null, setName: "Premium Card Collection -Best Selection Vol. 4-", variant: "premium-card-collection-best-selection-vol-4-" }],
  ["OP01-001", { usd: 3, foil: null, setName: "Romance Dawn", variant: "" }],
  ["OP01-001#7", { usd: 3, foil: null, setName: "Premium Booster -The Best-", variant: "reprint" }],
  ["EB01-018_r1", { usd: 1, foil: null, setName: "Premium Booster -The Best- Vol. 2", variant: "pirate-foil" }],
  ["EB01-018_r1#2658", { usd: 1, foil: null, setName: "Premium Booster -The Best- Vol. 2", variant: "reprint" }],
]);
const opPoints = [
  { id: "OP09-077", usd: 0.12, foil: null, setName: "Emperors in the New World", variant: "" },
  { id: "OP09-077", usd: 32.15, foil: null, setName: "Premium Card Collection -Best Selection Vol. 4-", variant: "premium-card-collection-best-selection-vol-4-" },
  { id: "OP01-001", usd: 3.2, foil: null, setName: "Romance Dawn", variant: "" },
  { id: "OP01-001", usd: 2.5, foil: null, setName: "Premium Booster -The Best-", variant: "reprint" },
  { id: "EB01-018_r1", usd: 4, foil: null, setName: "Premium Booster -The Best- Vol. 2", variant: "pirate-foil" },
  { id: "EB01-018_r1", usd: 0.9, foil: null, setName: "Premium Booster -The Best- Vol. 2", variant: "reprint" },
];
const op = planTcgRefresh("onepiece", opPoints, opMirror, new Map(), "2026-09-30");
const opPrice = (id) => op.upserts.find((u) => u.cardId === id)?.prices;
check("One Piece: a shared image id prices by set (base $0.12, promo $32.15)",
  [opPrice("OP09-077"), opPrice("OP09-077#4000")], ["[0.12]", "[32.15]"]);
check("One Piece: the sync's '#n' reprint row takes its own set's price",
  [opPrice("OP01-001"), opPrice("OP01-001#7")], ["[3.2]", "[2.5]"]);
check("One Piece: same image + set split by printing tag",
  [opPrice("EB01-018_r1"), opPrice("EB01-018_r1#2658")], ["[4]", "[0.9]"]);
{
  // DON!! cards (10-01): no card id; the sync and the refresh both fold the feed's full name into the row id.
  const { onePieceDonKey, parseOnePieceDon } = await import(new URL("../src/lib/onepiece.ts", import.meta.url).href);
  const feed = [
    { card_name: "DON!! Card (Koby) (Gold)", optcg_don_name: "DON!! Card (Koby) (Gold) - Premium Booster -The Best- Vol. 2 (PRB-02)", market_price: 53.53 },
    { card_name: "DON!! Card (Koby)", optcg_don_name: "DON!! Card (Koby) - Premium Booster -The Best- Vol. 2 (PRB-02)", market_price: 0.4 },
  ];
  const asRow = (c) => { const d = parseOnePieceDon(c.card_name, c.optcg_don_name); return [`${onePieceDonKey(c.optcg_don_name)}#don`, { usd: 1, foil: null, setName: d.setName, variant: d.variant }]; };
  const asPoint = (c) => { const d = parseOnePieceDon(c.card_name, c.optcg_don_name); return { id: onePieceDonKey(c.optcg_don_name), usd: c.market_price, foil: null, setName: d.setName, variant: d.variant }; };
  const don = planTcgRefresh("onepiece", feed.map(asPoint), new Map(feed.map(asRow)), new Map(), "2026-10-01");
  check("One Piece DON!! cards: each row takes its own price (gold $53.53, plain $0.40)",
    don.upserts.map((u) => [u.cardId, u.prices]).sort(),
    [["don-don-card-koby-gold-premium-booster-the-best-vol-2-prb-02#don", "[53.53]"], ["don-don-card-koby-premium-booster-the-best-vol-2-prb-02#don", "[0.4]"]]);
}
{
  // 10-13: a starter-deck reprint optcgapi leaves unpriced takes its original printing's price (one TCGplayer product);
  // a reprint with its own price keeps it, and a promo of the same number never lends its price.
  const pts = [
    { id: "OP12-113", usd: 1.25, foil: null, setName: "Legacy of the Master", variant: "" },
    { id: "OP12-113_pr1", usd: 40, foil: null, setName: "One Piece Promotion Cards", variant: "promo-pr1" },
    { id: "OP12-113_r1", usd: null, foil: null, setName: "Starter Deck 33: BLUE Kuzan", variant: "reprint" },
    { id: "OP10-101_r1", usd: 0.5, foil: null, setName: "Starter Deck 36", variant: "reprint" },
    { id: "OP10-101", usd: 3, foil: null, setName: "Royal Blood", variant: "" },
  ];
  const mirror = new Map([
    ["OP12-113_r1", { usd: 0, foil: null, setName: "Starter Deck 33: BLUE Kuzan", variant: "reprint" }],
    ["OP10-101_r1", { usd: null, foil: null, setName: "Starter Deck 36", variant: "reprint" }],
  ]);
  const plan = planTcgRefresh("onepiece", pts, mirror, new Map(), "2026-10-13");
  check("One Piece: unpriced ST reprint takes the original's $1.25; a priced reprint keeps its own $0.50",
    plan.columns.map((c) => [c.id, c.usd]).sort(), [["OP10-101_r1", 0.5], ["OP12-113_r1", 1.25]]);
}
check("One Piece printing tag matches the sync's mapping",
  [onePieceNameVariant("Perona (Parallel)"), onePieceNameVariant("Roronoa Zoro (001)"), onePieceNameVariant("Shanks (Box Topper)")], ["parallel", "", "box-topper"]);
check("a card missing from today's source keeps its price (no column, no point)",
  [day1.columns.some((c) => c.id === "crd_gone"), day1.upserts.some((u) => u.cardId === "crd_gone")], [false, false]);
check("normal + foil series for a card with both prices",
  day1.upserts.filter((u) => u.cardId === "crd_elsa").map((u) => [u.variant, u.prices]).sort(), [["foil", "[9]"], ["normal", "[2.5]"]]);
check("an unchanged price still gets today's point (history keeps moving)",
  day1.upserts.find((u) => u.cardId === "crd_same")?.prices, "[1.5]");
check("a new sub-5¢ card starts no series", day1.upserts.some((u) => u.cardId === "crd_penny"), false);
check("ids we don't carry are ignored", day1.upserts.some((u) => u.cardId === "crd_not_in_mirror"), false);

// End to end: write day 1, then day 2 appends to the same series.
await upsertSeriesRows(day1.upserts);
const series1 = await readSeriesMap("lorcana", "tcgplayer");
const day2 = planTcgRefresh("lorcana", [{ id: "crd_elsa", usd: 2.75, foil: 9.5 }], mirror, series1, "2026-10-01");
await upsertSeriesRows(day2.upserts);
const history = await getPriceHistory("crd_elsa");
const normal = history.find((s) => s.variant === "normal");
check("getPriceHistory sees two daily points for Elsa normal",
  normal?.points.map((p) => [p.date ?? p.day, p.price]), [["2026-09-30", 2.5], ["2026-10-01", 2.75]]);
// 10-05: Lorcast leaves promos unpriced; TCGplayer fills them only on name AND number.
check("Lorcana promo gaps fill from TCGplayer on name + number, never name alone",
  matchLorcanaProducts(
    [
      { id: "d23_iago", name: "Iago", subtitle: "Out of Reach", number: "8" },
      { id: "cc_tink", name: "Tinker Bell", subtitle: "Giant Fairy", number: "6" },
      { id: "fc_tink", name: "Tinker Bell", subtitle: "\"Giant Fairy\"", number: "18" },
    ],
    [
      { name: "Iago - Out of Reach", number: "8", prices: { Foil: 45.18 } },
      { name: "Tinker Bell - Giant Fairy", number: "6", prices: { Normal: 75.16 } },
      { name: "Tinker Bell - Giant Fairy (Foil)", number: "14", prices: { Foil: 120 } },
    ],
  ),
  [{ id: "d23_iago", usd: null, foil: 45.18 }, { id: "cc_tink", usd: 75.16, foil: null }]);
{
  // 10-24: optcgapi ran stale and low on regional Finalist promos (Kid P-003 Online Finalist $19.63 vs TCGplayer $153.75).
  const promos = matchOnePiecePromos(
    [
      { id: "P-003_pr3#promo", name: "Eustass\"Captain\"Kid (Online Regional 2024 Vol. 2) [Finalist]", number: "P-003" },
      { id: "P-003_pr6#promo", name: "Eustass\"Captain\"Kid", number: "P-003" },
      { id: "OP02-053#promo", name: "Crocodile (Online Regional 2023) [Finalist]", number: "OP02-053" },
      { id: "P-001_pr3#promo", name: "Monkey.D.Luffy (001) (Online Regional 2024 Vol. 2) [Finalist]", number: "P-001" },
    ],
    [
      { name: "Eustass\"Captain\"Kid (Online Regional 2024 Vol. 2) [Finalist]", number: "P-003", prices: { Foil: 153.75 } },
      { name: "Eustass\"Captain\"Kid (Promotion Pack 2022)", number: "P-003", prices: { Normal: 1.7 } },
      { name: "Crocodile (Online Regional 2023) [Finalist]", number: "OP02-053", prices: { Normal: 210, Foil: 224.5 } },
      { name: "Monkey.D.Luffy (001) (Online Regional 2024 Vol. 2) [Finalist]", number: "P-002", prices: { Foil: 599.99 } },
    ],
  );
  check("One Piece promos take TCGplayer's market on name AND number; a bare name, two subtypes or another number never match",
    promos, [{ id: "P-003_pr3#promo", usd: 153.75, foil: null, row: true }]);
  const plan = planTcgRefresh(
    "onepiece",
    [{ id: "P-003_pr3", usd: 19.63, foil: null, setName: "One Piece Promotion Cards", variant: "" }, ...promos],
    new Map([["P-003_pr3#promo", { usd: 19.63, foil: null, setName: "One Piece Promotion Cards", variant: "" }]]),
    new Map(),
    "2026-10-24",
  );
  check("One Piece: the row's own TCGplayer match beats the feed's image-id price",
    plan.columns.map((c) => [c.id, c.usd]), [["P-003_pr3#promo", 153.75]]);
}

// 10-13: an asking-only price over $20 blanks the held price (Acrobat Monkey $20.16, cheapest listing 44c); no point keeps it.
const cleared = planTcgRefresh(
  "yugioh",
  [{ id: "ygo-1", usd: null, foil: null, clear: true }, { id: "ygo-3", usd: null, foil: null, clear: true }],
  new Map([["ygo-1", { usd: 20.16, foil: null }], ["ygo-2", { usd: 5, foil: null }], ["ygo-3", { usd: null, foil: null }]]),
  new Map(),
  "2026-10-13",
);
check("asking-only over $20 clears the held price, nothing else moves", [cleared.columns, cleared.upserts.length], [[{ id: "ygo-1", usd: null, foil: null }], 0]);

// 10-23 C10: an unstamped printing nobody has bought takes its own 1st Edition sales before any asking price.
const ygo = (rows) => Object.fromEntries(yugiohGroupPoints(rows).map((p) => [p.id, p.clear ? "clear" : p.usd]));
check("unsold Unlimited over $20 asking takes the 1st Edition sale (Penguin Soldier: was a frozen $450.85)",
  ygo([{ productId: 69708, subTypeName: "Unlimited", marketPrice: null, midPrice: 450.85 }, { productId: 69708, subTypeName: "1st Edition", marketPrice: 0.55, midPrice: 0.6 }]),
  { "ygo-69708": 0.55, "ygo-69708-1st": 0.55 });
check("unsold Unlimited under $20 asking still loses to the 1st Edition sale (Bujingi Turtle $19.97 vs $0.23)",
  ygo([{ productId: 92621, subTypeName: "Unlimited", marketPrice: null, midPrice: 19.97 }, { productId: 92621, subTypeName: "1st Edition", marketPrice: 0.23, midPrice: 0.25 }]),
  { "ygo-92621": 0.23, "ygo-92621-1st": 0.23 });
check("a sold Unlimited keeps its own market",
  ygo([{ productId: 1, subTypeName: "Unlimited", marketPrice: 43, midPrice: 50 }, { productId: 1, subTypeName: "1st Edition", marketPrice: 1208, midPrice: 1300 }]),
  { "ygo-1": 43, "ygo-1-1st": 1208 });
check("no sale anywhere: asking under $20 stands, over $20 clears",
  ygo([{ productId: 2, subTypeName: "Unlimited", midPrice: 12 }, { productId: 3, subTypeName: "Unlimited", midPrice: 359.92 }]),
  { "ygo-2": 12, "ygo-3": "clear" });
console.log(`\ntcg prices: ${passed} checks pass`);
