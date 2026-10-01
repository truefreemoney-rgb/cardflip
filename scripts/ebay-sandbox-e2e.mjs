/**
 * eBay SANDBOX end-to-end check for the per-country listing path
 * (docs/EBAY_COUNTRIES_PLAN.md). Not part of `npm test`: it needs sandbox
 * credentials and the network, and it only ever talks to *.sandbox.ebay.com.
 *
 *   node --experimental-strip-types --no-warnings scripts/ebay-sandbox-e2e.mjs [--sites GB,IE,AU,CA] [--print]
 *
 * For each site it runs, in order, and prints PASS / FAIL / SKIP per step with
 * eBay's reply VERBATIM on a failure:
 *   identity      Commerce Identity getUser (INFO only: shows accountType + registration marketplace)
 *   opt-in        Business Policies opt-in (already-opted-in is a PASS)
 *   policies      create-or-find the fulfillment / payment / return policies exactly as the app does
 *                 (the fulfillment step reports WHICH attempt eBay accepted: letter code with the carrier
 *                 string, without it, or the alternate code - this is the "throwaway policy per site" check)
 *   location      create the ship-from location cardflip-<cc> in the site's country (already exists = PASS)
 *   item          PUT inventory item (site Content-Language / Accept-Language / X-EBAY-C-MARKETPLACE-ID)
 *   offer         POST offer in the site's currency at the price the app would compute
 *   publish       POST offer/{id}/publish
 *   reprice       GET + PUT the offer with a new price
 *   withdraw      POST offer/{id}/withdraw
 *   cleanup       DELETE the inventory item
 * A failed step makes the steps that depend on it SKIP. Exit code 1 when anything FAILed.
 * `--print` builds and prints every payload and sends NOTHING (needs no credentials).
 *
 * It refuses to run against production: every request URL is checked to be a
 * *.sandbox.ebay.com host before it is sent, EBAY_ENV (if set) must be "sandbox",
 * and a client id containing "-PRD-" is rejected.
 *
 * WHAT THE OWNER MUST CREATE (eBay developer portal, developer.ebay.com; the
 * portal's wording moves around, the objects are what matter):
 *  1. A SANDBOX keyset: Hammer icon / "Application access keys" -> create a keyset for the Sandbox
 *     environment. You get an App ID (client id, looks like Name-CardFlip-SBX-xxxxxxxx-xxxxxxxx) and a
 *     Cert ID (client secret).
 *  2. A sandbox RuName for that keyset (User Tokens -> "Get a Token from eBay via Your Application" ->
 *     add an eBay Redirect URL). Any URL you control works for a manual token mint.
 *  3. One sandbox TEST USER per site: developer.ebay.com -> Sandbox -> "Register a new sandbox user" (or
 *     "Create a test user"). Create four SELLER users, registering each on its own country: United Kingdom,
 *     Ireland, Australia, Canada. A sandbox user belongs to the one eBay site it registered on, which is why the
 *     harness takes one token per site. Sign each one in once on its sandbox site and finish seller
 *     registration if the sandbox asks for it (sandbox sellers often need it before an offer will publish).
 *  4. A USER TOKEN for each of those four users: portal -> your sandbox keyset -> "User Tokens" ->
 *     "Get a Token from eBay via Your Application" -> sign in as the sandbox user -> consent. Request these
 *     scopes (space-separated, full URLs; they are the same in the sandbox):
 *       https://api.ebay.com/oauth/api_scope/sell.inventory
 *       https://api.ebay.com/oauth/api_scope/sell.account
 *       https://api.ebay.com/oauth/api_scope/commerce.identity.readonly
 *     (sell.fulfillment.readonly and sell.finances are only needed to test order/fee sync, not this script.)
 *     The access token lasts about 2 hours: paste it into the env var below. Or keep the refresh token and
 *     set EBAY_SANDBOX_REFRESH_TOKEN_<CC>, and the script mints a fresh access token itself (needs the
 *     client id + secret).
 *
 * ENV (all names are exact):
 *   EBAY_SANDBOX_CLIENT_ID, EBAY_SANDBOX_CLIENT_SECRET      the sandbox keyset
 *   EBAY_SANDBOX_USER_TOKEN_GB / _IE / _AU / _CA            that site's sandbox seller token
 *   EBAY_SANDBOX_USER_TOKEN                                  fallback for any site without its own (only
 *                                                            sensible if one user can list on all four)
 *   EBAY_SANDBOX_REFRESH_TOKEN_GB / ...                      optional, instead of the access token
 *   EBAY_SANDBOX_IMAGE_URL                                   a public image the sandbox can fetch (default: a
 *                                                            pokemontcg.io card image)
 *   EBAY_SANDBOX_USD_VALUE                                   the USD market value the sample card is priced from (default 3.20)
 *   EBAY_SANDBOX_RATES                                       JSON like {"GBP":0.78,"EUR":0.88,"AUD":1.5,"CAD":1.37}
 *   EBAY_SANDBOX_ACCOUNT                                     INDIVIDUAL | BUSINESS fee model for the price (default BUSINESS)
 *
 * Listings made here are in the SANDBOX, are never visible to real buyers and cost nothing.
 */
