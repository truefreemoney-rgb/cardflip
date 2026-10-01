/**
 * Per-country eBay listing, increments 2 + 3 + the sandbox switch
 * (docs/EBAY_COUNTRIES_PLAN.md). Run: npm run test:ebaylocal
 *
 * Everything runs against one fetch stub (no network); the lib code is real.
 * Pins:
 *  - payloads for GB / IE / AU / CA: the site's currency, Content-Language +
 *    Accept-Language, X-EBAY-C-MARKETPLACE-ID, the policy names (site
 *    suffix), the site's letter service code, NO returnMethods, 30-day
 *    buyer-pays returns, handling 1 day, location key cardflip-<cc> in the
 *    HOME country (never the ZIP-prompt country the client sent);
 *  - price math per site (private vs business, the whole-unit taper, the
 *    local floor) and that the price comes from the USD MARKET value x the
 *    day's rate, never cards.price, and that the client's price is ignored;
 *  - a stale or missing FX rate refuses the listing before anything is sent;
 *  - an offer's STORED site drives reprice / withdraw / the listing link even
 *    after the switch is turned off;
 *  - drafts (Listing API) are refused for a local seller; nudges skip local rows;
 *  - the public page shows the local ask;
 *  - a GBP order books the local amount + the USD equivalent at the SALE DATE's
 *    rate, a line with no rate for its day is deferred and retried, a US sale
 *    is untouched, GBP fees convert the same way;
 *  - the lazy account-facts refresh fills NULLs once and never throws;
 *  - EBAY_ENV=sandbox swaps the hosts, unset keeps production.
 * The GOLDEN US tests (test:ebaygolden) stay the proof that US bytes are unchanged.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.EBAY_CLIENT_ID = "cid";
process.env.EBAY_CLIENT_SECRET = "csecret";
process.env.EBAY_RU_NAME = "ru";
process.env.EBAY_TOKEN_KEY = "test-token-key";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-local-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

// --- the world the stub answers from ------------------------------------------------
const DAY = 86_400_000;
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const world = {
  identity: { status: 200, body: { userId: "u", username: "u", accountType: "BUSINESS", registrationMarketplaceId: "EBAY_GB" } },
  fxLatest: { date: today, rates: { CAD: 1.37, GBP: 0.78, EUR: 0.88, AUD: 1.5, NZD: 1.7 } },
  fxDown: false,
  fxDays: new Map(), // yyyy-mm-dd -> rates object; absent = 404
  policies: { f: new Map(), p: new Map(), r: new Map() }, // marketplace -> id
  locations: new Map(), // marketplace -> [{ merchantLocationKey, location }]
  offers: new Map(),
  nextOfferId: 1,
  orders: [],
  finances: new Map(),
  rejectCarrier: false,
};
const log = [];
const json = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status });
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const host = url.match(/^https?:\/\/[^/]+/)?.[0] ?? "";
  const p = url.replace(/^https?:\/\/[^/]+/, "");
  let body;
  try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
  const headers = { ...(init?.headers ?? {}) };

  if (host === "https://api.frankfurter.dev") {
    log.push({ kind: "fx", url });
    if (world.fxDown) throw new TypeError("fetch failed");
    if (p.startsWith("/v1/latest")) return json({ base: "USD", ...world.fxLatest });
    const day = p.match(/^\/v1\/(\d{4}-\d{2}-\d{2})/)?.[1];
    const rates = day && world.fxDays.get(day);
    return rates ? json({ base: "USD", date: day, rates }) : json({ message: "not found" }, 404);
  }
  if (p.includes("/identity/v1/oauth2/token")) {
    return json({ access_token: "tok-1", expires_in: 7200, refresh_token: "ref-1", refresh_token_expires_in: 47304000, token_type: "User" });
  }
  if (p.includes("/commerce/identity/")) {
    log.push({ kind: "identity", host });
    return json(world.identity.body, world.identity.status);
  }
  log.push({ kind: "ebay", method, host, path: p, headers, body });
  const mk = headers["X-EBAY-C-MARKETPLACE-ID"] ?? "";

  const pol = p.match(/\/sell\/account\/v1\/(fulfillment|payment|return)_policy/);
  if (pol) {
    const k = pol[1][0];
    if (method === "POST") {
      if (k === "f" && world.rejectCarrier && body?.shippingOptions?.[0]?.shippingServices?.[0]?.shippingCarrierCode) {
        return json({ errors: [{ errorId: 20401, message: "bad carrier" }] }, 400);
      }
      world.policies[k].set(mk, `${pol[1]}-${mk}`);
      return json({ [`${pol[1]}PolicyId`]: world.policies[k].get(mk) }, 201);
    }
    const id = world.policies[k].get(new URL(url).searchParams.get("marketplace_id"));
    return json({ [`${pol[1]}Policies`]: id ? [{ [`${pol[1]}PolicyId`]: id }] : [] });
  }
  if (p.startsWith("/sell/inventory/v1/location/") && method === "POST") {
    const key = p.split("/").pop();
    const list = world.locations.get(mk) ?? [];
    list.push({ merchantLocationKey: key, merchantLocationStatus: "ENABLED", location: { address: { country: body.location.address.country } } });
    world.locations.set(mk, list);
    return json(undefined, 204);
  }
  if (p.startsWith("/sell/inventory/v1/location")) return json({ locations: world.locations.get(mk) ?? [] });
  if (p.startsWith("/sell/inventory/v1/inventory_item/") && method === "PUT") return json(undefined, 204);
  if (p === "/sell/inventory/v1/offer" && method === "POST") {
    const id = `OF-${world.nextOfferId++}`;
    world.offers.set(id, { offerId: id, sku: body.sku, format: "FIXED_PRICE", status: "UNPUBLISHED", ...body });
    return json({ offerId: id }, 201);
  }
  const of = p.match(/^\/sell\/inventory\/v1\/offer\/([^/]+)(\/publish|\/withdraw)?$/);
  if (of) {
    const id = decodeURIComponent(of[1]);
    const offer = world.offers.get(id);
    if (!offer) return json({ errors: [{ errorId: 25713 }] }, 404);
    if (of[2] === "/publish") { offer.status = "PUBLISHED"; offer.listing = { listingId: `LI-${id}`, listingStatus: "ACTIVE" }; return json({ listingId: `LI-${id}` }); }
    if (of[2] === "/withdraw") { offer.status = "UNPUBLISHED"; delete offer.listing; return json({ listingId: `LI-${id}` }); }
    if (method === "GET") return json(offer);
    if (method === "PUT") { world.offers.set(id, { ...offer, ...body, offerId: id }); return json(undefined, 204); }
  }
  if (p.startsWith("/sell/fulfillment/v1/order")) return json({ orders: world.orders });
  if (p.startsWith("/sell/finances/v1/transaction")) {
    const orderId = decodeURIComponent(new URL(url).searchParams.get("filter") ?? "").match(/orderId:\{([^}]+)\}/)?.[1];
    return json(world.finances.get(orderId) ?? { transactions: [] });
  }
  if (p.startsWith("/sell/listing/")) return json({ itemDraftId: "D1" }, 201);
  throw new Error(`unexpected fetch ${method} ${host}${p}`);
};
console.error = () => {};
console.warn = () => {};
console.info = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const inv = await import(at("lib/ebayInventory.ts"));
const { MARKETPLACES, US_MARKETPLACE, marketplaceByEbayId, merchantLocationKeyFor, currencySymbol, formatLocalAmount } = await import(at("lib/marketplaces.ts"));
const fees = await import(at("lib/fees.ts"));
const lp = await import(at("lib/localPricing.ts"));
const { ebayHosts, SANDBOX_HOSTS, PRODUCTION_HOSTS } = await import(at("lib/ebayHosts.ts"));
const { pushDraft, publishDraft, updateOfferPrice, withdrawOffer, createDraft, EbaySellError, ebayFetch } = await import(at("lib/server/ebaySell.ts"));
const { sellerMarket, ledgerFloorProblem, listedFloorProblem, marketValueUsd } = await import(at("lib/server/ebayMarket.ts"));
const { completeEbayConnect, getEbayAccountFacts } = await import(at("lib/server/ebayAuth.ts"));
const { createCard, getCardForUser, updateCard, setCardEbayListing } = await import(at("lib/server/cards.ts"));
const { storeCardPhoto } = await import(at("lib/server/cardPhotos.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { setSetting, EBAY_LOCAL_MARKETS_KEY } = await import(at("lib/server/settings.ts"));
const { listingFxRate, fxRateOnDay, FxUnavailableError } = await import(at("lib/server/fx.ts"));
const { syncEbaySales } = await import(at("lib/server/ebayOrders.ts"));
const { syncEbayFees } = await import(at("lib/server/ebayFinances.ts"));
const { getRepriceNudges } = await import(at("lib/server/repriceNudges.ts"));
const { publicCollection } = await import(at("lib/server/publicCollection.ts"));
const { encodePrices, addDays, todayUtc } = await import(at("lib/priceSeries.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}
const round2 = (n) => Math.round(n * 100) / 100;
/** The full-cover ask, written out independently of fees.ts. */
const fullCover = (mp, model, value) => Math.ceil(((value + model.flat + mp.postage) / (1 - model.rate)) * 100) / 100;

