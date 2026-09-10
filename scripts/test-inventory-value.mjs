/**
 * Inventory value over time (lib/server/inventoryValue.ts) — the graph under
 * the Inventory panel. Run: npm run test:inventoryvalue
 *
 * Pins: a card counts from its scan day at askingPriceFor(market, condition)
 * × quantity; days before the first scan are dropped; a sold copy leaves the
 * pile after its sale day; a missing series day carries the last reading;
 * another user's cards and the other game never leak in.
 *
 * Same throwaway-db trick as test-cards.mjs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-invvalue-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { createCard } = await import(at("lib/server/cards.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { inventoryValueSeries } = await import(at("lib/server/inventoryValue.ts"));
const { askingPriceFor } = await import(at("lib/listing.ts"));
const { addDays, todayUtc, DAY_MS } = await import(at("lib/priceSeries.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const now = Date.UTC(2026, 8, 10, 12); // 2026-09-10 noon UTC
const today = todayUtc(now);
const day = (n) => addDays(today, -n);
const msOn = (n) => now - n * DAY_MS;

const alice = await createUser("Alice", "alice@example.com", "hunter22");
const bob = await createUser("Bob", "bob@example.com", "hunter22");

// Series: 100, 110, 120, (no reading), 140, 150 for the last six days.
const market = { 5: 100, 4: 110, 3: 120, 1: 140, 0: 150 };
for (const [back, price] of Object.entries(market)) {
  await recordPoint("base1-4", "pokemon", "normal", "tcgplayer", "USD", price, day(Number(back)));
}
await recordPoint("mtg-1", "mtg", "normal", "tcgplayer", "USD", 50, day(0));

const base = { cardName: "Charizard", setName: "Base Set", cardNumber: "4/102", imageUrl: "", price: 1 };
const lp = await createCard(alice.id, { ...base, condition: "Lightly Played", catalogCardId: "base1-4" });
const soldCopy = await createCard(alice.id, { ...base, condition: "Near Mint", catalogCardId: "base1-4" });
await createCard(alice.id, { ...base, cardName: "Old scan", condition: "Near Mint", catalogCardId: null });
await createCard(bob.id, { ...base, condition: "Near Mint", catalogCardId: "base1-4" });
const mtg = await createCard(alice.id, { ...base, cardName: "Llanowar", condition: "Near Mint", catalogCardId: "mtg-1" });

// Scan days: the LP pair 4 days ago; the NM single 3 days ago, sold 1 day ago.
await db.prepare("UPDATE cards SET created_at = ?, quantity = 2 WHERE id = ?").run(msOn(4), lp.id);
await db.prepare("UPDATE cards SET created_at = ?, status = 'sold', sold_price = 130, sold_at = ? WHERE id = ?").run(msOn(3), msOn(1), soldCopy.id);
await db.prepare("UPDATE cards SET created_at = ?, game = ? WHERE id = ?").run(msOn(0), "mtg", mtg.id);
await db.prepare("UPDATE cards SET quantity = 9 WHERE user_id = ?").run(bob.id);

const pts = await inventoryValueSeries(alice.id, "pokemon", 10, now);
const lpAt = (m) => askingPriceFor(m, "Lightly Played") * 2;
const nmAt = (m) => askingPriceFor(m, "Near Mint");
const r2 = (n) => Math.round(n * 100) / 100;

check("starts on the first scan day, one point a day to today", pts.map((p) => p.day), [day(4), day(3), day(2), day(1), day(0)]);
check("scan day: LP × 2 at that day's market", pts[0].value, r2(lpAt(110)));
check("second copy joins on its scan day", pts[1].value, r2(lpAt(120) + nmAt(120)));
check("a missing day carries the last reading", pts[2].value, r2(lpAt(120) + nmAt(120)));
check("the sale day still counts the sold copy", pts[3].value, r2(lpAt(140) + nmAt(140)));
check("after the sale only the LP pair remains", pts[4].value, r2(lpAt(150)));
check("window shorter than the history trims the front", (await inventoryValueSeries(alice.id, "pokemon", 2, now)).map((p) => p.day), [day(1), day(0)]);
check("Magic pile is its own line", (await inventoryValueSeries(alice.id, "mtg", 10, now)).map((p) => [p.day, p.value]), [[day(0), nmAt(50)]]);
check("no catalog rows → no line", await inventoryValueSeries(bob.id, "mtg", 10, now), []);

console.log(failures === 0 ? "\nall inventory value checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