import { SANDBOX_HOSTS } from "../src/lib/ebayHosts.ts";
import {
  buildInventoryItem,
  buildOffer,
  ebayRequestHeaders,
  fulfillmentAttempts,
  fulfillmentPolicyBody,
  locationBody,
  paymentPolicyBody,
  pickMerchantLocation,
  returnPolicyBody,
  skuForCard,
} from "../src/lib/ebayInventory.ts";
import { localAsk } from "../src/lib/localPricing.ts";
import { MARKETPLACES, formatLocalAmount, merchantLocationKeyFor } from "../src/lib/marketplaces.ts";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const PRINT_ONLY = flag("--print");
const SITES = (argValue("--sites") ?? "GB,IE,AU,CA").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const env = process.env;

// --- refuse production -----------------------------------------------------------------
if (env.EBAY_ENV && env.EBAY_ENV.trim().toLowerCase() !== "sandbox") {
  console.error(`REFUSING TO RUN: EBAY_ENV is "${env.EBAY_ENV}". This script only talks to the eBay sandbox.`);
  process.exit(2);
}
if (/-PRD-/i.test(env.EBAY_SANDBOX_CLIENT_ID ?? "")) {
  console.error("REFUSING TO RUN: EBAY_SANDBOX_CLIENT_ID looks like a PRODUCTION keyset (contains -PRD-). Use the sandbox keyset.");
  process.exit(2);
}
for (const s of SITES) {
  if (!["GB", "IE", "AU", "CA"].includes(s)) {
    console.error(`Unknown site "${s}". Use GB, IE, AU, CA.`);
    process.exit(2);
  }
}
/** Every request goes through here: a non-sandbox host is a bug, never a request. */
function assertSandbox(url) {
  const host = new URL(url).hostname;
  if (!host.endsWith(".sandbox.ebay.com")) throw new Error(`REFUSING: ${host} is not a sandbox host`);
}

// --- inputs ----------------------------------------------------------------------------------
const rates = { GBP: 0.78, EUR: 0.88, AUD: 1.5, CAD: 1.37, ...(env.EBAY_SANDBOX_RATES ? JSON.parse(env.EBAY_SANDBOX_RATES) : {}) };
const usdValue = Number(env.EBAY_SANDBOX_USD_VALUE ?? 3.2);
const account = (env.EBAY_SANDBOX_ACCOUNT ?? "BUSINESS").toUpperCase() === "INDIVIDUAL" ? "INDIVIDUAL" : "BUSINESS";
const imageUrl = env.EBAY_SANDBOX_IMAGE_URL ?? "https://images.pokemontcg.io/base1/4_hires.png";

if (!PRINT_ONLY) {
  const missing = [];
  if (!env.EBAY_SANDBOX_CLIENT_ID) missing.push("EBAY_SANDBOX_CLIENT_ID");
  if (!env.EBAY_SANDBOX_CLIENT_SECRET) missing.push("EBAY_SANDBOX_CLIENT_SECRET");
  for (const s of SITES) {
    if (!env[`EBAY_SANDBOX_USER_TOKEN_${s}`] && !env[`EBAY_SANDBOX_REFRESH_TOKEN_${s}`] && !env.EBAY_SANDBOX_USER_TOKEN) {
      missing.push(`EBAY_SANDBOX_USER_TOKEN_${s} (or EBAY_SANDBOX_REFRESH_TOKEN_${s}, or EBAY_SANDBOX_USER_TOKEN)`);
    }
  }
  if (missing.length) {
    console.error("Missing credentials, nothing was sent:\n  " + missing.join("\n  ") + "\nSee the usage notes at the top of this file, or run with --print to see the payloads.");
    process.exit(2);
  }
  if (!/SBX/i.test(env.EBAY_SANDBOX_CLIENT_ID)) {
    console.error("note: EBAY_SANDBOX_CLIENT_ID has no SBX in it; sandbox app ids normally do. Continuing (every URL is still checked to be a sandbox host).");
  }
}

