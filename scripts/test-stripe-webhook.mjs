/**
 * The Stripe webhook (app/api/stripe/webhook/route.ts) + planForPrice. Run:
 * npm run test:webhook
 *
 * Pins: signature rules (missing/bad/stale → 400, never touches the DB);
 * checkout.session.completed stores the customer, status, period end and
 * the plan from the price id (Pro vs standard); a retried checkout is
 * idempotent; subscription.updated follows status + a portal plan switch;
 * subscription.deleted marks canceled and keeps the plan column; unknown
 * customers and unregistered events are 200-and-ignored; a DB throw is a
 * 500 so Stripe retries. Stripe's API is a fetch stub — no network.
 *
 * Re-subscribe (09-09): checkout pins users.stripe_subscription_id; a
 * .deleted / non-live .updated for a DIFFERENT subscription is ignored, so
 * the old subscription ending after a new one is active never cancels a
 * paying user. A live .created/.updated for a new subscription adopts it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import crypto from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-webhook-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.STRIPE_PRICE_ID = "price_std";
process.env.STRIPE_PRO_PRICE_ID = "price_pro";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

// Stripe's GET /subscriptions/:id, served from a map the test fills.
const subscriptions = new Map();
const stripeCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith("https://api.stripe.com/")) return realFetch(url, init);
  stripeCalls.push(u);
  const id = u.split("/subscriptions/")[1];
  const sub = subscriptions.get(id);
  return new Response(JSON.stringify(sub ?? { error: { message: "no such subscription" } }), {
    status: sub ? 200 : 404,
    headers: { "content-type": "application/json" },
  });
};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { POST } = await import(at("app/api/stripe/webhook/route.ts"));
const { planForPrice } = await import(at("lib/server/stripe.ts"));
const { createUser, findUserById, setStripeCustomer } = await import(at("lib/server/users.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}
function sign(body, secret = "whsec_test", t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}
async function send(event, opts = {}) {
  const body = JSON.stringify(event);
  const headers = { "content-type": "application/json" };
  const sig = "signature" in opts ? opts.signature : sign(body);
  if (sig) headers["stripe-signature"] = sig;
  const res = await POST(new Request("http://test/api/stripe/webhook", { method: "POST", headers, body }));
  return { status: res.status, json: await res.json() };
}
async function state(id) {
  const u = await findUserById(id);
  return { status: u.subStatus, end: u.subPeriodEnd, plan: u.plan, customer: u.stripeCustomerId };
}
async function subId(id) {
  return (await findUserById(id)).stripeSubscriptionId;
}

// --- planForPrice -------------------------------------------------------------
check("pro price → pro", planForPrice("price_pro"), "pro");
check("standard price → standard", planForPrice("price_std"), "standard");
check("unknown / missing price → standard", [planForPrice("price_other"), planForPrice(null), planForPrice(undefined)], ["standard", "standard", "standard"]);

// --- signature ----------------------------------------------------------------
const user = await createUser("S", "seller@example.com", "hunter22");
const checkout = { type: "checkout.session.completed", data: { object: { client_reference_id: user.id, customer: "cus_1", subscription: "sub_1" } } };
subscriptions.set("sub_1", { status: "active", items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_std" } }] } });

check("no signature → 400", (await send(checkout, { signature: null })).status, 400);
check("wrong secret → 400", (await send(checkout, { signature: sign(JSON.stringify(checkout), "whsec_other") })).status, 400);
check("stale timestamp → 400", (await send(checkout, { signature: sign(JSON.stringify(checkout), "whsec_test", Math.floor(Date.now() / 1000) - 600) })).status, 400);
const tampered = await POST(new Request("http://test/x", { method: "POST", headers: { "stripe-signature": sign("{}") }, body: JSON.stringify(checkout) }));
check("tampered body → 400", tampered.status, 400);
check("nothing written on a bad signature", await state(user.id), { status: null, end: null, plan: null, customer: null });
check("Stripe never called on a bad signature", stripeCalls.length, 0);
const badJson = await POST(new Request("http://test/x", { method: "POST", headers: { "stripe-signature": sign("not json") }, body: "not json" }));
check("signed but unparseable → 400", badJson.status, 400);

// --- checkout.session.completed ---------------------------------------------
check("checkout completed → 200", (await send(checkout)).status, 200);
check("customer, status, period end (ms) and plan stored", await state(user.id), { status: "active", end: 1_800_000_000_000, plan: "standard", customer: "cus_1" });
check("subscription fetched from Stripe once", stripeCalls, ["https://api.stripe.com/v1/subscriptions/sub_1"]);
const retry = await send(checkout);
check("retried checkout is idempotent", retry.status === 200 && JSON.stringify(await state(user.id)) === JSON.stringify({ status: "active", end: 1_800_000_000_000, plan: "standard", customer: "cus_1" }));

const pro = await createUser("P", "pro@example.com", "hunter22");
subscriptions.set("sub_pro", { status: "trialing", current_period_end: 1_900_000_000, items: { data: [{ price: { id: "price_pro" } }] } });
await send({ type: "checkout.session.completed", data: { object: { client_reference_id: pro.id, customer: "cus_pro", subscription: "sub_pro" } } });
check("pro price id → plan pro; top-level period end honoured", await state(pro.id), { status: "trialing", end: 1_900_000_000_000, plan: "pro", customer: "cus_pro" });

const byCustomer = await createUser("C", "cust@example.com", "hunter22");
await setStripeCustomer(byCustomer.id, "cus_known");
await send({ type: "checkout.session.completed", data: { object: { customer: "cus_known", subscription: "sub_1" } } });
check("no client_reference_id: found by stored customer id", (await state(byCustomer.id)).status, "active");

check("unknown user → 200, nothing stored", (await send({ type: "checkout.session.completed", data: { object: { client_reference_id: "nope", customer: "cus_x", subscription: "sub_1" } } })).status, 200);
const noSub = await send({ type: "checkout.session.completed", data: { object: { client_reference_id: user.id } } });
check("missing subscription id → 200, untouched", noSub.status === 200 && (await state(user.id)).status === "active");

// --- customer.subscription.updated / deleted --------------------------------
await send({ type: "customer.subscription.updated", data: { object: { customer: "cus_1", status: "past_due", items: { data: [{ current_period_end: 1_810_000_000, price: { id: "price_std" } }] } } } });
check("updated: status + new period end", await state(user.id), { status: "past_due", end: 1_810_000_000_000, plan: "standard", customer: "cus_1" });

await send({ type: "customer.subscription.updated", data: { object: { customer: "cus_1", status: "active", items: { data: [{ current_period_end: 1_810_000_000, price: { id: "price_pro" } }] } } } });
check("portal plan switch: updated carries the new price → pro", (await state(user.id)).plan, "pro");

await send({ type: "customer.subscription.updated", data: { object: { customer: "cus_1", status: "active", current_period_end: 1_820_000_000 } } });
check("updated without items: top-level period end, plan column untouched", await state(user.id), { status: "active", end: 1_820_000_000_000, plan: "pro", customer: "cus_1" });

await send({ type: "customer.subscription.deleted", data: { object: { customer: "cus_pro", status: "active" } } });
check("deleted: canceled, period end cleared, plan column kept", await state(pro.id), { status: "canceled", end: null, plan: "pro", customer: "cus_pro" });

// --- re-subscribe: a second subscription under the same customer ------------
const resub = await createUser("R", "resub@example.com", "hunter22");
subscriptions.set("sub_old", { status: "active", items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_std" } }] } });
subscriptions.set("sub_new", { status: "active", items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_pro" } }] } });
await send({ type: "checkout.session.completed", data: { object: { client_reference_id: resub.id, customer: "cus_re", subscription: "sub_old" } } });
check("checkout pins the subscription id", await subId(resub.id), "sub_old");
await send({ type: "customer.subscription.deleted", data: { object: { id: "sub_old", customer: "cus_re", status: "canceled" } } });
check("old subscription deleted → canceled", (await state(resub.id)).status, "canceled");
await send({ type: "checkout.session.completed", data: { object: { client_reference_id: resub.id, customer: "cus_re", subscription: "sub_new" } } });
check("re-subscribe: new subscription pinned, active, pro", [await subId(resub.id), (await state(resub.id)).status, (await state(resub.id)).plan], ["sub_new", "active", "pro"]);
const staleDelete = await send({ type: "customer.subscription.deleted", data: { object: { id: "sub_old", customer: "cus_re", status: "canceled" } } });
check("old subscription deleted AFTER the new one is active → ignored, still active", [staleDelete.status, staleDelete.json.ignored, (await state(resub.id)).status], [200, true, "active"]);
await send({ type: "customer.subscription.updated", data: { object: { id: "sub_old", customer: "cus_re", status: "past_due", items: { data: [{ current_period_end: 1_700_000_000, price: { id: "price_std" } }] } } } });
check("stale past_due for the old subscription → ignored (status, plan, end untouched)", await state(resub.id), { status: "active", end: 1_900_000_000_000, plan: "pro", customer: "cus_re" });
await send({ type: "customer.subscription.updated", data: { object: { id: "sub_new", customer: "cus_re", status: "past_due", items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_pro" } }] } } } });
check("updated for the pinned subscription still applies", (await state(resub.id)).status, "past_due");
await send({ type: "customer.subscription.created", data: { object: { id: "sub_third", customer: "cus_re", status: "trialing", items: { data: [{ current_period_end: 2_000_000_000, price: { id: "price_std" } }] } } } });
check("a live subscription.created for another subscription adopts it", [await subId(resub.id), (await state(resub.id)).status, (await state(resub.id)).plan], ["sub_third", "trialing", "standard"]);
await send({ type: "customer.subscription.deleted", data: { object: { id: "sub_third", customer: "cus_re", status: "canceled" } } });
check("deleting the pinned subscription cancels", (await state(resub.id)).status, "canceled");

check("updated for an unknown customer → 200", (await send({ type: "customer.subscription.updated", data: { object: { customer: "cus_ghost", status: "active" } } })).status, 200);
check("unregistered event → 200 received", (await send({ type: "invoice.paid", data: { object: {} } })).json, { received: true });

// --- handler failure → 500 so Stripe retries ---------------------------------
const realPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  if (/UPDATE users SET sub_status/.test(sql)) throw new Error("db down");
  return realPrepare(sql);
};
check("DB throw → 500", (await send({ type: "customer.subscription.updated", data: { object: { customer: "cus_1", status: "active" } } })).status, 500);
db.prepare = realPrepare;

globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