// --- 1. payloads per site (pure) -------------------------------------------------------
console.log("Payloads per site");
{
  const card = { name: "Charizard", englishName: null, setName: "Base Set", number: "4", rarity: "Rare Holo", imageLarge: "https://img/4.png", imageSmall: "https://img/4s.png" };
  const input = {
    cardId: "0f2b7c1e-1234-4abc-9def-0123456789ab",
    listing: { title: "Charizard Base Set 4", description: "Charizard.", price: 4.91, categoryId: "183454", categoryName: "CCG" },
    card, hasPhoto: true, kind: "card", condition: "Near Mint", grading: null, firstEdition: false, productType: null, language: "en",
  };
  const want = {
    GB: { cur: "GBP", lang: "en-GB", code: "UK_RoyalMail2ndClassLetter", cc: "GB", id: "EBAY_GB", cost: "1.55", loc: "cardflip-gb", name: "CardFlip shipping GB" },
    IE: { cur: "EUR", lang: "en-IE", code: "IE_FirstClassLetterService", cc: "IE", id: "EBAY_IE", cost: "3.50", loc: "cardflip-ie", name: "CardFlip shipping IE" },
    AU: { cur: "AUD", lang: "en-AU", code: "AU_AusPostStandardLetter", cc: "AU", id: "EBAY_AU", cost: "3.70", loc: "cardflip-au", name: "CardFlip shipping AU" },
    CA: { cur: "CAD", lang: "en-CA", code: "CA_PostLettermail", cc: "CA", id: "EBAY_CA", cost: "2.61", loc: "cardflip-ca", name: "CardFlip shipping CA" },
  };
  for (const [k, w] of Object.entries(want)) {
    const mp = MARKETPLACES[k];
    const offer = inv.buildOffer(input, { policies: { fulfillmentPolicyId: "f", paymentPolicyId: "p", returnPolicyId: "r" }, merchantLocationKey: w.loc }, mp);
    check(`${k}: offer marketplace + currency + local price`, [offer.marketplaceId, offer.pricingSummary.price], [w.id, { currency: w.cur, value: "4.91" }]);
    check(`${k}: headers carry the site language + marketplace id, body adds Content-Type`, [
      inv.ebayRequestHeaders("T", mp, true)["Content-Language"], inv.ebayRequestHeaders("T", mp, true)["Accept-Language"], inv.ebayRequestHeaders("T", mp, true)["X-EBAY-C-MARKETPLACE-ID"],
      Object.keys(inv.ebayRequestHeaders("T", mp, false)).includes("Content-Type"),
    ], [w.lang, w.lang, w.id, false]);
    const attempts = inv.fulfillmentAttempts(mp);
    const f = inv.fulfillmentPolicyBody(mp, attempts[0].serviceCode, attempts[0].carrierCode);
    const svc = f.shippingOptions[0].shippingServices[0];
    check(`${k}: fulfillment policy = site letter code, flat cost in local currency, handling 1 day, site suffix`, [
      f.name, f.marketplaceId, svc.shippingServiceCode, svc.shippingCost, f.handlingTime, f.shippingOptions[0].costType, svc.freeShipping,
    ], [w.name, w.id, w.code, { value: w.cost, currency: w.cur }, { value: 1, unit: "DAY" }, "FLAT_RATE", false]);
    check(
      k === "IE" ? `${k}: no carrier code on this site, one attempt` : `${k}: the letter code is tried with the carrier, then without it`,
      k === "IE" ? attempts.map((a) => a.carrierCode) : [attempts[0].carrierCode !== null, attempts[1].carrierCode, attempts[1].serviceCode],
      k === "IE" ? [null] : [true, null, w.code],
    );
    const r = inv.returnPolicyBody(mp);
    check(`${k}: returns 30 days, buyer pays, NO returnMethods`, [r.returnPeriod, r.returnShippingCostPayer, "returnMethods" in r, r.name], [{ value: 30, unit: "DAY" }, "BUYER", false, `CardFlip returns ${k}`]);
    check(`${k}: payment policy name has the site suffix`, inv.paymentPolicyBody(mp).name, `CardFlip payments ${k}`);
    check(`${k}: location key + body`, [merchantLocationKeyFor(mp), inv.locationBody("X1 1XX", w.cc).location.address.country], [w.loc, w.cc]);
    check(`${k}: listing URL is on the site's domain`, inv.ebayListingUrl("123", mp), `https://www.${mp.domain}/itm/123`);
  }
  check("fulfillment attempts: IE has no carrier code, so the first attempt is already carrier-less", inv.fulfillmentAttempts(MARKETPLACES.IE).map((a) => a.carrierCode), [null]);
  check("fulfillment attempts: GB = carrier, no carrier, alternate code", inv.fulfillmentAttempts(MARKETPLACES.GB).map((a) => `${a.serviceCode}/${a.carrierCode}`), [
    "UK_RoyalMail2ndClassLetter/RoyalMail", "UK_RoyalMail2ndClassLetter/null", "UK_RoyalMail1stClassLetter/null",
  ]);
  check("fulfillment attempts: US unchanged (Ground Advantage then Priority, both USPS)", inv.fulfillmentAttempts(US_MARKETPLACE).map((a) => `${a.serviceCode}/${a.carrierCode}`), ["USPSGroundAdvantage/USPS", "USPSPriority/USPS"]);
  check("US fulfillment body keeps shippingCarrierCode in its original slot", Object.keys(inv.fulfillmentPolicyBody(US_MARKETPLACE, "USPSGroundAdvantage", "USPS").shippingOptions[0].shippingServices[0]), ["sortOrder", "shippingCarrierCode", "shippingServiceCode", "shippingCost", "freeShipping"]);
  check("marketplaceByEbayId: null / EBAY_US / junk = US; the four sites; EBAY_AU is AU not NZ", [
    marketplaceByEbayId(null).key, marketplaceByEbayId("EBAY_US").key, marketplaceByEbayId("EBAY_XX").key, marketplaceByEbayId("EBAY_GB").key, marketplaceByEbayId("ebay_ie").key, marketplaceByEbayId("EBAY_AU").key, marketplaceByEbayId("EBAY_CA").key,
  ], ["US", "US", "US", "GB", "IE", "AU", "CA"]);
  check("currency symbols stay distinct next to US$", [currencySymbol(MARKETPLACES.GB), currencySymbol(MARKETPLACES.IE), currencySymbol(MARKETPLACES.CA), currencySymbol(MARKETPLACES.AU), formatLocalAmount(MARKETPLACES.GB, 3.99)], ["£", "€", "C$", "A$", "£3.99"]);
  const locs = [
    { merchantLocationKey: "mine-us", merchantLocationStatus: "ENABLED", location: { address: { country: "US" } } },
    { merchantLocationKey: "uk-warehouse", merchantLocationStatus: "ENABLED", location: { address: { country: "GB" } } },
    { merchantLocationKey: "cardflip-gb", merchantLocationStatus: "ENABLED", location: { address: { country: "GB" } } },
    { merchantLocationKey: "off-gb", merchantLocationStatus: "DISABLED", location: { address: { country: "GB" } } },
  ];
  check("location pick: our cardflip-<cc> key wins, then any enabled one in the country, never another country", [
    inv.pickMerchantLocation(locs, MARKETPLACES.GB), inv.pickMerchantLocation(locs.slice(0, 2), MARKETPLACES.GB), inv.pickMerchantLocation(locs.slice(0, 1), MARKETPLACES.GB), inv.pickMerchantLocation([locs[3]], MARKETPLACES.GB),
  ], ["cardflip-gb", "uk-warehouse", null, null]);
  check("a cardflip-gb key sitting in the wrong country is not used", inv.pickMerchantLocation([{ merchantLocationKey: "cardflip-gb", location: { address: { country: "US" } } }], MARKETPLACES.GB), null);
}