// --- http --------------------------------------------------------------------------------------
async function http(method, url, { headers = {}, body } = {}) {
  assertSandbox(url);
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30000) });
  const text = await res.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: res.ok, status: res.status, text, json };
}

async function userToken(site) {
  const direct = env[`EBAY_SANDBOX_USER_TOKEN_${site}`] ?? (env[`EBAY_SANDBOX_REFRESH_TOKEN_${site}`] ? null : env.EBAY_SANDBOX_USER_TOKEN);
  if (direct) return direct;
  const basic = Buffer.from(`${env.EBAY_SANDBOX_CLIENT_ID}:${env.EBAY_SANDBOX_CLIENT_SECRET}`).toString("base64");
  const res = await http("POST", `${SANDBOX_HOSTS.api}/identity/v1/oauth2/token`, {
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env[`EBAY_SANDBOX_REFRESH_TOKEN_${site}`],
      scope: [
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
      ].join(" "),
    }),
  });
  if (!res.ok || !res.json?.access_token) throw new Error(`could not mint an access token from the refresh token: ${res.status} ${res.text}`);
  return res.json.access_token;
}

let failures = 0;
function report(site, step, state, detail = "") {
  if (state === "FAIL") failures++;
  console.log(`${state.padEnd(4)}  ${site}  ${step}${detail ? `  ${detail}` : ""}`);
}
/** A failed call: the status and eBay's body, verbatim. */
const verbatim = (r) => `\n        HTTP ${r.status}\n        ${r.text.replace(/\n/g, "\n        ") || "(empty body)"}`;

