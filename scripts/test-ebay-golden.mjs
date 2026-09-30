/**
 * GOLDEN US eBay payloads: byte-pins everything a US seller sends to eBay, so
 * the per-country work (docs/EBAY_COUNTRIES_PLAN.md) can refactor the
 * marketplace literals without changing one byte for US sellers.
 * Run: npm run test:ebaygolden
 *
 * What is pinned (scripts/fixtures/ebay-golden/*.json, compared as exact text,
 * key order included):
 *  - builders.json: buildInventoryItem / buildItemDraft / buildOffer /
 *    offerUpdateBody / ebayListingUrl over a spread of drafts (raw, lightly
 *    played 1st edition, PSA slab, CGC slab, sealed, MTG foil, with and
 *    without policies + location, a 2-copy listing).
 *  - requests.json: EVERY request the sell path makes over a fetch stub for a
 *    first-time US seller — method, path, the complete header set (so the
 *    en-US / EBAY_US headers are pinned), and the JSON body — across
 *    pushDraft → publishDraft (policies created, location created) →
 *    updateOfferPrice → withdrawOffer, plus a call on the apiz base
 *    (Finances) and a GET without a body.
 *
 * Regenerate only on a deliberate, reviewed change to a US payload:
 *   GOLDEN_UPDATE=1 npm run test:ebaygolden
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.EBAY_CLIENT_ID = "cid";
process.env.EBAY_CLIENT_SECRET = "csecret";
process.env.EBAY_RU_NAME = "ru";
process.env.EBAY_TOKEN_KEY = "test-token-key";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "ebay-golden");
const UPDATE = process.env.GOLDEN_UPDATE === "1";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-golden-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

// --- fetch stub: records every call with its full headers -----------------------
const state = { policies: { f: null, p: null, r: null }, location: null, offers: new Map(), nextOfferId: 1 };
const log = [];
const json = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status });
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const p = url.replace(/^https?:\/\/[^/]+/, "");
  const host = url.match(/^https?:\/\/[^/]+/)?.[0] ?? "";
  let body;
  try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
  const isOauth = p.includes("/identity/v1/oauth2/token") || p.includes("/commerce/identity/");
  if (!isOauth) log.push({ method, host, path: p, headers: { ...(init?.headers ?? {}) }, body });
  if (p.includes("/identity/v1/oauth2/token")) {
    return json({ access_token: "tok-1", expires_in: 7200, refresh_token: "ref-1", refresh_token_expires_in: 47304000, token_type: "User" });
  }
  if (p.includes("/commerce/identity/")) return json({ userId: "ebay-u1", username: "seller1" });

  const pol = p.match(/\/sell\/account\/v1\/(fulfillment|payment|return)_policy/);
  if (pol) {
    const k = pol[1][0];
    if (method === "POST") { state.policies[k] = `${pol[1]}-1`; return json({ [`${pol[1]}PolicyId`]: state.policies[k] }, 201); }
    const list = state.policies[k] ? [{ [`${pol[1]}PolicyId`]: state.policies[k] }] : [];
    return json({ [`${pol[1]}Policies`]: list });
  }
  if (p.startsWith("/sell/inventory/v1/location/") && method === "POST") { state.location = p.split("/").pop(); return json(undefined, 204); }
  if (p.startsWith("/sell/inventory/v1/location")) return json({ locations: state.location ? [{ merchantLocationKey: state.location }] : [] });
  if (p.startsWith("/sell/inventory/v1/inventory_item/") && method === "PUT") return json(undefined, 204);
  if (p === "/sell/inventory/v1/offer" && method === "POST") {
    const id = `OF-${state.nextOfferId++}`;
    state.offers.set(id, { offerId: id, sku: body.sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE", status: "UNPUBLISHED", ...body });
    return json({ offerId: id }, 201);
  }
  const of = p.match(/^\/sell\/inventory\/v1\/offer\/([^/]+)(\/publish|\/withdraw)?$/);
  if (of) {
    const id = decodeURIComponent(of[1]);
    const offer = state.offers.get(id);
    if (!offer) return json({ errors: [{ errorId: 25713 }] }, 404);
    if (of[2] === "/publish") { offer.status = "PUBLISHED"; offer.listing = { listingId: `LI-${id}`, listingStatus: "ACTIVE" }; return json({ listingId: `LI-${id}` }); }
    if (of[2] === "/withdraw") { offer.status = "UNPUBLISHED"; delete offer.listing; return json({ listingId: `LI-${id}` }); }
    if (method === "GET") return json(offer);
    if (method === "PUT") { state.offers.set(id, { ...offer, ...body, offerId: id }); return json(undefined, 204); }
  }
  if (p.startsWith("/sell/finances/")) return json({ transactions: [] });
  throw new Error(`unexpected fetch ${method} ${p}`);
};
console.error = () => {};
console.warn = () => {};
console.info = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const inv = await import(at("lib/ebayInventory.ts"));
const { pushDraft, publishDraft, updateOfferPrice, withdrawOffer, ebayFetch } = await import(at("lib/server/ebaySell.ts"));
const { completeEbayConnect } = await import(at("lib/server/ebayAuth.ts"));
const { createCard, updateCard } = await import(at("lib/server/cards.ts"));
const { storeCardPhoto } = await import(at("lib/server/cardPhotos.ts"));
const { createUser } = await import(at("lib/server/users.ts"));

let failures = 0;
function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, detail) { failures++; console.log(`  FAIL  ${label}\n         ${detail}`); }

/** Compare `value` with its committed fixture as exact text (LF-normalised). */
function pin(name, value) {
  const text = JSON.stringify(value, null, 2) + "\n";
  const file = path.join(fixtureDir, name);
  if (UPDATE) {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(file, text);
    pass(`${name} written (GOLDEN_UPDATE=1)`);
    return;
  }
  if (!existsSync(file)) return fail(name, "fixture missing — run with GOLDEN_UPDATE=1 once, review, commit");
  const want = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (want === text) return pass(`${name} byte-identical`);
  // Show the first differing line so a drift is easy to read.
  const a = want.split("\n"), b = text.split("\n");
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  fail(name, `first difference at line ${i + 1}: fixture ${JSON.stringify(a[i])} vs now ${JSON.stringify(b[i])}`);
}