// --- 2. price math per site -----------------------------------------------------------------
console.log("Price math");
{
  const gb = MARKETPLACES.GB, ie = MARKETPLACES.IE, au = MARKETPLACES.AU, ca = MARKETPLACES.CA;
  const rate = { GB: 0.78, IE: 0.88, AU: 1.5, CA: 1.37 };
  const usd = 3.2;
  const v = (k) => lp.toLocal(usd, rate[k]);
  check("GB business: $3.20 -> £2.50 value, full cover (value + 0.30 + £1.55 postage) / (1 - 11.25%)", lp.localAsk(gb, "BUSINESS", usd, rate.GB), fullCover(gb, gb.fees.business, v("GB")));
  check("GB business ask is £4.91", lp.localAsk(gb, "BUSINESS", usd, rate.GB), 4.91);
  check("GB private: no fee, just postage on top", lp.localAsk(gb, "INDIVIDUAL", usd, rate.GB), round2(v("GB") + 1.55));
  check("GB unknown account = business", lp.localAsk(gb, null, usd, rate.GB), lp.localAsk(gb, "BUSINESS", usd, rate.GB));
  check("IE business and private differ (own fee models)", [lp.localAsk(ie, "BUSINESS", usd, rate.IE), lp.localAsk(ie, "INDIVIDUAL", usd, rate.IE)], [fullCover(ie, ie.fees.business, v("IE")), fullCover(ie, ie.fees.private, v("IE"))]);
  check("AU private pays no fee: value + A$3.70", lp.localAsk(au, "INDIVIDUAL", usd, rate.AU), round2(v("AU") + 3.7));
  check("AU business: Pro Tier 2 rate + A$0.30", lp.localAsk(au, "BUSINESS", usd, rate.AU), fullCover(au, au.fees.business, v("AU")));
  check("CA: 13.25% + C$0.30 + C$2.61", lp.localAsk(ca, "INDIVIDUAL", usd, rate.CA), fullCover(ca, ca.fees.business, v("CA")));
  // The hard-coded whole-unit taper: costs on top below `end`, none from `end` up.
  for (const [k, mp, r] of [["GB", gb, rate.GB], ["IE", ie, rate.IE], ["AU", au, rate.AU], ["CA", ca, rate.CA]]) {
    const justUnder = (mp.taper.end - 0.01) / r;
    const atEnd = mp.taper.end / r;
    const ask = (u) => lp.localAsk(mp, "BUSINESS", u, r);
    check(`${k}: from ${mp.taper.end} local units up the ask is the value itself (no costs on top)`, ask(atEnd), lp.toLocal(atEnd, r));
    check(`${k}: just under ${mp.taper.end} costs are still on top, and the curve never falls as the value rises`, [ask(justUnder) >= lp.toLocal(justUnder, r), (() => { let prev = 0; for (let c = 1; c <= 4000; c++) { const a = ask(c / 100); if (a < prev - 1e-9) return false; prev = a; } return true; })()], [true, true]);
  }
  check("the taper thresholds are hard-coded whole units, not derived from FX", [gb, ie, au, ca].every((mp) => Number.isInteger(mp.taper.coveredMax) && Number.isInteger(mp.taper.end)), true);
  check("floors: GB business £2.09, GB private £1.55, AU private A$3.70, IE private/business differ", [
    fees.listingFloorFor(gb, "BUSINESS"), fees.listingFloorFor(gb, "INDIVIDUAL"), fees.listingFloorFor(au, "INDIVIDUAL"), fees.listingFloorFor(ie, "INDIVIDUAL") !== fees.listingFloorFor(ie, "BUSINESS"),
  ], [2.09, 1.55, 3.7, true]);
  check("a price one cent under the GB business floor is refused, the floor itself is not", [fees.belowFloorFor(gb, 2.08, "BUSINESS"), fees.belowFloorFor(gb, 2.09, "BUSINESS")], [true, false]);
  check("floor refusal names the local currency", [fees.floorRefusalFor(gb, "BUSINESS").startsWith("The lowest price is £2.09"), fees.floorRefusalFor(au, "BUSINESS").includes("A$"), fees.floorRefusalFor(ca, "BUSINESS").includes("C$")], [true, true, true]);
  const base = { cardId: "c", listing: { title: "T", description: "D", price: 2.0, categoryId: "183454", categoryName: "x" }, card: { name: "n", englishName: null, setName: "s", number: "1", rarity: null, imageLarge: "", imageSmall: "" }, hasPhoto: true, kind: "card", condition: "Near Mint", grading: null, firstEdition: false, productType: null, language: "en" };
  check("validateDraftInput: £2.00 is under the GB business floor; the US check would have passed it", [inv.validateDraftInput(base, gb, "BUSINESS")?.startsWith("The lowest price is £2.09"), inv.validateDraftInput(base)], [true, null]);
  check("validateDraftInput: the zero-price sentence uses the local symbol", inv.validateDraftInput({ ...base, listing: { ...base.listing, price: 0 } }, gb, "BUSINESS"), "Set a price above £0 first");
  check("validateDraftInput: the US sentence is unchanged", inv.validateDraftInput({ ...base, listing: { ...base.listing, price: 0 } }), "Set a price above $0 first");
}

