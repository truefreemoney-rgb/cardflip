/**
 * #27 (audit 10-16): the eBay routes that act on the seller's eBay account are
 * paid, like publishing, and the eBay callback never 500s on a mangled cookie.
 * Run: npm run test:ebaygates
 *
 * Pins:
 *  - POST /api/ebay/offers (send one watcher offer): trial = 402, paid passes the gate;
 *  - PATCH /api/ebay/offers: turning auto-offers ON = 402 for trial, OFF always works;
 *  - POST /api/ebay/reprice: a card with a live eBay offer = 402 for trial (and its
 *    price is untouched); a card with no offer is a ledger price, open to everyone;
 *  - POST /api/ebay/end stays open: a lapsed seller can always take a listing down;
 *  - GET /api/ebay/callback with a cookie decodeURIComponent can't read = the
 *    "expired" state page, not a crash; a same-length non-ASCII signature too.
 *
 * Throwaway db; next/headers is stubbed so requireUser() reads the cookie jar this test fills.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.EBAY_CLIENT_ID = "cid";
process.env.EBAY_CLIENT_SECRET = "csecret";
process.env.EBAY_RU_NAME = "ru";
process.env.EBAY_TOKEN_KEY = "test-token-key";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-ebaygates-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});
console.error = () => {};
console.warn = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { testCookies } = await import("next/headers");
const offers = await import(at("app/api/ebay/offers/route.ts"));
const reprice = await import(at("app/api/ebay/reprice/route.ts"));
const end = await import(at("app/api/ebay/end/route.ts"));
const callback = await import(at("app/api/ebay/callback/route.ts"));
const { SESSION_COOKIE } = await import(at("lib/server/auth.ts"));
const { createSession } = await import(at("lib/server/sessions.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { createCard, getCardForUser } = await import(at("lib/server/cards.ts"));
const { createOAuthState } = await import(at("lib/server/ebayAuth.ts"));
const { EBAY_STATE_COOKIE } = await import(at("lib/server/ebayFlow.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const json = (method, body) =>
  new Request("http://test/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function signIn(user) {
  const { token } = await createSession(user.id);
  testCookies.set(SESSION_COOKIE, token);
}
async function liveCard(userId, { offer = true } = {}) {
  const card = await createCard(userId, { cardName: "Charizard", setName: "Base Set", cardNumber: "4", imageUrl: "", condition: "NM", price: 20 });
  if (offer) {
    await db.prepare("UPDATE cards SET status = 'listed', ebay_offer_id = 'O-1', ebay_listing_id = 'L-1', listed_at = ? WHERE id = ?").run(Date.now(), card.id);
  }
  return card;
}

const trial = await createUser("Trial", "trial@example.com", "hunter22", "user");
const paid = await createUser("Paid", "paid@example.com", "hunter22", "user");
await db.prepare("UPDATE users SET sub_status = 'active' WHERE id = ?").run(paid.id);

console.log("Trial account");
await signIn(trial);
{
  const card = await liveCard(trial.id);
  let res = await offers.POST(json("POST", { cardId: card.id, discountPercent: 10 }));
  check("send watcher offer = 402", res.status, 402);
  res = await offers.PATCH(json("PATCH", { autoOfferPercent: 15 }));
  check("turn auto-offers on = 402", res.status, 402);
  check("...and nothing saved", (await db.prepare("SELECT auto_offer_percent AS p FROM users WHERE id = ?").get(trial.id)).p, null);
  res = await offers.PATCH(json("PATCH", { autoOfferPercent: null }));
  check("turn auto-offers off = 200", res.status, 200);
  res = await reprice.POST(json("POST", { cardId: card.id, price: 25 }));
  check("reprice a live eBay listing = 402", res.status, 402);
  check("...and the price is untouched", (await getCardForUser(card.id, trial.id)).price, 20);
  const plain = await liveCard(trial.id, { offer: false });
  res = await reprice.POST(json("POST", { cardId: plain.id, price: 25 }));
  check("reprice a card that isn't on eBay = 200 (ledger only)", [res.status, (await getCardForUser(plain.id, trial.id)).price], [200, 25]);
  const csv = await liveCard(trial.id);
  await db.prepare("UPDATE cards SET ebay_listing_id = NULL WHERE id = ?").run(csv.id);
  res = await end.POST(json("POST", { cardId: csv.id }));
  check("end a listing stays open (no eBay call needed here) = 200", res.status, 200);
}

console.log("Paid account");
await signIn(paid);
{
  const card = await liveCard(paid.id);
  let res = await offers.PATCH(json("PATCH", { autoOfferPercent: 15 }));
  check("turn auto-offers on = 200", res.status, 200);
  res = await offers.POST(json("POST", { cardId: card.id, discountPercent: 10 }));
  check("send watcher offer passes the gate (not connected -> 502, not 402)", res.status, 502);
  res = await reprice.POST(json("POST", { cardId: card.id, price: 25 }));
  const body = await res.json();
  check("reprice a live listing passes the gate (ledger saved, eBay not connected)", [res.status, body.card?.price, body.ebayUpdated], [200, 25, false]);
}

console.log("Callback never crashes on a bad state cookie");
{
  const get = (state, cookie) =>
    callback.GET(new Request(`http://test/api/ebay/callback?code=abc&state=${encodeURIComponent(state)}`, { headers: { cookie: `${EBAY_STATE_COOKIE}=${cookie}` } }));
  const where = (res) => res.headers.get("location") ?? "";
  let res = await get("x.y", "%E0%A4%A");
  check("mangled %-escape in the cookie -> the state page, not a 500", [res.status < 500, where(res).includes("error=state")], [true, true]);
  const good = createOAuthState(paid.id);
  const [nonce, sig] = good.split(".");
  const evil = `${nonce}.${"é".repeat(sig.length)}`;
  res = await get(evil, encodeURIComponent(evil));
  check("same-length non-ASCII signature -> the state page, not a crash", [res.status < 500, where(res).includes("error=state")], [true, true]);
}

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll eBay gate checks passed.");