// --- one site ----------------------------------------------------------------------------------
async function runSite(site) {
  const mp = MARKETPLACES[site];
  const sku = skuForCard(`sandbox-${site.toLowerCase()}-${Date.now().toString(36)}`);
  const price = localAsk(mp, account, usdValue, rates[mp.currency]);
  const sampleCard = { name: "Charizard", englishName: null, setName: "Base Set", number: "4", rarity: "Rare Holo", imageLarge: imageUrl, imageSmall: imageUrl };
  const input = {
    cardId: sku.replace(/^cardflip-/, ""),
    listing: {
      title: `CardFlip sandbox test Charizard Base Set 4 ${site}`,
      description: "Sandbox end-to-end test listing from CardFlip. Not a real item.",
      price,
      categoryId: "183454",
      categoryName: "CCG Individual Cards",
    },
    card: sampleCard,
    hasPhoto: true,
    kind: "card",
    condition: "Near Mint",
    grading: null,
    firstEdition: false,
    productType: null,
    language: "en",
  };
  const item = buildInventoryItem(input);
  item.product.imageUrls = [imageUrl]; // the app's own photo route does not exist for a test card

  console.log(`\n=== ${site} (${mp.marketplaceId}, ${mp.currency}) - asking ${formatLocalAmount(mp, price)} from $${usdValue.toFixed(2)} at ${rates[mp.currency]} (${account}) ===`);

  if (PRINT_ONLY) {
    const show = (label, v) => console.log(`--- ${label}\n${JSON.stringify(v, null, 2)}`);
    show("headers", ebayRequestHeaders("<token>", mp, true));
    for (const a of fulfillmentAttempts(mp)) show(`fulfillment policy attempt (${a.serviceCode} / ${a.carrierCode ?? "no carrier"})`, fulfillmentPolicyBody(mp, a.serviceCode, a.carrierCode));
    show("payment policy", paymentPolicyBody(mp));
    show("return policy", returnPolicyBody(mp));
    show(`location ${merchantLocationKeyFor(mp)}`, locationBody("<postcode>", mp.locationCountry));
    show("inventory item", item);
    show("offer", buildOffer(input, { policies: { fulfillmentPolicyId: "<f>", paymentPolicyId: "<p>", returnPolicyId: "<r>" }, merchantLocationKey: merchantLocationKeyFor(mp) }, mp));
    return;
  }

  let token;
  try {
    token = await userToken(site);
  } catch (err) {
    report(site, "token", "FAIL", String(err instanceof Error ? err.message : err));
    return;
  }
  const api = (method, path, body, base = SANDBOX_HOSTS.api) =>
    http(method, `${base}${path}`, { headers: ebayRequestHeaders(token, mp, body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined });

  // identity (info only)
  {
    const r = await api("GET", "/commerce/identity/v1/user/", undefined, SANDBOX_HOSTS.apiz);
    if (r.ok) report(site, "identity", "PASS", `accountType=${r.json?.accountType ?? "?"} registrationMarketplaceId=${r.json?.registrationMarketplaceId ?? "?"}${r.json?.registrationMarketplaceId && r.json.registrationMarketplaceId !== mp.marketplaceId ? "  <-- NOT " + mp.marketplaceId + ": this token is for another site" : ""}`);
    else report(site, "identity", "SKIP", `(info only, the sandbox may not serve it)${verbatim(r)}`);
  }

  // opt-in
  {
    const r = await api("POST", "/sell/account/v1/program/opt_in", { programType: "SELLING_POLICY_MANAGEMENT" });
    const already = !r.ok && /already|20400|20403/i.test(r.text);
    if (r.ok || already) report(site, "opt-in", "PASS", r.ok ? "" : "(already opted in)");
    else report(site, "opt-in", "FAIL", verbatim(r));
  }

  // policies
  const policyIds = {};
  let policiesOk = true;
  for (const [key, kind, listKey, idKey] of [
    ["f", "fulfillment", "fulfillmentPolicies", "fulfillmentPolicyId"],
    ["p", "payment", "paymentPolicies", "paymentPolicyId"],
    ["r", "return", "returnPolicies", "returnPolicyId"],
  ]) {
    const list = await api("GET", `/sell/account/v1/${kind}_policy?marketplace_id=${mp.marketplaceId}`);
    const found = list.ok ? list.json?.[listKey]?.[0]?.[idKey] : undefined;
    if (found) { policyIds[key] = found; report(site, `policy:${kind}`, "PASS", `(existing ${found})`); continue; }
    if (!list.ok) { report(site, `policy:${kind}`, "FAIL", `lookup${verbatim(list)}`); policiesOk = false; continue; }
    if (kind === "fulfillment") {
      let created = null;
      let lastErr = null;
      for (const a of fulfillmentAttempts(mp)) {
        const r = await api("POST", "/sell/account/v1/fulfillment_policy", fulfillmentPolicyBody(mp, a.serviceCode, a.carrierCode));
        if (r.ok) { created = { r, a }; break; }
        lastErr = r;
        console.log(`      attempt ${a.serviceCode} / ${a.carrierCode ?? "no carrier"} refused: HTTP ${r.status} ${r.text.slice(0, 400)}`);
      }
      if (created) { policyIds.f = created.r.json?.fulfillmentPolicyId; report(site, "policy:fulfillment", "PASS", `accepted: ${created.a.serviceCode} / ${created.a.carrierCode ?? "no carrier"}  -> set these in src/lib/marketplaces.ts if they differ from the table`); }
      else { report(site, "policy:fulfillment", "FAIL", verbatim(lastErr)); policiesOk = false; }
      continue;
    }
    const r = await api("POST", `/sell/account/v1/${kind}_policy`, kind === "payment" ? paymentPolicyBody(mp) : returnPolicyBody(mp));
    if (r.ok) { policyIds[key] = r.json?.[idKey]; report(site, `policy:${kind}`, "PASS", "(created)"); }
    else { report(site, `policy:${kind}`, "FAIL", verbatim(r)); policiesOk = false; }
  }

  // location
  let locationKey = null;
  {
    const list = await api("GET", "/sell/inventory/v1/location?limit=100");
    locationKey = list.ok ? pickMerchantLocation(list.json?.locations ?? [], mp) : null;
    if (locationKey) report(site, "location", "PASS", `(existing ${locationKey})`);
    else {
      const key = merchantLocationKeyFor(mp);
      const r = await api("POST", `/sell/inventory/v1/location/${key}`, locationBody(env[`EBAY_SANDBOX_POSTCODE_${site}`] ?? { GB: "SW1A 1AA", IE: "D02 AF30", AU: "2000", CA: "K1A 0B1" }[site], mp.locationCountry));
      if (r.ok || /already exists|25802/i.test(r.text)) { locationKey = key; report(site, "location", "PASS", r.ok ? `(created ${key})` : `(${key} already exists)`); }
      else report(site, "location", "FAIL", verbatim(r));
    }
  }

  // item
  const itemPath = `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;
  const itemRes = await api("PUT", itemPath, item);
  if (itemRes.ok) report(site, "item", "PASS", `sku=${sku}`);
  else { report(site, "item", "FAIL", verbatim(itemRes)); report(site, "offer", "SKIP"); report(site, "publish", "SKIP"); report(site, "reprice", "SKIP"); report(site, "withdraw", "SKIP"); return; }

  // offer
  let offerId = null;
  if (!policiesOk || !locationKey) {
    report(site, "offer", "SKIP", "(needs the policies + location above)");
  } else {
    const offer = buildOffer(input, { policies: { fulfillmentPolicyId: policyIds.f, paymentPolicyId: policyIds.p, returnPolicyId: policyIds.r }, merchantLocationKey: locationKey }, mp);
    const r = await api("POST", "/sell/inventory/v1/offer", offer);
    if (r.ok && r.json?.offerId) { offerId = r.json.offerId; report(site, "offer", "PASS", `offerId=${offerId} ${offer.pricingSummary.price.value} ${offer.pricingSummary.price.currency}`); }
    else report(site, "offer", "FAIL", verbatim(r));
  }

  // publish / reprice / withdraw
  let published = false;
  if (!offerId) {
    report(site, "publish", "SKIP"); report(site, "reprice", "SKIP"); report(site, "withdraw", "SKIP");
  } else {
    const pub = await api("POST", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`);
    if (pub.ok && pub.json?.listingId) {
      published = true;
      const warn = (pub.json.warnings ?? []).map((w) => w.longMessage || w.message).filter(Boolean);
      report(site, "publish", "PASS", `listingId=${pub.json.listingId}${warn.length ? `  warnings: ${warn.join(" | ")}` : ""}`);
    } else report(site, "publish", "FAIL", verbatim(pub));

    // reprice (works on an unpublished offer too, so it is tried either way)
    const cur = await api("GET", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`);
    if (!cur.ok || !cur.json) report(site, "reprice", "FAIL", `GET offer${verbatim(cur)}`);
    else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { offerId: _o, sku: _s, marketplaceId: _m, format: _f, status: _st, listing: _l, ...rest } = cur.json;
      const newPrice = (Math.round((price + 0.1) * 100) / 100).toFixed(2);
      const put = await api("PUT", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, { ...rest, pricingSummary: { price: { currency: mp.currency, value: newPrice } } });
      if (put.ok) report(site, "reprice", "PASS", `-> ${newPrice} ${mp.currency}`);
      else report(site, "reprice", "FAIL", verbatim(put));
    }

    if (!published) report(site, "withdraw", "SKIP", "(not published)");
    else {
      const wd = await api("POST", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`);
      if (wd.ok) report(site, "withdraw", "PASS");
      else report(site, "withdraw", "FAIL", verbatim(wd));
    }
  }

  // cleanup
  const del = await api("DELETE", itemPath);
  if (del.ok || del.status === 204) report(site, "cleanup", "PASS");
  else report(site, "cleanup", "FAIL", verbatim(del));
}

for (const site of SITES) {
  try {
    await runSite(site);
  } catch (err) {
    report(site, "run", "FAIL", String(err instanceof Error ? err.stack ?? err.message : err));
  }
}

if (PRINT_ONLY) {
  console.log("\n--print: nothing was sent.");
} else if (failures) {
  console.log(`\n${failures} step(s) FAILED. The text under each FAIL is eBay's reply as received.`);
  process.exit(1);
} else {
  console.log("\nAll sandbox steps passed.");
}