// --- 3. FX freshness (pure) -------------------------------------------------------------------
console.log("FX freshness");
{
  const now = Date.now();
  check("fresh fetch + fresh ECB date is usable", lp.fxStaleReason({ date: today, fetchedAt: now - 3600_000 }, now), null);
  check("last fetched 3.5 days ago is stale", lp.fxStaleReason({ date: today, fetchedAt: now - 3.5 * DAY }, now) !== null, true);
  check("fetched an hour ago but the ECB date is 8 days old is stale", lp.fxStaleReason({ date: daysAgo(8), fetchedAt: now - 3600_000 }, now) !== null, true);
  check("a long weekend (ECB date 4 days old) is fine", lp.fxStaleReason({ date: daysAgo(4), fetchedAt: now - 3600_000 }, now), null);
  check("no rate at all is stale", lp.fxStaleReason(null, now) !== null, true);
}

// --- 4. server flows --------------------------------------------------------------------------
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);
const TODAY = todayUtc();
let seq = 0;
async function addSeries(catalogId, price) {
  await db.prepare(`INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day) VALUES (?, 'pokemon', 'holofoil', 'tcgplayer', 'USD', ?, ?, ?)`)
    .run(catalogId, addDays(TODAY, -9), encodePrices(Array(10).fill(price)), TODAY);
}
/** A verified card with a photo, a USD market series, and a US-fee price (what the live refresh writes). */
async function newCard(uid, { market = 3.2, condition = "Near Mint", locked = false, price = 5 } = {}) {
  const catalogId = `test-card-${++seq}`;
  if (market != null) await addSeries(catalogId, market);
  const c = await createCard(uid, { cardName: "Charizard", setName: "Base Set", cardNumber: "4", imageUrl: "https://img/4.png", condition, price, catalogCardId: catalogId });
  await updateCard(c.id, uid, { verifiedAt: Date.now(), ...(locked ? { priceLocked: true } : {}) });
  const stored = await storeCardPhoto(c.id, uid, JPEG);
  if (!stored.ok) throw new Error(`photo store failed: ${stored.reason}`);
  return c;
}
const draftFor = (c, price = 999) => ({
  cardId: c.id,
  listing: { title: "Charizard Base Set 4 Pokemon TCG Near Mint", description: "Charizard — Base Set, card 4.", price, categoryId: "183454", categoryName: "CCG" },
  card: { name: "Charizard", englishName: null, setName: "Base Set", number: "4", rarity: "Rare Holo", imageLarge: "https://img/4.png", imageSmall: "https://img/4s.png" },
  kind: "card", condition: c.condition, grading: null, firstEdition: false, productType: null, language: "en",
});
async function seller(cc, accountType, regOverride) {
  const u = await createUser(`Seller ${cc} ${++seq}`, `s${seq}@example.com`, "hunter22", "user", { homeCountry: cc });
  world.identity = { status: 200, body: { userId: `e${seq}`, username: `u${seq}`, accountType, registrationMarketplaceId: regOverride ?? `EBAY_${cc}` } };
  await completeEbayConnect(u.id, "code");
  return u;
}
const ebayCalls = () => log.filter((e) => e.kind === "ebay");
const since = (n) => ebayCalls().slice(n);

console.log("Routing (marketplaceFor needs switch + live row + home + registration)");
{
  for (const k of ["GB", "IE", "AU", "CA"]) MARKETPLACES[k].live = true;
  const gbUser = await seller("GB", "BUSINESS");
  check("switch off -> US even with a live row", (await sellerMarket(gbUser.id)).mp.key, "US");
  await setSetting(EBAY_LOCAL_MARKETS_KEY, "1");
  const m = await sellerMarket(gbUser.id);
  check("switch on + live + home GB + registration EBAY_GB -> GB, account BUSINESS", [m.mp.key, m.account], ["GB", "BUSINESS"]);
  const mismatch = await seller("GB", "BUSINESS", "EBAY_US");
  check("registration on another site -> US", (await sellerMarket(mismatch.id)).mp.key, "US");
  const usUser = await seller("US", "BUSINESS", "EBAY_US");
  check("US home -> US", (await sellerMarket(usUser.id)).mp.key, "US");
  MARKETPLACES.GB.live = false;
  check("a row that is not live -> US", (await sellerMarket(gbUser.id)).mp.key, "US");
  MARKETPLACES.GB.live = true;
}

console.log("Lazy account facts");
{
  const u = await seller("GB", "BUSINESS");
  await db.prepare("UPDATE ebay_tokens SET account_type = NULL, registration_marketplace = NULL WHERE user_id = ?").run(u.id);
  world.identity = { status: 500, body: { errors: [] } };
  let before = log.filter((e) => e.kind === "identity").length;
  const down = await sellerMarket(u.id);
  check("identity down: sellerMarket still answers (US, no registration) and never throws", [down.mp.key, down.account], ["US", null]);
  check("it asked eBay once", log.filter((e) => e.kind === "identity").length - before, 1);
  world.identity = { status: 200, body: { userId: "x", username: "x", accountType: "INDIVIDUAL", registrationMarketplaceId: "EBAY_GB" } };
  before = log.filter((e) => e.kind === "identity").length;
  const throttled = await sellerMarket(u.id);
  check("a retry inside the hour does not ask again (throttled)", [throttled.mp.key, log.filter((e) => e.kind === "identity").length - before], ["US", 0]);
  await db.prepare("DELETE FROM price_history_meta WHERE key = ?").run(`ebay_identity_try:${u.id}`);
  const filled = await sellerMarket(u.id);
  check("after the throttle: facts filled in, the seller routes to GB as INDIVIDUAL", [filled.mp.key, filled.account, (await getEbayAccountFacts(u.id)).registrationMarketplace], ["GB", "INDIVIDUAL", "EBAY_GB"]);
  before = log.filter((e) => e.kind === "identity").length;
  await sellerMarket(u.id);
  check("once filled it never asks again", log.filter((e) => e.kind === "identity").length - before, 0);
  const bare = await seller("GB", "BUSINESS");
  await db.prepare("UPDATE ebay_tokens SET account_type = NULL, registration_marketplace = NULL WHERE user_id = ?").run(bare.id);
  before = log.filter((e) => e.kind === "identity").length;
  await ledgerFloorProblem(bare.id, 5);
  check("saving a ledger price never waits on eBay for the account facts", log.filter((e) => e.kind === "identity").length - before, 0);
}

