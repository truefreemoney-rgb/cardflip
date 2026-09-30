/**
 * Per-country eBay plumbing, increment 1 (docs/EBAY_COUNTRIES_PLAN.md).
 * Run: npm run test:ebayplumbing
 *
 * Pins: the new nullable columns exist and default to NULL (cards.ebay_marketplace
 * / list_currency / list_price_local, ebay_tokens.account_type /
 * registration_marketplace); eBay connect stores the account type and the
 * registration marketplace from Commerce Identity getUser, stores NULL for
 * anything unrecognised, and a failed identity call NEVER breaks the connect;
 * the ebay_local_markets switch defaults off and only the exact "1" is on; the
 * admin Needs You feed lists sellers from CA/GB/IE/AU who connected eBay (not
 * US, not NZ, not stale connects) with the wording Chris asked for.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.EBAY_CLIENT_ID = "cid";
process.env.EBAY_CLIENT_SECRET = "csecret";
process.env.EBAY_RU_NAME = "ru";
process.env.EBAY_TOKEN_KEY = "test-token-key";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-plumbing-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

let identity = { status: 200, body: { userId: "u1", username: "seller1" } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/identity/v1/oauth2/token")) {
    return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 7200, refresh_token: "ref-1", refresh_token_expires_in: 47304000, token_type: "User" }), { status: 200 });
  }
  if (url === "https://apiz.ebay.com/commerce/identity/v1/user/") {
    return new Response(JSON.stringify(identity.body), { status: identity.status });
  }
  return realFetch(input, init);
};
console.error = () => {};
console.warn = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { completeEbayConnect } = await import(at("lib/server/ebayAuth.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { createCard } = await import(at("lib/server/cards.ts"));
const { setSetting, ebayLocalMarketsOn, EBAY_LOCAL_MARKETS_KEY } = await import(at("lib/server/settings.ts"));
const { getOverviewPulse, localTesterText } = await import(at("lib/server/overview.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}
const tokenRow = (uid) => db.prepare("SELECT account_type, registration_marketplace, ebay_user_id, ebay_username FROM ebay_tokens WHERE user_id = ?").get(uid);

console.log("Schema");
{
  const cols = async (t) => (await db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all()).map((r) => r.name);
  const cardCols = await cols("cards");
  const tokCols = await cols("ebay_tokens");
  check("cards has ebay_marketplace / list_currency / list_price_local", ["ebay_marketplace", "list_currency", "list_price_local"].every((c) => cardCols.includes(c)), true);
  check("ebay_tokens has account_type / registration_marketplace", ["account_type", "registration_marketplace"].every((c) => tokCols.includes(c)), true);
  const gb = await createUser("Sch", "sch@example.com", "hunter22", "user");
  const c = await createCard(gb.id, { cardName: "Charizard", setName: "Base Set", cardNumber: "4", imageUrl: "https://img/4.png", condition: "Near Mint", price: 5 });
  const row = await db.prepare("SELECT ebay_marketplace, list_currency, list_price_local FROM cards WHERE id = ?").get(c.id);
  check("a new card row has NULL marketplace / currency / local price (= US / USD)", [row.ebay_marketplace, row.list_currency, row.list_price_local], [null, null, null]);
}

console.log("eBay connect stores the identity facts");
{
  const u1 = await createUser("Biz", "biz@example.com", "hunter22", "user", { homeCountry: "GB" });
  identity = { status: 200, body: { userId: "eb1", username: "bizseller", accountType: "BUSINESS", registrationMarketplaceId: "EBAY_GB" } };
  await completeEbayConnect(u1.id, "code");
  check("BUSINESS + EBAY_GB stored", await tokenRow(u1.id), { account_type: "BUSINESS", registration_marketplace: "EBAY_GB", ebay_user_id: "eb1", ebay_username: "bizseller" });

  identity = { status: 200, body: { userId: "eb1", username: "bizseller", accountType: "individual", registrationMarketplaceId: "ebay_gb" } };
  await completeEbayConnect(u1.id, "code");
  check("reconnect refreshes it; values are normalised to upper case", (({ account_type, registration_marketplace }) => ({ account_type, registration_marketplace }))(await tokenRow(u1.id)), { account_type: "INDIVIDUAL", registration_marketplace: "EBAY_GB" });

  identity = { status: 200, body: { userId: "eb1", username: "x", accountType: "WEIRD", registrationMarketplaceId: "not a marketplace" } };
  await completeEbayConnect(u1.id, "code");
  check("unrecognised values store NULL", (({ account_type, registration_marketplace }) => ({ account_type, registration_marketplace }))(await tokenRow(u1.id)), { account_type: null, registration_marketplace: null });

  identity = { status: 200, body: { userId: "eb1", username: "x" } };
  await completeEbayConnect(u1.id, "code");
  check("fields absent from the reply store NULL", (({ account_type, registration_marketplace }) => ({ account_type, registration_marketplace }))(await tokenRow(u1.id)), { account_type: null, registration_marketplace: null });

  const u2 = await createUser("Down", "down@example.com", "hunter22", "user", { homeCountry: "GB" });
  identity = { status: 500, body: { errors: [{ errorId: 1 }] } };
  const link = await completeEbayConnect(u2.id, "code");
  check("identity call fails (500): the connect still succeeds, facts NULL", [Boolean(link), (({ account_type, registration_marketplace }) => ({ account_type, registration_marketplace }))(await tokenRow(u2.id))], [true, { account_type: null, registration_marketplace: null }]);

  identity = { status: 200, body: "not json at all{" };
  const u3 = await createUser("Junk", "junk@example.com", "hunter22", "user");
  const link3 = await completeEbayConnect(u3.id, "code").catch(() => null);
  check("a non-object identity body never breaks the connect", Boolean(link3), true);
}

console.log("Switch ebay_local_markets");
{
  check("missing row = off", await ebayLocalMarketsOn(), false);
  check("key name", EBAY_LOCAL_MARKETS_KEY, "ebay_local_markets");
  for (const v of ["0", "true", "on", "yes", "", " 1", "1 "]) {
    await setSetting(EBAY_LOCAL_MARKETS_KEY, v);
    check(`${JSON.stringify(v)} = off`, await ebayLocalMarketsOn(), false);
  }
  await setSetting(EBAY_LOCAL_MARKETS_KEY, "1");
  check('exactly "1" = on', await ebayLocalMarketsOn(), true);
  await setSetting(EBAY_LOCAL_MARKETS_KEY, "0");
  check("back to off", await ebayLocalMarketsOn(), false);
}

console.log("Needs You: sellers abroad who connected eBay");
{
  identity = { status: 200, body: { userId: "x", username: "x", accountType: "INDIVIDUAL", registrationMarketplaceId: "EBAY_US" } };
  const connect = async (name, country) => {
    const u = await createUser(name, `${name.toLowerCase()}@example.com`, "hunter22", "user", { homeCountry: country });
    await completeEbayConnect(u.id, "code");
    return u;
  };
  const before = (await getOverviewPulse()).localTesters;
  check("the GB/Down/Biz accounts above already count (GB x2: Biz, Down)", before, [{ country: "GB", sellers: 2 }]);

  await connect("UsSeller", "US");
  await connect("NzSeller", "NZ");
  await connect("NoCountry", null);
  await createUser("GbNoEbay", "gbnoebay@example.com", "hunter22", "user", { homeCountry: "GB" });
  check("US, NZ, no-country and never-connected sellers add no row", (await getOverviewPulse()).localTesters, [{ country: "GB", sellers: 2 }]);

  await connect("AuSeller", "AU");
  await connect("IeSeller", "IE");
  await connect("CaSeller", "CA");
  const stale = await connect("OldGb", "GB");
  await db.prepare("UPDATE ebay_tokens SET connected_at = ? WHERE user_id = ?").run(Date.now() - 20 * 86_400_000, stale.id);
  const pulse = await getOverviewPulse();
  check("AU, IE, CA each get a row; a 20-day-old GB connect does not count", pulse.localTesters.map((t) => `${t.country}:${t.sellers}`).sort(), ["AU:1", "CA:1", "GB:2", "IE:1"]);

  check("wording, one seller", localTesterText("GB", 1), "Seller from GB connected eBay — first local-market tester");
  check("wording, several", localTesterText("GB", 2), "2 sellers from GB connected eBay — local-market testers");
}

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll eBay plumbing checks passed");
