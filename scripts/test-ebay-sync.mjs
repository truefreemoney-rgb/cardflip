/**
 * The three eBay read sweeps that close the loop after "publish", against a
 * fetch stub (no network): syncEbaySales (Fulfillment orders → sold),
 * syncEndedEbayListings (Inventory offers → ended), syncEbayFees (Finances
 * SALE transaction → real fees). Run: npm run test:ebaysync
 *
 * Pins — orders: not-connected / no-listings / throttle gates; a listing-id
 * match flips the card sold with price, date, and order ref; the same order
 * line is never applied twice; SKU is the fallback match; FAILED and
 * CANCELED orders are ignored; a quantity>1 card splits a sold row and stays
 * listed with the rest until the last copy goes; `next` pages are followed;
 * 403 → no_scope, any other failure → error (nothing thrown).
 * Ended: ACTIVE and OUT_OF_STOCK stay live; ENDED, INACTIVE, a 404 offer, and
 * an UNPUBLISHED offer with no listing block all stamp ebay_ended_at; offers
 * never published aren't checked. Fees: per-line marketplaceFees win; the
 * order total is used only for single-line orders; no SALE yet stays NULL
 * for the next pass; 403 → no_scope.
 *
 * The seller is linked through the real completeEbayConnect against the
 * stubbed token + identity endpoints, so getUserAccessToken runs for real
 * (AES-sealed row, expiry slack) — nothing inside the libs is mocked.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.EBAY_CLIENT_ID = "cid";
process.env.EBAY_CLIENT_SECRET = "csecret";
process.env.EBAY_RU_NAME = "ru";
process.env.EBAY_TOKEN_KEY = "test-token-key";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-ebaysync-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

// --- fetch stub ---------------------------------------------------------------
// Each eBay path is answered from a script the test sets per scenario.
const routes = { orders: [], offers: new Map(), finances: new Map(), token: null };
const calls = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  calls.push(url);
  if (url.includes("/identity/v1/oauth2/token")) {
    if (routes.token instanceof Response) return routes.token;
    if (routes.token === "down") throw new TypeError("fetch failed");
    return json({ access_token: "tok-1", expires_in: 7200, refresh_token: "ref-1", refresh_token_expires_in: 47304000, token_type: "User" });
  }
  if (url.includes("/commerce/identity/")) return json({ userId: "ebay-u1", username: "seller1" });
  if (url.includes("/sell/fulfillment/v1/order")) {
    const page = routes.orders.shift();
    if (page instanceof Response) return page;
    return json(page ?? { orders: [] });
  }
  const offer = url.match(/\/sell\/inventory\/v1\/offer\/([^/?]+)/);
  if (offer) {
    const r = routes.offers.get(decodeURIComponent(offer[1]));
    if (r instanceof Response) return r;
    return r ? json(r) : json({ errors: [{ errorId: 25713 }] }, 404);
  }
  if (url.includes("/sell/finances/v1/transaction")) {
    const orderId = decodeURIComponent(new URL(url).searchParams.get("filter") ?? "").match(/orderId:\{([^}]+)\}/)?.[1];
    const r = routes.finances.get(orderId);
    if (r instanceof Response) return r;
    return json(r ?? { transactions: [] });
  }
  throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
};
// The libs log every non-2xx; keep the test output readable.
const realError = console.error;
console.error = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { syncEbaySales } = await import(at("lib/server/ebayOrders.ts"));
const { syncEndedEbayListings } = await import(at("lib/server/ebayListings.ts"));
const { syncEbayFees } = await import(at("lib/server/ebayFinances.ts"));
const { completeEbayConnect, getUserAccessToken, getEbayLink, EbayUnreachableError } = await import(at("lib/server/ebayAuth.ts"));
const { createCard, getCardForUser, listCardsForUser } = await import(at("lib/server/cards.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const user = await createUser("Seller", "seller@example.com", "hunter22", "user");
const uid = user.id;

let n = 0;
async function listedCard(opts = {}) {
  const card = await createCard(uid, { cardName: `Card ${++n}`, setName: "Base Set", cardNumber: String(n), imageUrl: "", condition: "NM", price: 10 });
  await db
    .prepare("UPDATE cards SET status = 'listed', listed_at = ?, quantity = ?, ebay_listing_id = ?, ebay_sku = ?, ebay_offer_id = ? WHERE id = ?")
    .run(Date.now(), opts.quantity ?? 1, opts.listingId ?? null, opts.sku ?? null, opts.offerId ?? null, card.id);
  return card.id;
}
const status = async (id) => (await getCardForUser(id, uid))?.status ?? null;
const resetThrottle = () => db.prepare("DELETE FROM price_history_meta WHERE key LIKE 'ebay_%_sync:%'").run();
const order = (orderId, lines, extra = {}) => ({
  orderId,
  creationDate: "2026-09-01T12:00:00.000Z",
  orderPaymentStatus: "PAID",
  lineItems: lines.map((l, i) => ({ lineItemId: `${orderId}-L${i + 1}`, quantity: 1, lineItemCost: { value: "25.00" }, ...l })),
  ...extra,
});

// --- orders: gates ---------------------------------------------------------
check("orders: nothing listed → no_listings", (await syncEbaySales(uid)).skipped, "no_listings");
const c1 = await listedCard({ listingId: "L-100", sku: "sku-c1" });
check("orders: not connected → not_connected", (await syncEbaySales(uid)).skipped, "not_connected");

await completeEbayConnect(uid, "auth-code");
check("connect: token stored, sealed, and read back", await getUserAccessToken(uid), "tok-1");

// --- orders: listing-id match ---------------------------------------------
routes.orders = [{ orders: [order("O-1", [{ legacyItemId: "L-100" }])] }];
let r = await syncEbaySales(uid);
const sold1 = await getCardForUser(c1, uid);
check("orders: listing-id match flips the card sold", [r.skipped, r.sold.length, sold1.status], [undefined, 1, "sold"]);
check("orders: price, date, order ref recorded", [sold1.soldPrice, sold1.soldAt, sold1.ebayOrderId, sold1.ebayLineItemId], [25, Date.parse("2026-09-01T12:00:00.000Z"), "O-1", "O-1-L1"]);

// --- orders: idempotent, SKU fallback, ignored orders -----------------------
const c2 = await listedCard({ sku: "sku-c2" });
check("orders: second pass inside 10 min → throttled", (await syncEbaySales(uid)).skipped, "throttled");
await resetThrottle();
const c3 = await listedCard({ listingId: "L-300" });
const c4 = await listedCard({ listingId: "L-400" });
routes.orders = [{
  orders: [
    order("O-1", [{ legacyItemId: "L-100" }]), // already applied — c1 is sold, must not re-apply
    order("O-2", [{ sku: "sku-c2" }]),
    order("O-3", [{ legacyItemId: "L-300" }], { orderPaymentStatus: "FAILED" }),
    order("O-4", [{ legacyItemId: "L-400" }], { cancelStatus: { cancelState: "CANCELED" } }),
    order("O-5", [{ legacyItemId: "L-999" }]), // not ours
  ],
}];
r = await syncEbaySales(uid, true);
check("orders: SKU fallback sells c2; failed/canceled/unknown ignored; O-1 not re-applied", [r.sold.map((c) => c.id), await status(c3), await status(c4)], [[c2], "listed", "listed"]);
check("orders: applied lines remembered", (await db.prepare("SELECT COUNT(*) AS n FROM ebay_sold_lines").get()).n, 2);

// --- orders: quantity > 1 splits ------------------------------------------
const c5 = await listedCard({ listingId: "L-500", quantity: 3 });
routes.orders = [{ orders: [order("O-6", [{ legacyItemId: "L-500", quantity: 1 }])] }];
r = await syncEbaySales(uid, true);
const c5after = await getCardForUser(c5, uid);
check("orders: partial sale splits a sold row, listing stays live with 2", [r.sold.length, r.sold[0].status, r.sold[0].quantity, c5after.status, c5after.quantity], [1, "sold", 1, "listed", 2]);
routes.orders = [{ orders: [order("O-7", [{ legacyItemId: "L-500", quantity: 2 }])] }];
r = await syncEbaySales(uid, true);
check("orders: last copies sold → the card itself is sold", [r.sold.length, await status(c5)], [1, "sold"]);

// --- orders: pagination + failures ----------------------------------------
const c6 = await listedCard({ listingId: "L-600" });
routes.orders = [
  { orders: [], next: "https://api.ebay.com/sell/fulfillment/v1/order?offset=200" },
  { orders: [order("O-8", [{ legacyItemId: "L-600" }])] },
];
calls.length = 0;
r = await syncEbaySales(uid, true);
check("orders: `next` page followed", [r.sold.length, calls.filter((u) => u.includes("/order")).length, calls[1]?.includes("offset=200")], [1, 2, true]);

const c7 = await listedCard({ listingId: "L-700" });
routes.orders = [json({ errors: [{ errorId: 1100 }] }, 403)];
check("orders: 403 → no_scope, nothing thrown", (await syncEbaySales(uid, true)).skipped, "no_scope");
routes.orders = [json({}, 500)];
check("orders: 500 → error, nothing thrown", (await syncEbaySales(uid, true)).skipped, "error");
check("orders: c7 untouched by failures", await status(c7), "listed");

// --- ended listings ----------------------------------------------------------
const active = await listedCard({ listingId: "L-A", offerId: "OF-A" });
const oos = await listedCard({ listingId: "L-B", offerId: "OF-B" });
const endedOffer = await listedCard({ listingId: "L-C", offerId: "OF-C" });
const inactive = await listedCard({ listingId: "L-D", offerId: "OF-D" });
const gone = await listedCard({ listingId: "L-E", offerId: "OF-E" });
const purged = await listedCard({ listingId: "L-F", offerId: "OF-F" });
const neverPublished = await listedCard({ offerId: "OF-G" });
routes.offers = new Map([
  ["OF-A", { status: "PUBLISHED", listing: { listingStatus: "ACTIVE" } }],
  ["OF-B", { status: "PUBLISHED", listing: { listingStatus: "OUT_OF_STOCK" } }],
  ["OF-C", { status: "PUBLISHED", listing: { listingStatus: "ENDED" } }],
  ["OF-D", { status: "PUBLISHED", listing: { listingStatus: "INACTIVE" } }],
  ["OF-F", { status: "UNPUBLISHED" }],
]);
calls.length = 0;
let e = await syncEndedEbayListings(uid, true);
const endedAt = async (id) => Boolean((await getCardForUser(id, uid)).ebayEndedAt);
check("ended: ACTIVE and OUT_OF_STOCK stay live", [await endedAt(active), await endedAt(oos)], [false, false]);
check("ended: ENDED, INACTIVE, 404, UNPUBLISHED-without-listing stamped", [await endedAt(endedOffer), await endedAt(inactive), await endedAt(gone), await endedAt(purged)], [true, true, true, true]);
check("ended: result lists the four", e.ended.map((c) => c.id).sort(), [endedOffer, inactive, gone, purged].sort());
check("ended: never-published offer not checked", [await endedAt(neverPublished), calls.some((u) => u.includes("OF-G"))], [false, false]);
check("ended: throttled on the next pass", (await syncEndedEbayListings(uid)).skipped, "throttled");
routes.offers = new Map([["OF-A", json({}, 500)]]);
check("ended: 500 → error, nothing thrown", (await syncEndedEbayListings(uid, true)).skipped, "error");

// --- fees --------------------------------------------------------------------
const fresh = await createUser("Buyer", "b@example.com", "hunter22", "user");
check("fees: nothing pending → nothing", (await syncEbayFees(fresh.id)).skipped, "nothing");

const fee = async (id) => (await getCardForUser(id, uid)).soldFees;
// c1 (O-1, line O-1-L1), c2 (O-2, O-2-L1), c6 (O-8, O-8-L1) are sold with order refs.
routes.finances = new Map([
  ["O-1", { transactions: [{ transactionType: "SALE", orderId: "O-1", totalFeeAmount: { value: "9.99" }, orderLineItems: [{ lineItemId: "O-1-L1", marketplaceFees: [{ amount: { value: "3.25" } }, { amount: { value: "0.30" } }] }] }] }],
  ["O-2", { transactions: [{ transactionType: "SALE", orderId: "O-2", totalFeeAmount: { value: "4.10" }, orderLineItems: [{ lineItemId: "other-line" }] }] }],
  ["O-8", { transactions: [{ transactionType: "REFUND", orderId: "O-8" }] }],
]);
let f = await syncEbayFees(uid, true);
check("fees: per-line fees summed for the matching line", await fee(c1), 3.55);
check("fees: single-line order falls back to the order total", await fee(c2), 4.1);
check("fees: no SALE transaction yet → still NULL, retried next pass", await fee(c6), null);
check("fees: result names the updated cards", f.updated.sort(), [c1, c2].sort());

// A multi-line order without our line named must not guess from the total.
routes.finances = new Map([
  ["O-8", { transactions: [{ transactionType: "SALE", orderId: "O-8", totalFeeAmount: { value: "7.00" }, orderLineItems: [{ lineItemId: "x" }, { lineItemId: "y" }] }] }],
]);
await syncEbayFees(uid, true);
check("fees: multi-line order with no line match → left NULL", await fee(c6), null);

routes.finances = new Map([["O-8", json({}, 403)]]);
check("fees: 403 → no_scope", (await syncEbayFees(uid, true)).skipped, "no_scope");
check("fees: throttled on the next pass", (await syncEbayFees(uid)).skipped, "throttled");

// --- token refresh failures never 500 ---------------------------------------
// Expire the access token so the next call must refresh; eBay's answer decides.
const expireAccess = () => db.prepare("UPDATE ebay_tokens SET access_expires_at = 0 WHERE user_id = ?").run(uid);
await resetThrottle();
await expireAccess();
routes.token = "down";
check("refresh: network failure → skipped 'error', link kept", [(await syncEbaySales(uid, true)).skipped, Boolean(await getEbayLink(uid))], ["error", true]);
routes.token = json({ error: "server_error" }, 503);
check("refresh: eBay 5xx → skipped 'error', link kept", [(await syncEbayFees(uid, true)).skipped, Boolean(await getEbayLink(uid))], ["error", true]);
let refreshErr = null;
try { await getUserAccessToken(uid); } catch (e) { refreshErr = e; }
check("refresh: 5xx surfaces as EbayUnreachableError to sell callers", refreshErr instanceof EbayUnreachableError, true);
routes.token = json({ error: "invalid_grant" }, 400);
check("refresh: invalid_grant → not_connected and the link is dropped", [(await syncEbaySales(uid, true)).skipped, await getEbayLink(uid)], ["not_connected", null]);
routes.token = null;

// Sanity: the ledger is what the sweeps say it is.
const all = await listCardsForUser(uid);
check("ledger: sold rows carry order refs", all.filter((c) => c.status === "sold").every((c) => c.ebayOrderId));

console.error = realError;
globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