console.log("Push + publish on each site");
const SITES = { GB: "BUSINESS", IE: "BUSINESS", AU: "INDIVIDUAL", CA: "INDIVIDUAL" };
const rates = world.fxLatest.rates;
const siteCards = {};
for (const [cc, account] of Object.entries(SITES)) {
  const mp = MARKETPLACES[cc];
  const u = await seller(cc, account);
  const c = await newCard(u.id, { market: 3.2, price: 99 });
  const mark = ebayCalls().length;
  const pushed = await pushDraft(u.id, draftFor(c, 123456));
  const model = account === "INDIVIDUAL" ? mp.fees.private : mp.fees.business;
  const value = lp.toLocal(3.2, rates[mp.currency]);
  const expected = Math.ceil(((value + model.flat + mp.postage) / (1 - model.rate)) * 100) / 100;
  const calls = since(mark);
  const put = calls.find((e) => e.method === "PUT" && e.path.includes("/inventory_item/"));
  const offer = calls.find((e) => e.method === "POST" && e.path === "/sell/inventory/v1/offer");
  check(`${cc}: inventory item PUT carries the site headers`, [put.headers["Content-Language"], put.headers["Accept-Language"], put.headers["X-EBAY-C-MARKETPLACE-ID"], put.host], [mp.contentLanguage, mp.contentLanguage, mp.marketplaceId, "https://api.ebay.com"]);
  check(`${cc}: offer is on ${mp.marketplaceId} in ${mp.currency} at the market-derived ask, not the client's 123456 and not cards.price`, [offer.body.marketplaceId, offer.body.pricingSummary.price], [mp.marketplaceId, { currency: mp.currency, value: expected.toFixed(2) }]);
  check(`${cc}: every call in the push is for this site`, calls.every((e) => e.headers["X-EBAY-C-MARKETPLACE-ID"] === mp.marketplaceId), true);
  check(`${cc}: policy lookups ask for this marketplace`, calls.filter((e) => e.path.includes("_policy?")).every((e) => e.path.endsWith(`marketplace_id=${mp.marketplaceId}`)), true);
  const row = await db.prepare("SELECT ebay_marketplace, list_currency, list_price_local, price FROM cards WHERE id = ?").get(c.id);
  check(`${cc}: card stores site, currency and the local ask; price is the USD equivalent`, [row.ebay_marketplace, row.list_currency, row.list_price_local, row.price], [mp.marketplaceId, mp.currency, expected, lp.toUsd(expected, rates[mp.currency])]);
  check(`${cc}: the push response card knows its site`, pushed.card.ebayMarketplace, mp.marketplaceId);

  const mark2 = ebayCalls().length;
  // The client sends a US ZIP country; a local site's location is always in the seller's home country.
  const pub = await publishDraft(u.id, c.id, { shipFrom: { postalCode: "AB1 2CD", country: "US" } });
  const calls2 = since(mark2);
  const polF = calls2.find((e) => e.method === "POST" && e.path === "/sell/account/v1/fulfillment_policy");
  const polR = calls2.find((e) => e.method === "POST" && e.path === "/sell/account/v1/return_policy");
  const polP = calls2.find((e) => e.method === "POST" && e.path === "/sell/account/v1/payment_policy");
  check(`${cc}: default policies created for the site with its suffix`, [polF.body.name, polP.body.name, polR.body.name, polF.body.marketplaceId], [`CardFlip shipping ${cc}`, `CardFlip payments ${cc}`, `CardFlip returns ${cc}`, mp.marketplaceId]);
  check(`${cc}: fulfillment = the site's letter code, cost in ${mp.currency}, 1 day`, [polF.body.shippingOptions[0].shippingServices[0].shippingServiceCode, polF.body.shippingOptions[0].shippingServices[0].shippingCost, polF.body.handlingTime], [mp.shipping.serviceCode, { value: mp.shipping.policyCost, currency: mp.currency }, { value: 1, unit: "DAY" }]);
  check(`${cc}: returns 30 days buyer pays, no returnMethods`, [polR.body.returnPeriod.value, polR.body.returnShippingCostPayer, "returnMethods" in polR.body], [30, "BUYER", false]);
  const loc = calls2.find((e) => e.method === "POST" && e.path.startsWith("/sell/inventory/v1/location/"));
  check(`${cc}: location ${merchantLocationKeyFor(mp)} in ${mp.locationCountry}, not the client's US`, [loc.path.split("/").pop(), loc.body.location.address.country, loc.body.location.address.postalCode], [merchantLocationKeyFor(mp), mp.locationCountry, "AB1 2CD"]);
  const putOffer = calls2.find((e) => e.method === "PUT" && e.path.startsWith("/sell/inventory/v1/offer/"));
  check(`${cc}: the offer is updated with this site's location key and its three policies`, [putOffer.body.merchantLocationKey, Object.keys(putOffer.body.listingPolicies).sort()], [merchantLocationKey(mp), ["fulfillmentPolicyId", "paymentPolicyId", "returnPolicyId"]]);
  check(`${cc}: listing URL on ${mp.domain}`, pub.listingUrl, `https://www.${mp.domain}/itm/${pub.listingId}`);
  const after = await getCardForUser(c.id, u.id);
  check(`${cc}: ledger link + status`, [after.ebayListingUrl, after.status], [pub.listingUrl, "listed"]);
  siteCards[cc] = { u, c, mp, expected };
}
function merchantLocationKey(mp) { return merchantLocationKeyFor(mp); }

console.log("Second publish reuses the site's location (filtered by key + country)");
{
  const { u, mp } = siteCards.GB;
  const c2 = await newCard(u.id, { market: 8 });
  await pushDraft(u.id, draftFor(c2));
  const mark = ebayCalls().length;
  await publishDraft(u.id, c2.id, {});
  const calls = since(mark);
  check("no new location, no new policies", [calls.some((e) => e.path.startsWith("/sell/inventory/v1/location/") && e.method === "POST"), calls.some((e) => e.method === "POST" && e.path.includes("_policy"))], [false, false]);
  check("the location lookup asks for many and filters by country (not limit=1)", calls.some((e) => e.path === "/sell/inventory/v1/location?limit=100"), true);
  const putOffer = calls.find((e) => e.method === "PUT");
  check("it attaches cardflip-gb", putOffer.body.merchantLocationKey, "cardflip-gb");
  void mp;
}

console.log("Carrier code rejected by the site: the policy retries without it");
{
  const u = await seller("AU", "BUSINESS");
  for (const k of ["f", "p", "r"]) world.policies[k].delete("EBAY_AU");
  world.rejectCarrier = true;
  const c = await newCard(u.id, { market: 20 });
  await pushDraft(u.id, draftFor(c));
  const mark = ebayCalls().length;
  await publishDraft(u.id, c.id, { shipFrom: { postalCode: "2000", country: "AU" } });
  const posts = since(mark).filter((e) => e.method === "POST" && e.path === "/sell/account/v1/fulfillment_policy");
  check("first attempt carried AustraliaPost, the retry did not, and the policy exists", [posts.length, posts[0].body.shippingOptions[0].shippingServices[0].shippingCarrierCode, posts[1].body.shippingOptions[0].shippingServices[0].shippingCarrierCode, world.policies.f.has("EBAY_AU")], [2, "AustraliaPost", undefined, true]);
  world.rejectCarrier = false;
}

