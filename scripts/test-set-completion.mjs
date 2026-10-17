/**
 * Set completion (Tier 2 #6). Run: npm run test:setcompletion
 *
 * Pins: owned = unsold rows keyed by catalog id (a sold copy and a second
 * copy don't count twice; a card with no catalog id is ignored); the set's
 * size is its mirror row count; missing list in printed order with today's
 * price, cost to finish = the priced ones, unpriced counted; cheapest ten
 * sorted by price; sets ordered most-complete first; a complete set has no
 * missing list; a set the seller owns nothing from is not shown.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-sets-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { setCompletion, missingInSet } = await import(at("lib/server/setCompletion.ts"));
const { createCard } = await import(at("lib/server/cards.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const seed = db.prepare(
  `INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url, set_card_count_official, set_card_count_total, set_code, synced_at)
   VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, 0)`,
);
// Base: 4 cards (3 printed + 1 secret). Jungle: 2 cards. Fossil: 1 card, never owned.
for (const [id, name, num] of [["base-1", "Alakazam", "1"], ["base-2", "Blastoise", "2"], ["base-3", "Chansey", "3"], ["base-4", "Secret", "4"]])
  await seed.run(id, name, "base", "Base Set", num, "1999-01-09", 3, 4, "BS");
for (const [id, name, num] of [["jungle-1", "Clefable", "1"], ["jungle-2", "Electrode", "2"]]) await seed.run(id, name, "jungle", "Jungle", num, "1999-06-16", 2, 2, "JU");
await seed.run("fossil-1", "Aerodactyl", "fossil", "Fossil", "1", "1999-10-10", 1, 1, "FO");
await recordPoint("base-2", "pokemon", "normal", "tcgplayer", "USD", 40);
await recordPoint("base-3", "pokemon", "normal", "tcgplayer", "USD", 2.5);
// base-4 has no usable price on purpose: a stuck round $500 for 87 days, which the site price guard
// (priceTrustSite) flags, so it counts as unpriced and adds nothing to the cost to finish.
{
  const { junkPrices, recordSeries } = await import("./lib/liquid-series.mjs");
  const { addDays, todayUtc } = await import(new URL("../src/lib/priceSeries.ts", import.meta.url).href);
  await recordSeries(recordPoint, addDays, todayUtc(), "base-4", "pokemon", "holofoil", junkPrices(500));
}

const u = await createUser("Seller", "seller@example.com", "hunter22", "user");
const card = (name, catalogId) => createCard(u.id, { cardName: name, setName: "x", cardNumber: "1", imageUrl: "", condition: "NM", price: 1, catalogCardId: catalogId });
await card("Alakazam", "base-1");
await card("Alakazam again", "base-1");
const soldB = await card("Blastoise", "base-2");
await db.prepare("UPDATE cards SET status = 'sold', sold_at = 1 WHERE id = ?").run(soldB.id);
await card("Clefable", "jungle-1");
await card("Electrode", "jungle-2");
await card("No catalog", null);

const sets = await setCompletion(u.id);
check("sets owned from, most complete first, Fossil absent", sets.map((s) => [s.setName, s.owned, s.total, s.pct]), [["Jungle", 2, 2, 100], ["Base Set", 1, 4, 25]]);
const base = sets[1];
check("printed count rides along", base.printed, 3);
check("missing = sold copy + never owned, cost = priced ones, unpriced counted", [base.missing, base.costToFinish, base.unpriced], [3, 42.5, 1]);
check("cheapest first, unpriced left out", base.cheapest.map((c) => [c.name, c.price]), [["Chansey", 2.5], ["Blastoise", 40]]);
check("a complete set has nothing to buy", [sets[0].missing, sets[0].costToFinish, sets[0].cheapest.length], [0, 0, 0]);
check("full missing list in printed order with prices", (await missingInSet(u.id, "base")).map((c) => [c.number, c.name, c.price]), [["2", "Blastoise", 40], ["3", "Chansey", 2.5], ["4", "Secret", null]]);
const nobody = await createUser("Nobody", "nobody@example.com", "hunter22", "user");
check("no cards → no sets", await setCompletion(nobody.id), []);

// Other games (10-06): Magic keyed by set_code with collector numbers like "123a", One Piece by "code|name" with OP01-001 codes.
{
  const mtg = db.prepare("INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, set_release_date, image_url, lang, synced_at) VALUES (?, ?, 'ltr', 'Lord of the Rings', ?, '2023-06-23', 'x.jpg', 'en', 0)");
  for (const [id, n, num] of [["m1", "Frodo", "9"], ["m2", "Sam", "10"], ["m3", "Sam alt", "10a"], ["m4", "Gollum", "123a"]]) await mtg.run(id, n, num);
  const tcg = db.prepare("INSERT INTO tcg_cards (id, game, name, subtitle, set_code, set_name, collector_number, set_total, image_url, synced_at) VALUES (?, 'onepiece', ?, '', 'OP01', 'Romance Dawn', ?, 121, 'y.png', 0)");
  for (const [id, n, num] of [["op1", "Zoro", "OP01-025"], ["op2", "Luffy", "OP01-003"], ["op3", "Nami", "OP01-016"]]) await tcg.run(id, n, num);
  await createCard(u.id, { cardName: "Frodo", setName: "x", cardNumber: "9", imageUrl: "", condition: "NM", price: 1, catalogCardId: "m1", game: "mtg" });
  await createCard(u.id, { cardName: "Luffy", setName: "x", cardNumber: "3", imageUrl: "", condition: "NM", price: 1, catalogCardId: "op2", game: "onepiece" });
  const m = await setCompletion(u.id, "mtg");
  check("magic: own 1 of 4 in the ltr set", m.map((x) => [x.setId, x.owned, x.total]), [["ltr", 1, 4]]);
  check("magic missing in numeric order, 123a last", (await missingInSet(u.id, "ltr", "mtg")).map((c) => c.number), ["10", "10a", "123a"]);
  const op = await setCompletion(u.id, "onepiece");
  check("one piece: own 1 of 3", op.map((x) => [x.setId, x.owned, x.total]), [["OP01|Romance Dawn", 1, 3]]);
  check("one piece missing in code order", (await missingInSet(u.id, "OP01|Romance Dawn", "onepiece")).map((c) => c.number), ["OP01-016", "OP01-025"]);
  check("games stay apart", (await setCompletion(u.id, "lorcana")).length, 0);
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
