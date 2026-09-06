/**
 * The eBay sell path over a fetch stub: pushDraft (inventory item + offer),
 * publishDraft (policies, ship-from location, stale offer recovery, publish),
 * updateOfferPrice, withdrawOffer. Run: npm run test:ebaysell
 *
 * Pins — gates: unknown card 404; unverified card 409 (the match gate); no
 * stored photo → needs "photo"; a bad draft 400; not connected → the
 * not-connected error. Push: inventory PUT to the card's SKU, offer POST
 * when none, offer PUT when one exists, a 404 on that PUT mints a fresh
 * offer; the seller-defaults probe reports which policies exist; eBay's
 * opaque 500 on the item makes the push bisect (drops condition detail
 * first) and reports what was dropped; any other status propagates.
 * Publish: no offer → 409; missing policies get created then re-read;
 * no location + no ZIP → needs "location"; with a ZIP the location is
 * created once; the offer is PUT back whole with policies + location and
 * without the forbidden fields; the listing id/URL land on the card and it
 * flips to listed; warnings pass through; a 25713 on the offer GET clears
 * the offer id and asks for a re-push. Reprice: PUT carries only the new
 * pricingSummary over the current offer. Withdraw: POSTs withdraw; a gone
 * listing counts as ended.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.EBAY_CLIENT_ID = "cid";
process.env.EBAY_CLIENT_SECRET = "csecret";
process.env.EBAY_RU_NAME = "ru";
process.env.EBAY_TOKEN_KEY = "test-token-key";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-sell-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

// --- fetch stub ---------------------------------------------------------------
// state = what eBay "has"; log = every call (method, path, body).
const state = {
  policies: { f: null, p: null, r: null },
  optedIn: true,
  location: null,
  offers: new Map(), // offerId → offer object
  nextOfferId: 1,
  itemPutStatus: () => 200, // called per PUT attempt
  publishStatus: 200,
  publishWarnings: [],
};
const log = [];
const json = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status });
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const p = url.replace(/^https?:\/\/[^/]+/, "");
  let body;
  try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
  log.push({ method, path: p, body });
  if (p.includes("/identity/v1/oauth2/token")) {
    return json({ access_token: "tok-1", expires_in: 7200, refresh_token: "ref-1", refresh_token_expires_in: 47304000, token_type: "User" });
  }
  if (p.includes("/commerce/identity/")) return json({ userId: "ebay-u1", username: "seller1" });

  // Account: policies
  const pol = p.match(/\/sell\/account\/v1\/(fulfillment|payment|return)_policy/);
  if (pol) {
    const k = pol[1][0];
    if (!state.optedIn) return json({ errors: [{ errorId: 20403 }] }, 400);
    if (method === "POST") { state.policies[k] = `${pol[1]}-1`; return json({ [`${pol[1]}PolicyId`]: state.policies[k] }, 201); }
    const list = state.policies[k] ? [{ [`${pol[1]}PolicyId`]: state.policies[k] }] : [];
    return json({ [`${pol[1]}Policies`]: list });
  }
  if (p.includes("/sell/account/v1/program/opt_in")) { state.optedIn = true; return json({}); }

  // Inventory: location
  if (p.startsWith("/sell/inventory/v1/location/") && method === "POST") { state.location = p.split("/").pop(); return json(undefined, 204); }
  if (p.startsWith("/sell/inventory/v1/location")) return json({ locations: state.location ? [{ merchantLocationKey: state.location }] : [] });

  // Inventory: item
  if (p.startsWith("/sell/inventory/v1/inventory_item/") && method === "PUT") {
    const status = state.itemPutStatus(body);
    return status === 200 ? json(undefined, 204) : json({ errors: [{ errorId: status === 500 ? 25001 : 1 }] }, status);
  }

  // Inventory: offers
  if (p === "/sell/inventory/v1/offer" && method === "POST") {
    const id = `OF-${state.nextOfferId++}`;
    state.offers.set(id, { offerId: id, sku: body.sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE", status: "UNPUBLISHED", ...body });
    return json({ offerId: id }, 201);
  }
  const of = p.match(/^\/sell\/inventory\/v1\/offer\/([^/]+)(\/publish|\/withdraw)?$/);
  if (of) {
    const id = decodeURIComponent(of[1]);
    const offer = state.offers.get(id);
    if (!offer) return json({ errors: [{ errorId: 25713, message: "This Offer is not available." }] }, 404);
    if (of[2] === "/publish") {
      if (state.publishStatus !== 200) return json({ errors: [{ errorId: 25002 }] }, state.publishStatus);
      offer.status = "PUBLISHED";
      offer.listing = { listingId: `LI-${id}`, listingStatus: "ACTIVE" };
      return json({ listingId: `LI-${id}`, warnings: state.publishWarnings });
    }
    if (of[2] === "/withdraw") { offer.status = "UNPUBLISHED"; delete offer.listing; return json({ listingId: `LI-${id}` }); }
    if (method === "GET") return json(offer);
    if (method === "PUT") { state.offers.set(id, { ...offer, ...body, offerId: id }); return json(undefined, 204); }
  }
  throw new Error(`unexpected fetch ${method} ${p}`);
};
const quiet = { error: console.error, warn: console.warn, info: console.info };
console.error = () => {};
console.warn = () => {};
console.info = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { pushDraft, publishDraft, updateOfferPrice, withdrawOffer, EbaySellError, EbayPublishNeedsError, EbayNotConnectedError } = await import(at("lib/server/ebaySell.ts"));
const { skuForCard } = await import(at("lib/ebayInventory.ts"));
const { completeEbayConnect } = await import(at("lib/server/ebayAuth.ts"));
const { createCard, getCardForUser, updateCard } = await import(at("lib/server/cards.ts"));
const { storeCardPhoto } = await import(at("lib/server/cardPhotos.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { db } = await import(at("lib/db.ts"));
const skuOf = async (id) => (await db.prepare("SELECT ebay_sku FROM cards WHERE id = ?").get(id))?.ebay_sku ?? null;

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}
async function thrown(p) {
  try { await p; return null; } catch (err) { return err; }
}
const calls = (method, frag) => log.filter((c) => c.method === method && c.path.includes(frag));

const user = await createUser("Seller", "seller@example.com", "hunter22", "user");
const uid = user.id;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);

async function readyCard({ verified = true, photo = true } = {}) {
  const c = await createCard(uid, { cardName: "Charizard", setName: "Base Set", cardNumber: "4", imageUrl: "https://img/4.png", condition: "Near Mint", price: 818 });
  if (verified) await updateCard(c.id, uid, { verifiedAt: Date.now() });
  if (photo) {
    const r = await storeCardPhoto(c.id, uid, JPEG);
    if (!r.ok) throw new Error(`photo store failed: ${r.reason}`);
  }
  return c.id;
}
const draftFor = (cardId, over = {}) => ({
  cardId,
  listing: {
    title: "Charizard Base Set 4 Pokemon TCG Near Mint",
    description: "Charizard — Base Set, card 4. Condition: Near Mint.",
    price: 818,
    categoryId: "183454",
    categoryName: "Collectible Card Games > Pokémon TCG > Individual Cards",
  },
  card: { name: "Charizard", englishName: null, setName: "Base Set", number: "4", rarity: "Rare Holo", imageLarge: "https://img/4.png", imageSmall: "https://img/4s.png" },
  kind: "card",
  condition: "Near Mint",
  grading: null,
  firstEdition: false,
  productType: null,
  language: "en",
  ...over,
});

// --- gates -----------------------------------------------------------------------
let err = await thrown(pushDraft(uid, draftFor("nope")));
check("push: unknown card → 404", [err instanceof EbaySellError, err?.status], [true, 404]);
const unverified = await readyCard({ verified: false });
err = await thrown(pushDraft(uid, draftFor(unverified)));
check("push: unverified card → 409 match gate", [err instanceof EbaySellError, err?.status], [true, 409]);
const noPhoto = await readyCard({ photo: false });
err = await thrown(pushDraft(uid, draftFor(noPhoto)));
check("push: no stored photo → needs photo", [err instanceof EbayPublishNeedsError, err?.needs], [true, "photo"]);
const c1 = await readyCard();
err = await thrown(pushDraft(uid, draftFor(c1, { listing: { ...draftFor(c1).listing, price: 0 } })));
check("push: bad draft → 400 before any eBay call", [err?.status, log.length], [400, 0]);
err = await thrown(pushDraft(uid, draftFor(c1)));
check("push: not connected → EbayNotConnectedError", err instanceof EbayNotConnectedError, true);

await completeEbayConnect(uid, "code");
log.length = 0;

// --- push ------------------------------------------------------------------------
let r = await pushDraft(uid, draftFor(c1));
const sku = skuForCard(c1);
check("push: inventory item PUT to the card's SKU", calls("PUT", `/inventory_item/${encodeURIComponent(sku)}`).length, 1);
check("push: offer POSTed with the SKU, no offer PUT", [calls("POST", "/sell/inventory/v1/offer").length, calls("PUT", "/sell/inventory/v1/offer/").length, calls("POST", "/sell/inventory/v1/offer")[0].body.sku], [1, 0, sku]);
check("push: result", [r.offerId, r.sku, r.updated, r.degraded, r.attached], ["OF-1", sku, false, [], { fulfillment: false, payment: false, return: false, location: false }]);
let card = await getCardForUser(c1, uid);
check("push: card carries sku + offer id + pushedAt, still ready", [await skuOf(c1), card.ebayOfferId, Boolean(card.ebayPushedAt), card.status], [sku, "OF-1", true, "ready"]);

log.length = 0;
r = await pushDraft(uid, draftFor(c1, { listing: { ...draftFor(c1).listing, price: 700 } }));
check("push again: offer PUT (update in place), no new offer", [r.updated, r.offerId, calls("PUT", "/sell/inventory/v1/offer/OF-1").length, calls("POST", "/sell/inventory/v1/offer").length], [true, "OF-1", 1, 0]);

state.offers.delete("OF-1");
log.length = 0;
r = await pushDraft(uid, draftFor(c1));
check("push after eBay lost the offer: 404 on PUT → fresh offer minted", [r.updated, r.offerId, (await getCardForUser(c1, uid)).ebayOfferId], [false, "OF-2", "OF-2"]);

// opaque 500 bisect
const c2 = await readyCard();
let attempts = 0;
state.itemPutStatus = (body) => { attempts++; return body.conditionDescriptors ? 500 : 200; };
r = await pushDraft(uid, draftFor(c2, { grading: { company: "PSA", grade: "9" } }));
check("push: opaque 500 → retried without condition detail, reported as degraded", [attempts, r.degraded], [2, ["condition detail (card condition / grader / grade)"]]);
state.itemPutStatus = () => 400;
err = await thrown(pushDraft(uid, draftFor(c2)));
check("push: a non-500 item error propagates", [err instanceof EbaySellError, err?.status], [true, 400]);
state.itemPutStatus = () => 200;

// --- publish: gates ---------------------------------------------------------------
const c3 = await readyCard();
err = await thrown(publishDraft(uid, c3));
check("publish: never pushed → 409", err?.status, 409);

// --- publish: first-time seller ---------------------------------------------------
log.length = 0;
err = await thrown(publishDraft(uid, c1));
check("publish: policies created for an account with none", [state.policies.f, state.policies.p, state.policies.r].every(Boolean), true);
check("publish: no location and no ZIP → needs location", [err instanceof EbayPublishNeedsError, err?.needs], [true, "location"]);
check("publish: nothing published yet", calls("POST", "/publish").length, 0);

log.length = 0;
r = await publishDraft(uid, c1, { shipFrom: { postalCode: "20815", country: "" } });
check("publish: location created once from the ZIP, country defaults to US", [state.location, calls("POST", "/location/")[0].body.location.address], ["cardflip-default", { postalCode: "20815", country: "US" }]);
const put = calls("PUT", "/sell/inventory/v1/offer/OF-2")[0].body;
check("publish: offer PUT back whole with policies + location, minus forbidden fields", [
  put.listingPolicies, put.merchantLocationKey, "offerId" in put, "status" in put, "listing" in put, put.sku === undefined, put.pricingSummary?.price?.value,
], [{ fulfillmentPolicyId: "fulfillment-1", paymentPolicyId: "payment-1", returnPolicyId: "return-1" }, "cardflip-default", false, false, false, true, "818.00"]);
check("publish: result", [r.listingId, r.listingUrl, r.warnings], ["LI-OF-2", "https://www.ebay.com/itm/LI-OF-2", []]);
card = await getCardForUser(c1, uid);
check("publish: card listed with listing id + publishedAt", [card.status, card.ebayListingId, Boolean(card.ebayPublishedAt), Boolean(card.listedAt)], ["listed", "LI-OF-2", true, true]);

// second seller-side publish: policies + location already there, no creates
log.length = 0;
await pushDraft(uid, draftFor(c3));
state.publishWarnings = [{ longMessage: "Your listing may take a moment to appear." }];
r = await publishDraft(uid, c3);
check("publish: existing policies/location reused, warnings passed through", [calls("POST", "_policy").length, calls("POST", "/location/").length, r.warnings], [0, 0, ["Your listing may take a moment to appear."]]);
state.publishWarnings = [];

// stale offer id
const c4 = await readyCard();
await pushDraft(uid, draftFor(c4));
const staleId = (await getCardForUser(c4, uid)).ebayOfferId;
state.offers.delete(staleId);
err = await thrown(publishDraft(uid, c4));
check("publish: 25713 on the offer → offer id cleared, needs push", [err?.needs, (await getCardForUser(c4, uid)).ebayOfferId, (await getCardForUser(c4, uid)).ebayPushedAt], ["push", null, null]);

// publish failure leaves the card alone
const c5 = await readyCard();
await pushDraft(uid, draftFor(c5));
state.publishStatus = 400;
err = await thrown(publishDraft(uid, c5));
check("publish: eBay refuses → error, card stays ready", [err instanceof EbaySellError, (await getCardForUser(c5, uid)).status], [true, "ready"]);
state.publishStatus = 200;

// --- reprice ------------------------------------------------------------------------
log.length = 0;
await updateOfferPrice(uid, c1, 650.5);
const rp = calls("PUT", "/sell/inventory/v1/offer/OF-2")[0].body;
check("reprice: PUT carries the new price over the current offer, forbidden fields stripped", [rp.pricingSummary, rp.listingPolicies?.fulfillmentPolicyId, "offerId" in rp, "listing" in rp], [{ price: { currency: "USD", value: "650.50" } }, "fulfillment-1", false, false]);
err = await thrown(updateOfferPrice(uid, c5 === c1 ? c3 : (await readyCard()), 5));
check("reprice: no offer → 409", err?.status, 409);

// --- withdraw ------------------------------------------------------------------------
log.length = 0;
await withdrawOffer(uid, c1);
check("withdraw: POST withdraw on the offer", calls("POST", "/OF-2/withdraw").length, 1);
state.offers.delete("OF-2");
check("withdraw: a listing eBay already ended counts as ended", await thrown(withdrawOffer(uid, c1)), null);
err = await thrown(withdrawOffer(uid, c4));
check("withdraw: no offer → 409", err?.status, 409);

Object.assign(console, quiet);
globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