console.log("Pricing basis");
{
  const u = await seller("GB", "BUSINESS");
  const typed = await newCard(u.id, { market: 3.2, locked: true, price: 10 });
  const mark = ebayCalls().length;
  await pushDraft(u.id, draftFor(typed));
  const offer = since(mark).find((e) => e.method === "POST" && e.path === "/sell/inventory/v1/offer");
  check("a price the seller typed (locked, $10.00) converts at the rate: £7.80", offer.body.pricingSummary.price, { currency: "GBP", value: "7.80" });
  const quickCard = await newCard(u.id, { market: 12 });
  const mark2 = ebayCalls().length;
  await pushDraft(u.id, { ...draftFor(quickCard), strategy: "quick" });
  const q = since(mark2).find((e) => e.method === "POST" && e.path === "/sell/inventory/v1/offer");
  const quickUsd = 9.99; // 12 * 0.88 = 10.56 -> charm ending 9.99 (lib/listing.ts)
  check("Quick Sale applies the same undercut before the local fee model", q.body.pricingSummary.price.value, lp.localAsk(MARKETPLACES.GB, "BUSINESS", quickUsd, rates.GBP).toFixed(2));
  const heavy = await newCard(u.id, { market: 20, condition: "Lightly Played" });
  check("condition multiplier applies to the market value (LP x0.85 of $20 = $17)", await marketValueUsd(await getCardForUser(heavy.id, u.id)), 17);
  const noMarket = await newCard(u.id, { market: null, price: 6 });
  const mark3 = ebayCalls().length;
  const err = await pushDraft(u.id, draftFor(noMarket)).catch((e) => e);
  check("no trusted market and nothing typed: refused with a plain message, nothing sent", [err instanceof EbaySellError, err.status, /no trusted market price/.test(err.message), since(mark3).length], [true, 409, true, 0]);
  const below = await newCard(u.id, { market: 3.2, locked: true, price: 2.0 });
  const err2 = await pushDraft(u.id, draftFor(below)).catch((e) => e);
  check("a typed $2.00 (£1.56) is under the GB business floor £2.09: refused (400), nothing sent", [err2.status, err2.message.startsWith("The lowest price is £2.09")], [400, true]);
}

