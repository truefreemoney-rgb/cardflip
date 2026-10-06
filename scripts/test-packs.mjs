/**
 * Pack-opening tracker (audit G8): the ROI math (lib/packs.ts), the pack tables
 * (lib/server/packs.ts) and the auth gate on every pack route. Run: npm run test:packs
 *
 * Pins: a pull is worth its market (scan) price, a sold pull what it sold for; profit and ROI over
 * the cost (a free pack has no percentage); lifetime ROI is one figure over the lot; a pack's
 * pulls are only the cards created with its id; a pack id that is not the user's is never linked
 * or readable; deleting a pack keeps its cards; every pack route and the share picture call a gate.
 *
 * Throwaway-db trick as in test-cards.mjs: chdir to a temp dir before any import.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-packs-test-"));
const repo = process.cwd();
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { pullValue, toPulls, packTotals, lifetimeTotals, roiLabel, parsePackCost, parsePackName } = await import(at("lib/packs.ts"));
const { createPack, ownsPack, listPacks, getPack, updatePack, deletePack } = await import(at("lib/server/packs.ts"));
const { createCard, listCardsForUser } = await import(at("lib/server/cards.ts"));
const { createUser, deleteUser } = await import(at("lib/server/users.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

// --- pull value ------------------------------------------------------------
const row = (o) => ({ id: "x", cardName: "C", setName: "S", imageUrl: "", status: "ready", price: 1, scanPrice: null, soldPrice: null, quantity: 1, ...o });
check("market (scan) price wins over the quick-sale price", pullValue(row({ price: 8.8, scanPrice: 10 })), 10);
check("no scan price: the row price", pullValue(row({ price: 3.5 })), 3.5);
check("a sold pull counts at what it sold for", pullValue(row({ status: "sold", soldPrice: 12, scanPrice: 10 })), 12);
check("quantity multiplies", pullValue(row({ scanPrice: 2.5, quantity: 3 })), 7.5);
check("unpriced pull is $0", pullValue(row({ price: 0 })), 0);

// --- totals ----------------------------------------------------------------
const pulls = toPulls([row({ id: "a", cardName: "Bulk", scanPrice: 0.25 }), row({ id: "b", cardName: "Chase", scanPrice: 18 }), row({ id: "c", cardName: "Mid", scanPrice: 2.1 })]);
check("pulls sorted best first", pulls.map((p) => p.id), ["b", "c", "a"]);
const t = packTotals(4.99, pulls);
check("value is the sum", t.value, 20.35);
check("profit = value - cost", t.profit, 15.36);
check("ROI percent over cost", t.roiPct, 307.8);
check("best pull is the priciest", t.best?.id, "b");
check("count", t.count, 3);
const loss = packTotals(10, toPulls([row({ scanPrice: 2.5 })]));
check("a loss is negative, not clamped", [loss.profit, loss.roiPct], [-7.5, -75]);
check("free pack has no ROI percentage", packTotals(0, pulls).roiPct, null);
check("empty pack: no best, value 0", [packTotals(5, []).best, packTotals(5, []).value, packTotals(5, []).roiPct], [null, 0, -100]);
check("roiLabel signs", [roiLabel(42), roiLabel(-18), roiLabel(0), roiLabel(null)], ["+42%", "-18%", "0%", "Free Pack"]);
const life = lifetimeTotals([{ cost: 5, value: 20, count: 4 }, { cost: 15, value: 10, count: 6 }]);
check("lifetime: one ROI over the lot", [life.cost, life.value, life.profit, life.roiPct, life.packs, life.cards], [20, 30, 10, 50, 2, 10]);
check("lifetime with no packs", lifetimeTotals([]).roiPct, null);

// --- request parsing -------------------------------------------------------
check("cost: number in range, cents", [parsePackCost(4.999), parsePackCost(0), parsePackCost(undefined)], [5, 0, 0]);
check("cost: rejects negative, text, infinity, absurd", [parsePackCost(-1), parsePackCost("5"), parsePackCost(Infinity), parsePackCost(1e9)], [null, null, null, null]);
check("name: trimmed, collapsed, capped", [parsePackName("  Surging   Sparks "), parsePackName(5), parsePackName("x".repeat(200)).length], ["Surging Sparks", "", 60]);

// --- the tables ------------------------------------------------------------
const alice = await createUser("Alice", "alice@example.com", "hunter22");
const mallory = await createUser("Mallory", "mallory@example.com", "hunter22");
const base = { setName: "Surging Sparks", cardNumber: "1/191", imageUrl: "https://img.example/1.png", condition: "Near Mint" };

const pack = await createPack(alice.id, { game: "pokemon", name: "Surging Sparks booster", cost: 4.99 });
check("pack created", [pack?.name, pack?.cost, pack?.game], ["Surging Sparks booster", 4.99, "pokemon"]);
check("owner owns it, a stranger does not", [await ownsPack(alice.id, pack.id), await ownsPack(mallory.id, pack.id), await ownsPack(alice.id, "nope")], [true, false, false]);

await createCard(alice.id, { ...base, cardName: "Pikachu ex", price: 15.84, scanPrice: 18, packId: pack.id });
await createCard(alice.id, { ...base, cardName: "Bulk Energy", price: 0.22, scanPrice: 0.25, packId: pack.id });
await createCard(alice.id, { ...base, cardName: "Other Card", price: 50 });
const detail = await getPack(alice.id, pack.id);
check("pack lists only its own pulls", detail.pulls.map((p) => p.cardName), ["Pikachu ex", "Bulk Energy"]);
check("pack totals from the database", [detail.value, detail.profit, detail.roiPct, detail.count, detail.best?.cardName], [18.25, 13.26, 265.7, 2, "Pikachu ex"]);
check("a stranger cannot read the pack", await getPack(mallory.id, pack.id), null);

const malloryPack = await createPack(mallory.id, { game: "mtg", name: "Draft booster", cost: 0 });
check("lists only the user's own packs", [(await listPacks(alice.id)).map((p) => p.id), (await listPacks(mallory.id)).map((p) => p.id)], [[pack.id], [malloryPack.id]]);
check("a free pack lists without a percentage", (await listPacks(mallory.id))[0].roiPct, null);

check("a stranger cannot rename or delete", [await updatePack(mallory.id, pack.id, { name: "mine" }), await deletePack(mallory.id, pack.id)], [null, false]);
check("owner renames and re-prices", (await updatePack(alice.id, pack.id, { name: "Booster 2", cost: 6 })) && (await getPack(alice.id, pack.id)).cost, 6);

check("delete returns true", await deletePack(alice.id, pack.id), true);
const left = await listCardsForUser(alice.id);
check("deleting a pack keeps every card", left.length, 3);
check("and unlinks them", (await db.prepare("SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND pack_id IS NOT NULL").get(alice.id)).n, 0);
check("the pack is gone", await getPack(alice.id, pack.id), null);

await deleteUser(mallory.id);
check("deleting an account takes its packs", (await db.prepare("SELECT COUNT(*) AS n FROM packs WHERE user_id = ?").get(mallory.id)).n, 0);

// --- auth gates (source scan; npm run test:apiauth covers the mutating routes too) ----
for (const file of ["src/app/api/packs/route.ts", "src/app/api/packs/[id]/route.ts", "src/app/api/share/pack/route.tsx"]) {
  const src = readFileSync(path.join(repo, file), "utf8");
  const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|DELETE)\b/g)].length;
  const gates = [...src.matchAll(/await requireUser\(\)/g)].length;
  check(`${file}: every handler calls requireUser (${handlers})`, handlers > 0 && gates === handlers);
  if (/POST|PATCH|DELETE/.test(src.match(/export async function (POST|PATCH|DELETE)/)?.[1] ?? "")) {
    check(`${file}: writes go through the rate limiter`, /limitOrRespond\(/.test(src));
  }
}
const cardsRoute = readFileSync(path.join(repo, "src/app/api/cards/route.ts"), "utf8");
check("POST /api/cards only links a pack the user owns", /ownsPack\(user\.id, body\.packId\)/.test(cardsRoute));

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nAll pack tests passed");
