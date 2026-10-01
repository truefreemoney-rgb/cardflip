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

const { planTcgRefresh, onePieceNameVariant } = await import("../src/lib/server/tcgPriceRefresh.ts");
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
console.log(`\ntcg prices: ${passed} checks pass`);