console.log("Stale or missing FX refuses a local listing before anything is sent");
{
  const u = await seller("GB", "BUSINESS");
  const c = await newCard(u.id, { market: 3.2 });
  // Cached rate fetched 4 days ago, Frankfurter down.
  await setSetting("fx_rates", JSON.stringify({ date: daysAgo(4), fetchedAt: Date.now() - 4 * DAY, rates: world.fxLatest.rates }));
  world.fxDown = true;
  const mark = ebayCalls().length;
  const err = await pushDraft(u.id, draftFor(c)).catch((e) => e);
  check("refused as a seller-readable 409", [err instanceof EbaySellError, err.status, /can't price an eBay UK listing right now/.test(err.message)], [true, 409, true]);
  check("no eBay call at all", since(mark).length, 0);
  check("listingFxRate throws FxUnavailableError", await listingFxRate("GBP", "eBay UK").catch((e) => e instanceof FxUnavailableError), true);
  check("the card is untouched", (await getCardForUser(c.id, u.id)).ebayOfferId, null);
  // Fresh fetch but an ECB date 8 days old.
  world.fxDown = false;
  world.fxLatest = { date: daysAgo(8), rates: world.fxLatest.rates };
  await setSetting("fx_rates", JSON.stringify({ date: daysAgo(8), fetchedAt: Date.now() - 13 * 3600_000, rates: world.fxLatest.rates }));
  check("an old ECB date is refused too", await pushDraft(u.id, draftFor(c)).catch((e) => e.status), 409);
  // Back to a fresh rate.
  world.fxLatest = { date: today, rates: world.fxLatest.rates };
  await setSetting("fx_rates", JSON.stringify({ date: today, fetchedAt: Date.now() - 13 * 3600_000, rates: world.fxLatest.rates }));
  const ok = await pushDraft(u.id, draftFor(c)).catch((e) => e);
  check("with a fresh rate the same card pushes", ok.offerId !== undefined, true);
}

console.log("Floors on the ledger routes' helper (per site)");
{
  const u = await seller("GB", "BUSINESS");
  const refused = await ledgerFloorProblem(u.id, 2.0);
  check("GB business: $2.00 = £1.56 is under £2.09", refused?.startsWith("The lowest price is £2.09"), true);
  check("GB business: $3.00 = £2.34 passes", await ledgerFloorProblem(u.id, 3.0), null);
  check("$0 means unpriced and passes", await ledgerFloorProblem(u.id, 0), null);
  const us = await seller("US", "BUSINESS", "EBAY_US");
  check("a US seller keeps the original sentence and floor ($1.22)", [await ledgerFloorProblem(us.id, 1.0), await ledgerFloorProblem(us.id, 1.3)], [fees.floorRefusal(), null]);
  check("a card whose offer is on GB is held to the GB floor even for a US-routed seller", (await listedFloorProblem(us.id, { ebayMarketplace: "EBAY_GB" }, 2.0)) !== null, true);
  check("a legacy US offer keeps the US floor", await listedFloorProblem(u.id, { ebayMarketplace: null }, 1.3), null);
  world.fxDown = true;
  await setSetting("fx_rates", JSON.stringify({ date: daysAgo(30), fetchedAt: Date.now() - 30 * DAY, rates: { ...world.fxLatest.rates } }));
  check("an old rate still serves the ledger floor check (a floor is approximate; the listing itself refuses stale rates)", (await ledgerFloorProblem(u.id, 2.0))?.startsWith("The lowest price is £2.09"), true);
  await db.prepare("DELETE FROM settings WHERE key = 'fx_rates'").run();
  check("no rate at all: saving a ledger price falls back to the US check and is never blocked by the rate", [await ledgerFloorProblem(u.id, 2.0), await ledgerFloorProblem(u.id, 1.0)], [null, fees.floorRefusal()]);
  world.fxDown = false;
  await setSetting("fx_rates", JSON.stringify({ date: today, fetchedAt: Date.now(), rates: world.fxLatest.rates }));
}

console.log("The stored site drives reprice / withdraw / link, even after the switch is off");
{
  const { u, c, mp } = siteCards.GB;
  await setSetting(EBAY_LOCAL_MARKETS_KEY, "0");
  const live = await getCardForUser(c.id, u.id);
  check("the listing link stays on ebay.co.uk with the switch off", live.ebayListingUrl.startsWith("https://www.ebay.co.uk/itm/"), true);
  const mark = ebayCalls().length;
  await updateOfferPrice(u.id, c.id, 5.55, { priceUsd: 7.12 });
  const calls = since(mark);
  const put = calls.find((e) => e.method === "PUT");
  check("reprice: GET + PUT carry EBAY_GB / en-GB and the body is GBP", [calls.every((e) => e.headers["X-EBAY-C-MARKETPLACE-ID"] === "EBAY_GB" && e.headers["Content-Language"] === "en-GB"), put.body.pricingSummary.price], [true, { currency: "GBP", value: "5.55" }]);
  const after = await getCardForUser(c.id, u.id);
  check("reprice: list_price_local is the authority and price the USD equivalent", [after.listPriceLocal, after.price, after.listCurrency, after.ebayMarketplace], [5.55, 7.12, "GBP", "EBAY_GB"]);
  const mark2 = ebayCalls().length;
  await withdrawOffer(u.id, c.id);
  const wd = since(mark2)[0];
  check("withdraw uses EBAY_GB", [wd.path.endsWith("/withdraw"), wd.headers["X-EBAY-C-MARKETPLACE-ID"]], [true, "EBAY_GB"]);
  const created = world.offers.get(live.ebayOfferId);
  check("the offer on eBay's side is still GBP", created.pricingSummary.price.currency, "GBP");
  // A US-registered seller's existing US card still prices in USD.
  const usU = await seller("US", "BUSINESS", "EBAY_US");
  const usCard = await newCard(usU.id, { market: 20, price: 20 });
  await pushDraft(usU.id, draftFor(usCard, 20));
  const mark3 = ebayCalls().length;
  await updateOfferPrice(usU.id, usCard.id, 18);
  const usPut = since(mark3).find((e) => e.method === "PUT");
  check("a US card: EBAY_US + USD, no local columns written", [usPut.headers["X-EBAY-C-MARKETPLACE-ID"], usPut.body.pricingSummary.price.currency, (await getCardForUser(usCard.id, usU.id)).ebayMarketplace], ["EBAY_US", "USD", null]);
  await setSetting(EBAY_LOCAL_MARKETS_KEY, "1");
  void mp;
}

console.log("Drafts (Listing API) are refused for a local seller");
{
  const u = await seller("GB", "BUSINESS");
  const c = await newCard(u.id, { market: 5 });
  const mark = ebayCalls().length;
  const err = await createDraft(u.id, draftFor(c)).catch((e) => e);
  check("refused cleanly (400, names the site), nothing sent", [err instanceof EbaySellError, err.status, /eBay UK/.test(err.message), since(mark).length], [true, 400, true, 0]);
}

console.log("Nudges skip local rows; the public page shows the local ask");
{
  const u = await seller("GB", "BUSINESS");
  await db.prepare("UPDATE users SET handle = ?, handle_public = 1 WHERE id = ?").run("gbseller", u.id);
  const mk = async (marketplace) => {
    const c = await newCard(u.id, { market: 30, price: 80 });
    await db.prepare("UPDATE cards SET status = 'listed', listed_at = ?, ebay_listing_id = ?, ebay_marketplace = ?, list_currency = ?, list_price_local = ? WHERE id = ?")
      .run(Date.now() - 20 * DAY, `L-${c.id.slice(0, 6)}`, marketplace, marketplace ? "GBP" : null, marketplace ? 62.4 : null, c.id);
    return c;
  };
  const local = await mk("EBAY_GB");
  const legacy = await mk(null);
  const nudged = (await getRepriceNudges(u.id)).map((n) => n.cardId);
  check("the US-listed row is nudged, the GB row is not", [nudged.includes(legacy.id), nudged.includes(local.id)], [true, false]);
  const page = await publicCollection("gbseller");
  const byId = Object.fromEntries(page.cards.map((p) => [p.id, p]));
  check("public page: GB row shows £62.40 and the eBay UK link; the US row has no local price", [byId[local.id].localPrice, byId[local.id].ebayUrl.startsWith("https://www.ebay.co.uk/itm/"), byId[legacy.id].localPrice, byId[legacy.id].ebayUrl.startsWith("https://www.ebay.com/itm/")], ["£62.40", true, null, true]);
}

// --- 5. sales + fees in the sale currency -------------------------------------------------------
console.log("Sales: GBP order books local + USD at the SALE DATE's rate");
{
  const u = await seller("GB", "BUSINESS");
  const sale1 = await newCard(u.id, { market: 5 });
  const sale2 = await newCard(u.id, { market: 5 });
  const usSale = await newCard(u.id, { market: 5 });
  const day1 = daysAgo(20), day2 = daysAgo(15);
  for (const [c, lid] of [[sale1, "L-SALE1"], [sale2, "L-SALE2"], [usSale, "L-SALE3"]]) {
    await setCardEbayListing(c.id, u.id, { sku: `cardflip-${c.id}`, offerId: `O-${c.id}`, listingId: lid, publishedAt: Date.now() });
    await updateCard(c.id, u.id, { status: "listed", listedAt: Date.now() - 25 * DAY });
  }
  world.fxDays.set(day1, { GBP: 0.8, CAD: 1.3, EUR: 0.9, AUD: 1.5, NZD: 1.7 });
  // day2: no rate yet (Frankfurter 404)
  world.orders = [
    { orderId: "ORD-1", creationDate: `${day1}T12:00:00.000Z`, lineItems: [{ lineItemId: "LI-1", legacyItemId: "L-SALE1", quantity: 1, lineItemCost: { value: "4.00", currency: "GBP" } }] },
    { orderId: "ORD-2", creationDate: `${day2}T12:00:00.000Z`, lineItems: [{ lineItemId: "LI-2", legacyItemId: "L-SALE2", quantity: 1, lineItemCost: { value: "5.00", currency: "GBP" } }] },
    { orderId: "ORD-3", creationDate: `${day1}T12:00:00.000Z`, lineItems: [{ lineItemId: "LI-3", legacyItemId: "L-SALE3", quantity: 1, lineItemCost: { value: "7.25", currency: "USD" } }] },
  ];
  const r = await syncEbaySales(u.id, true);
  const s1 = await getCardForUser(sale1.id, u.id);
  check("GBP £4.00 on a day the rate was 0.80: sold_price $5.00, sold_price_local 4.00 GBP", [r.sold.length, s1.status, s1.soldPrice, s1.soldPriceLocal, s1.soldCurrency], [2, "sold", 5, 4, "GBP"]);
  const s3 = await getCardForUser(usSale.id, u.id);
  check("a USD sale is untouched: price as paid, no local columns", [s3.status, s3.soldPrice, s3.soldPriceLocal, s3.soldCurrency], ["sold", 7.25, null, null]);
  const s2 = await getCardForUser(sale2.id, u.id);
  check("the line with no rate for its day is deferred: still listed, not marked applied", [r.deferred, s2.status, (await db.prepare("SELECT COUNT(*) AS n FROM ebay_sold_lines WHERE order_id = 'ORD-2'").get()).n], [1, "listed", 0]);
  check("it is never converted with today's rate or any guess", [s2.soldPrice, s2.soldPriceLocal], [null, null]);
  world.fxDays.set(day2, { GBP: 0.5, CAD: 1.3, EUR: 0.9, AUD: 1.5, NZD: 1.7 });
  const r2 = await syncEbaySales(u.id, true);
  const s2b = await getCardForUser(sale2.id, u.id);
  check("next pass, the rate exists: £5.00 at 0.50 = $10.00", [r2.sold.length, s2b.soldPrice, s2b.soldPriceLocal, s2b.soldCurrency, r2.deferred], [1, 10, 5, "GBP", undefined]);
  const fxBefore = log.filter((e) => e.kind === "fx" && e.url.includes(day1)).length;
  await fxRateOnDay("GBP", day1);
  check("a settled day's rate is cached in settings (no second fetch)", log.filter((e) => e.kind === "fx" && e.url.includes(day1)).length - fxBefore, 0);
  await updateCard(sale1.id, u.id, { soldPrice: 6 });
  const cleared = await getCardForUser(sale1.id, u.id);
  check("hand-correcting a sold price clears the foreign-currency record", [cleared.soldPrice, cleared.soldPriceLocal, cleared.soldCurrency], [6, null, null]);

  console.log("Fees: a GBP fee converts at the sale date's rate");
  // sale2 sold on day2 (rate 0.50): £0.64 fee -> $1.28; order has one line so the total applies
  world.finances.set("ORD-2", { transactions: [{ transactionType: "SALE", orderId: "ORD-2", totalFeeAmount: { value: "0.64", currency: "GBP" }, orderLineItems: [{ lineItemId: "LI-2", marketplaceFees: [{ amount: { value: "0.64", currency: "GBP" } }] }] }] });
  world.finances.set("ORD-3", { transactions: [{ transactionType: "SALE", orderId: "ORD-3", totalFeeAmount: { value: "1.10", currency: "USD" }, orderLineItems: [{ lineItemId: "LI-3", marketplaceFees: [{ amount: { value: "1.10", currency: "USD" } }] }] }] });
  const f = await syncEbayFees(u.id, true);
  check("GBP fee £0.64 at 0.50 = $1.28; the USD fee is as reported", [(await getCardForUser(sale2.id, u.id)).soldFees, (await getCardForUser(usSale.id, u.id)).soldFees, f.updated.length], [1.28, 1.1, 2]);
  const cardNoRate = await newCard(u.id, { market: 5 });
  const odd = daysAgo(40);
  await setCardEbayListing(cardNoRate.id, u.id, { sku: `cardflip-${cardNoRate.id}`, offerId: `O-${cardNoRate.id}`, listingId: "L-ODD", publishedAt: Date.now() });
  await db.prepare("UPDATE cards SET status = 'sold', sold_price = 5, sold_at = ?, ebay_order_id = 'ORD-ODD', ebay_line_item_id = 'LI-ODD' WHERE id = ?").run(Date.parse(`${odd}T12:00:00Z`), cardNoRate.id);
  world.finances.set("ORD-ODD", { transactions: [{ transactionType: "SALE", orderId: "ORD-ODD", totalFeeAmount: { value: "0.64", currency: "GBP" }, orderLineItems: [{ lineItemId: "LI-ODD", marketplaceFees: [{ amount: { value: "0.64", currency: "GBP" } }] }] }] });
  await syncEbayFees(u.id, true);
  check("a fee whose sale-day rate can't be had stays NULL for the next pass (never guessed)", (await getCardForUser(cardNoRate.id, u.id)).soldFees, null);
  check("fxRateOnDay returns null (not a guess) with no rate, 1 for USD", [await fxRateOnDay("GBP", odd), await fxRateOnDay("USD", odd), await fxRateOnDay("GBP", "garbage")], [null, 1, null]);
}

// --- 6. sandbox switch -----------------------------------------------------------------------------
console.log("EBAY_ENV=sandbox");
{
  check("unset / production / junk -> the production literals", [ebayHosts(undefined), ebayHosts(""), ebayHosts("production"), ebayHosts("prod")].every((h) => h === PRODUCTION_HOSTS), true);
  check("production hosts are the literals the code always used", [PRODUCTION_HOSTS.api, PRODUCTION_HOSTS.apiz, PRODUCTION_HOSTS.auth], ["https://api.ebay.com", "https://apiz.ebay.com", "https://auth.ebay.com"]);
  check("sandbox (any case, padded) -> the sandbox hosts", [ebayHosts("sandbox"), ebayHosts(" SANDBOX ")].every((h) => h === SANDBOX_HOSTS), true);
  check("sandbox hosts", [SANDBOX_HOSTS.api, SANDBOX_HOSTS.apiz, SANDBOX_HOSTS.auth], ["https://api.sandbox.ebay.com", "https://apiz.sandbox.ebay.com", "https://auth.sandbox.ebay.com"]);
  const mark = ebayCalls().length;
  process.env.EBAY_ENV = "sandbox";
  await ebayFetch("T", "GET", "/sell/account/v1/payment_policy?marketplace_id=EBAY_GB", undefined, undefined, MARKETPLACES.GB);
  delete process.env.EBAY_ENV;
  await ebayFetch("T", "GET", "/sell/account/v1/payment_policy?marketplace_id=EBAY_GB", undefined, undefined, MARKETPLACES.GB);
  const [sb, prod] = since(mark);
  check("ebayFetch follows EBAY_ENV at call time", [sb.host, prod.host], ["https://api.sandbox.ebay.com", "https://api.ebay.com"]);
}

console.log("Sandbox harness (scripts/ebay-sandbox-e2e.mjs) — never run for real here");
{
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const script = fileURLToPath(new URL("./ebay-sandbox-e2e.mjs", import.meta.url));
  const run = (extraArgs, extraEnv = {}) => {
    const env = { ...process.env, ...extraEnv };
    for (const k of Object.keys(env)) if (k.startsWith("EBAY_SANDBOX_") && !(k in extraEnv)) delete env[k];
    if (!("EBAY_ENV" in extraEnv)) delete env.EBAY_ENV;
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, ...extraArgs], { env, encoding: "utf8", timeout: 60000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const noCreds = run([]);
  check("no credentials: exits 2 and lists what is missing, sends nothing", [noCreds.code, /Missing credentials, nothing was sent/.test(noCreds.out), /EBAY_SANDBOX_USER_TOKEN_GB/.test(noCreds.out)], [2, true, true]);
  const prod = run([], { EBAY_ENV: "production" });
  check("EBAY_ENV=production: refuses to run", [prod.code, /REFUSING TO RUN/.test(prod.out)], [2, true]);
  const prdKey = run([], { EBAY_SANDBOX_CLIENT_ID: "Name-App-PRD-123", EBAY_SANDBOX_CLIENT_SECRET: "s", EBAY_SANDBOX_USER_TOKEN: "t" });
  check("a production-looking client id: refuses to run", [prdKey.code, /PRODUCTION keyset/.test(prdKey.out)], [2, true]);
  const printed = run(["--print", "--sites", "GB,IE,AU,CA"]);
  check("--print builds all four sites' payloads, needs no credentials and sends nothing", [printed.code, /nothing was sent/.test(printed.out), ["EBAY_GB", "EBAY_IE", "EBAY_AU", "EBAY_CA"].every((id) => printed.out.includes(id))], [0, true, true]);
  check("--print shows the site's own policy name and no returnMethods", [/CardFlip shipping IE/.test(printed.out), /returnMethods/.test(printed.out)], [true, false]);
}

void realFetch;
if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll local-marketplace checks passed");
