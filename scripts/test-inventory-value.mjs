/**
 * Inventory value over time (lib/server/inventoryValue.ts) — the graph under
 * the Inventory panel. Run: npm run test:inventoryvalue
 *
 * Pins: every held card counts across the window at askingPriceFor(market,
 * condition) × quantity (market view of today's pile); days before the series
 * has a reading are dropped; a sold copy leaves the pile after its sale day; a missing series day carries the last reading;
 * another user's cards and the other game never leak in. The site price guard
 * (priceTrustSite): a card whose market the rule flags contributes nothing on
 * any day of the line, and collection insights leave it out of holding, top and
 * movers (counted in leftOut) unless the seller typed its price.
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
const { collectionInsights } = await import(at("lib/server/insights.ts"));
const { junkPrices, recordSeries, hideByAdmin } = await import("./lib/liquid-series.mjs");
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
// A $150 card with five priced days is "unverified" to the price guard on its own; Cardmarket (EUR 100 = $110) agrees, which vouches for it.
await recordPoint("base1-4", "pokemon", "average", "cardmarket", "EUR", 100, day(0));

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

check("starts on the first series reading, one point a day to today", pts.map((p) => p.day), [day(5), day(4), day(3), day(2), day(1), day(0)]);
check("a card scanned later still counts on earlier days (market view)", pts[0].value, r2(lpAt(100) + nmAt(100)));
check("LP × 2 + NM at that day's market", pts[1].value, r2(lpAt(110) + nmAt(110)));
check("a missing day carries the last reading", pts[3].value, r2(lpAt(120) + nmAt(120)));
check("the sale day still counts the sold copy", pts[4].value, r2(lpAt(140) + nmAt(140)));
check("after the sale only the LP pair remains", pts[5].value, r2(lpAt(150)));
check("window shorter than the history trims the front", (await inventoryValueSeries(alice.id, "pokemon", 2, now)).map((p) => p.day), [day(1), day(0)]);
check("Magic pile is its own line", (await inventoryValueSeries(alice.id, "mtg", 10, now)).map((p) => [p.day, p.value]), [[day(0), nmAt(50)]]);
check("no catalog rows → no line", await inventoryValueSeries(bob.id, "mtg", 10, now), []);

console.log("\nthe price guard");
{
  await createCard(alice.id, { ...base, cardName: "Deoxys", condition: "Near Mint", catalogCardId: "junk-deoxys" });
  const typed = await createCard(alice.id, { ...base, cardName: "Typed", condition: "Near Mint", catalogCardId: "junk-deoxys" });
  await db.prepare("UPDATE cards SET price = 480, price_locked = 1 WHERE id = ?").run(typed.id);
  await recordSeries(recordPoint, addDays, today, "junk-deoxys", "pokemon", "holofoil", junkPrices(500)); // a 5x spike that never came back (hidden) ...
  await hideByAdmin(db, addDays, today, "junk-deoxys", "pokemon", "holofoil", 500); // ... and hidden by an admin, so it has NO fallback (10-17): the only flag that still leaves a card out
  const after = await inventoryValueSeries(alice.id, "pokemon", 10, now);
  check("a flagged card adds nothing on any day: the line is exactly as before", after, pts);
  const ins = await collectionInsights(alice.id, "pokemon", now);
  const names = [...ins.top.map((c) => c.name), ...ins.gainers.map((c) => c.name), ...ins.losers.map((c) => c.name)];
  check("insights: the flagged copy is left out and counted", [names.includes("Deoxys"), ins.leftOut], [false, 1]);
  check("insights: the seller-typed price of the same market still counts", ins.top.find((c) => c.name === "Typed")?.price, 480);
  check("insights: holding = the LP pair + the typed price + the $1 old scan", ins.holding, r2(lpAt(150) + 480 + 1));
  // A live listing whose market is flagged: the ask is the seller's own number even though the lock was never set.
  const listedJunk = await createCard(alice.id, { ...base, cardName: "Listed", condition: "Near Mint", catalogCardId: "junk-deoxys" });
  await db.prepare("UPDATE cards SET price = 420, status = 'listed' WHERE id = ?").run(listedJunk.id);
  const ins2 = await collectionInsights(alice.id, "pokemon", now);
  check("insights: a live listing on a flagged market counts at its ask (holding, live split) and is not left out", [ins2.top.find((c) => c.name === "Listed")?.price, ins2.holding, ins2.leftOut], [420, r2(lpAt(150) + 480 + 1 + 420), 1]);
  check("... and it is in the live split at that ask", ins2.split.live, { count: 1, value: 420 });
  check("a seller with no flagged card has leftOut 0", (await collectionInsights(bob.id, "pokemon", now)).leftOut, 0);
}

console.log("\na flag WITH a fallback (10-17): the card is priced from it, not left out");
{
  // The same 5x spike, but the guard knows the level before the jump: that prices the card (flat across the line, its spike days are the junk).
  const dana = await createUser("Dana", "dana@example.com", "hunter22");
  await recordSeries(recordPoint, addDays, today, "spike-fb", "pokemon", "holofoil", junkPrices(500));
  await createCard(dana.id, { ...base, cardName: "Spiked", condition: "Near Mint", catalogCardId: "spike-fb" });
  const line = await inventoryValueSeries(dana.id, "pokemon", 10, now);
  const v = line[0]?.value;
  check("value line: a flagged card with a fallback is on the line at the fallback (not the $500 spike, not absent)", [line.length, v > nmAt(90) && v < nmAt(120), line.every((p) => p.value === v)], [10, true, true]);
  const ins = await collectionInsights(dana.id, "pokemon", now);
  check("insights: priced at the same fallback, counted in holding, not left out", [ins.leftOut, ins.holding, ins.top[0]?.name, ins.top[0]?.price], [0, v, "Spiked", v]);
  check("... and no week-ago from the spiked series, so it is no mover", [ins.gainers.length, ins.losers.length], [0, 0]);
}

console.log("\na foil copy: the insights hero and the value line price the same printing");
{
  // Normal $10, foil $40 (Chris's Magic 10-15: Opposition Agent hero $30.96 vs Inventory $40.39, hero $137.14 vs chart $165.18).
  const carol = await createUser("Carol", "carol@example.com", "hunter22");
  for (const back of [2, 1, 0]) {
    await recordPoint("mtg-foil", "mtg", "normal", "tcgplayer", "USD", 10, day(back));
    await recordPoint("mtg-foil", "mtg", "foil", "tcgplayer", "USD", 40, day(back));
  }
  const foil = await createCard(carol.id, { ...base, cardName: "Opposition Agent", condition: "Near Mint", catalogCardId: "mtg-foil" });
  await db.prepare("UPDATE cards SET game = 'mtg', variant = 'foil', created_at = ? WHERE id = ?").run(msOn(2), foil.id);
  const line = await inventoryValueSeries(carol.id, "mtg", 10, now);
  const ins = await collectionInsights(carol.id, "mtg", now);
  check("the value line prices the foil line", line.at(-1)?.value, r2(nmAt(40)));
  check("insights hero = the line's last point (the foil, not the normal)", ins.holding, line.at(-1)?.value);
  check("insights' 7-day change starts from the same number", ins.value.now, ins.holding);
}

console.log(failures === 0 ? "\nall inventory value checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