// --- 1. builders ------------------------------------------------------------------
const card = { name: "Charizard", englishName: null, setName: "Base Set", number: "4", rarity: "Rare Holo", imageLarge: "https://img/4.png", imageSmall: "https://img/4s.png" };
const base = {
  cardId: "0f2b7c1e-1234-4abc-9def-0123456789ab",
  listing: {
    title: "Charizard Base Set 4 Pokemon TCG Near Mint",
    description: "Charizard — Base Set, card 4.\n\nCondition: Near Mint.\n\nShips fast & safe <3",
    price: 818,
    categoryId: "183454",
    categoryName: "Collectible Card Games > Pokémon TCG > Individual Cards",
  },
  card,
  hasPhoto: true,
  kind: "card",
  condition: "Near Mint",
  grading: null,
  firstEdition: false,
  productType: null,
  language: "en",
};
const inputs = {
  rawNearMint: base,
  lightlyPlayedFirstEdition: { ...base, condition: "Lightly Played", firstEdition: true, listing: { ...base.listing, price: 12.5 } },
  psaSlab: { ...base, grading: { company: "PSA", grade: "9" }, listing: { ...base.listing, price: 1999.99 } },
  cgcSlabPristine: { ...base, grading: { company: "CGC", grade: "10 Pristine" } },
  sealedBox: {
    ...base,
    kind: "sealed",
    productType: "Booster Box",
    listing: { ...base.listing, categoryId: "261044", title: "Base Set Booster Box", price: 450 },
    card: { ...card, name: "Base Set Booster Box", number: "" },
  },
  mtgFoil: {
    ...base,
    game: "mtg",
    finish: "foil",
    card: { ...card, name: "Lightning Bolt", setName: "Alpha", number: "161", rarity: "Common", typeLine: "Instant" },
    listing: { ...base.listing, price: 3.49 },
  },
  twoCopies: { ...base, quantity: 2, listing: { ...base.listing, price: 1.5 } },
  noPhoto: { ...base, hasPhoto: false },
};
const policies = { fulfillmentPolicyId: "f-1", paymentPolicyId: "p-1", returnPolicyId: "r-1" };
const builders = {};
for (const [name, input] of Object.entries(inputs)) {
  builders[name] = {
    inventoryItem: inv.buildInventoryItem(input),
    itemDraft: inv.buildItemDraft(input),
    offerBare: inv.buildOffer(input),
    offerWithExtras: inv.buildOffer(input, { policies, merchantLocationKey: "cardflip-default" }),
    offerPartialPolicies: inv.buildOffer(input, { policies: { fulfillmentPolicyId: "f-1", paymentPolicyId: undefined, returnPolicyId: "" }, merchantLocationKey: null }),
    offerUpdateBody: inv.offerUpdateBody(inv.buildOffer(input, { policies, merchantLocationKey: "cardflip-default" })),
    listingUrl: inv.ebayListingUrl("123456789012"),
    validation: inv.validateDraftInput(input),
  };
}
builders.constants = { marketplaceId: inv.EBAY_MARKETPLACE_ID, sku: inv.skuForCard(base.cardId), listingUrlSpecialChars: inv.ebayListingUrl("a b/c") };
pin("builders.json", builders);

// --- 2. every request on the sell path ---------------------------------------------
const user = await createUser("Golden", "golden@example.com", "hunter22", "user");
const uid = user.id;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);
const c = await createCard(uid, { cardName: "Charizard", setName: "Base Set", cardNumber: "4", imageUrl: "https://img/4.png", condition: "Near Mint", price: 818 });
await updateCard(c.id, uid, { verifiedAt: Date.now() });
const stored = await storeCardPhoto(c.id, uid, JPEG);
if (!stored.ok) throw new Error(`photo store failed: ${stored.reason}`);
await completeEbayConnect(uid, "code");
log.length = 0;

const draft = {
  cardId: c.id,
  listing: { ...base.listing, title: "Charizard Base Set 4 Pokemon TCG Near Mint", price: 818 },
  card,
  kind: "card",
  condition: "Near Mint",
  grading: null,
  firstEdition: false,
  productType: null,
  language: "en",
};
await pushDraft(uid, draft);
await publishDraft(uid, c.id, { shipFrom: { postalCode: "20815", country: "" } }).catch((e) => {
  // The first publish may stop on "needs location" before the ZIP is used; the
  // stub answers the rest, so a throw here is a real failure.
  throw e;
});
await updateOfferPrice(uid, c.id, 700);
await withdrawOffer(uid, c.id);
// Direct ebayFetch calls: a GET with no body, a POST, and the Finances base.
const token = "tok-direct";
await ebayFetch(token, "GET", "/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US");
await ebayFetch(token, "POST", "/sell/account/v1/payment_policy", { hello: "world" });
await ebayFetch(token, "GET", "/sell/finances/v1/transaction?limit=1", undefined, "https://apiz.ebay.com");

// The card id is random per run: swap it for a fixed token everywhere.
const scrub = (v) => JSON.parse(JSON.stringify(v).split(c.id).join("CARDID"));
pin("requests.json", scrub(log));

if (failures) {
  console.log(`\n${failures} golden check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll golden US eBay payloads unchanged");
