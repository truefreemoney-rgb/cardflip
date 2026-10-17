/**
 * Per-account row caps (#26, 10-17): cards (unsold only) and watchlist refuse at the cap, price-check history keeps
 * the newest rows. Small caps passed in; the real numbers live in lib/server/rowCaps.ts.
 * Run: npm run test:rowcaps
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-rowcaps-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { db } = await import(at("lib/db.ts"));
const { cardsFull, wishlistFull, trimPriceChecks, ROW_CAPS } = await import(at("lib/server/rowCaps.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const { createUser } = await import(at("lib/server/users.ts"));
const U1 = (await createUser("A", "a@x.io", "pw-long-enough")).id;
const U2 = (await createUser("B", "b@x.io", "pw-long-enough")).id;
const now = Date.now();
const card = (id, user, status) =>
  db.prepare("INSERT INTO cards (id, user_id, card_name, set_name, card_number, image_url, condition, status, price, created_at, updated_at) VALUES (?, ?, 'X', 'S', '1', '', 'Near Mint', ?, 1, ?, ?)").run(id, user, status, now, now);
await card("c1", U1, "ready");
await card("c2", U1, "listed");
check("cards: 2 of 3 is not full", await cardsFull(U1, 3), false);
await card("c3", U1, "sold");
check("cards: a sold card never counts", await cardsFull(U1, 3), false);
await card("c4", U1, "ready");
check("cards: 3 unsold of 3 is full", await cardsFull(U1, 3), true);
check("cards: another account is not", await cardsFull(U2, 3), false);

const watch = (id, user) =>
  db.prepare("INSERT INTO wishlist_items (id, user_id, card_name, set_name, card_number, language, added_at) VALUES (?, ?, ?, 'S', '1', 'en', ?)").run(id, user, id, now);
await watch("w1", U1);
check("watchlist: 1 of 2 is not full", await wishlistFull(U1, 2), false);
await watch("w2", U1);
check("watchlist: 2 of 2 is full", await wishlistFull(U1, 2), true);

const look = (id, user, t) =>
  db.prepare("INSERT INTO price_checks (id, user_id, card_name, set_name, card_number, language, prices_json, checked_at) VALUES (?, ?, 'X', 'S', '1', 'en', '[]', ?)").run(id, user, t);
for (let i = 1; i <= 7; i++) await look(`p${i}`, U1, now + i);
await look("q1", U2, now);
await trimPriceChecks(U1, 5);
const kept = (await db.prepare("SELECT id FROM price_checks WHERE user_id = ? ORDER BY checked_at").all(U1)).map((r) => r.id);
check("price checks: the newest 5 stay, the 2 oldest go", kept, ["p3", "p4", "p5", "p6", "p7"]);
check("price checks: another account untouched", (await db.prepare("SELECT COUNT(*) AS n FROM price_checks WHERE user_id = ?").get(U2)).n, 1);
await trimPriceChecks(U2, 5);
check("price checks: under the cap nothing goes", (await db.prepare("SELECT COUNT(*) AS n FROM price_checks WHERE user_id = ?").get(U2)).n, 1);

check("caps far above real use (prod 10-17 max: 45 cards, 6 watched, 14 lookups)", ROW_CAPS.cards >= 10_000 && ROW_CAPS.wishlist >= 500 && ROW_CAPS.priceChecks >= 100, true);
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
check("POST /api/cards checks the cap", src("app/api/cards/route.ts").includes("await cardsFull(user.id)"));
check("POST /api/wishlist checks the cap", src("app/api/wishlist/route.ts").includes("await wishlistFull(user.id)"));
check("a new lookup trims the history", src("lib/server/priceChecks.ts").includes("await trimPriceChecks(userId)"));

await db.close?.();
console.log(failures === 0 ? "\nAll row-cap checks passed" : `\n${failures} row-cap check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
