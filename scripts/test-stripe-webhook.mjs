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
// GET /charges/:id and GET /invoice_payments?payment[payment_intent]=... (refund and dispute lookups).
const charges = new Map();
const invoicePayments = new Map();
const stripeCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith("https://api.stripe.com/")) return realFetch(url, init);
  stripeCalls.push(u);
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (u.includes("/charges/")) {
    const c = charges.get(u.split("/charges/")[1]);
    return c ? reply(c) : reply({ error: { message: "no such charge" } }, 404);
  }
  if (u.includes("/invoice_payments?")) {
    const inv = invoicePayments.get(new URL(u).searchParams.get("payment[payment_intent]"));
    return reply({ data: inv ? [{ invoice: inv }] : [] });
  }
  const id = u.split("/subscriptions/")[1];
  const sub = subscriptions.get(id);
  return sub ? reply(sub) : reply({ error: { message: "no such subscription" } }, 404);
};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { POST } = await import(at("app/api/stripe/webhook/route.ts"));
const { planForPrice } = await import(at("lib/server/stripe.ts"));
const { createUser, findUserById, setStripeCustomer, setSubscription, PAID_SWITCH_AT } = await import(at("lib/server/users.ts"));
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

// --- Scan Pack (09-25): checkout.session.completed with mode=payment -------
{
  const { PRICING } = await import(at("lib/pricing.ts"));
  const buyer = await createUser("Pack", "pack@example.com", "hunter22");
  const packSession = (id, extra = {}) => ({
    type: "checkout.session.completed",
    data: { object: { id, mode: "payment", payment_status: "paid", client_reference_id: buyer.id, customer: "cus_pack", metadata: { pack: "1", packScans: String(PRICING.pack.scans) }, ...extra } },
  });
  const balance = async () => (await findUserById(buyer.id)).extraScans;
  const callsBefore = stripeCalls.length;
  check("pack: credits extra_scans, stores the customer, no subscription fetch",
    [(await send(packSession("cs_pack_1"))).status, await balance(), (await findUserById(buyer.id)).stripeCustomerId, stripeCalls.length - callsBefore, (await state(buyer.id)).status],
    [200, PRICING.pack.scans, "cus_pack", 0, null]);
  check("pack: retried event is idempotent", [(await send(packSession("cs_pack_1"))).status, await balance()], [200, PRICING.pack.scans]);
  check("pack: a second purchase stacks", [(await send(packSession("cs_pack_2"))).status, await balance()], [200, PRICING.pack.scans * 2]);
  check("pack: credit follows the session's metadata, not today's constant",
    [(await send(packSession("cs_pack_3", { metadata: { pack: "1", packScans: "150" } }))).status, await balance()], [200, PRICING.pack.scans * 2 + 150]);
  check("pack: unpaid session → 200, nothing credited",
    [(await send(packSession("cs_pack_4", { payment_status: "unpaid" }))).status, await balance()], [200, PRICING.pack.scans * 2 + 150]);
  check("pack: payment-mode session without the pack flag → ignored",
    [(await send(packSession("cs_other", { metadata: {} }))).status, await balance()], [200, PRICING.pack.scans * 2 + 150]);
}

check("updated for an unknown customer → 200", (await send({ type: "customer.subscription.updated", data: { object: { customer: "cus_ghost", status: "active" } } })).status, 200);
check("an unhandled event (invoice.paid with no invoice in it) → 200 received", (await send({ type: "invoice.paid", data: { object: {} } })).json, { received: true });
check("unregistered event → 200 received", (await send({ type: "customer.created", data: { object: {} } })).json, { received: true });

// --- cancel-at-period-end is remembered (the account page says when banked scans pause) ---
{
  const who = await createUser("Cn", "cancel@example.com", "hunter22");
  await setStripeCustomer(who.id, "cus_cancel");
  const cancelAt = async () => (await findUserById(who.id)).subCancelAt;
  const upd = (extra) => send({ type: "customer.subscription.updated", data: { object: { id: "sub_cn", customer: "cus_cancel", status: "active", items: { data: [{ current_period_end: 1_850_000_000, price: { id: "price_std" } }] }, ...extra } } });
  await upd({ cancel_at_period_end: true });
  check("cancel_at_period_end true → the period end is stored", await cancelAt(), 1_850_000_000_000);
  await upd({});
  check("an event that does not carry the field leaves it alone", await cancelAt(), 1_850_000_000_000);
  await upd({ cancel_at_period_end: false, cancel_at: 1_860_000_000 });
  check("a set cancel_at date wins", await cancelAt(), 1_860_000_000_000);
  await upd({ cancel_at_period_end: false, cancel_at: null });
  check("resumed: cleared", await cancelAt(), null);
  await upd({ cancel_at_period_end: true });
  await send({ type: "customer.subscription.deleted", data: { object: { id: "sub_cn", customer: "cus_cancel", status: "canceled" } } });
  check("deleted: cleared", [await cancelAt(), (await state(who.id)).status], [null, "canceled"]);
}

// === Scan rollover credits (Chris, 09-30) ==================================================
const { PRICING, PRICE_IDS } = await import(at("lib/pricing.ts"));
const RETIRED_PRO = "price_1UBwtjHrYyCaAIAxHtHBqUl7";
const LIVE_PRO = "price_1UJmWRHrYyCaAIAxR9eImYvs";
const STD = PRICING.standard.scans;
const PRO = PRICING.pro.scans;
const cents = (p) => Math.round(PRICING[p].price * 100);
const planScans = async (id) => (await findUserById(id)).planScans;
const ledgerOf = async (id) => (await db.prepare("SELECT credit_key, kind, scans, applied FROM scan_credits WHERE user_id = ? ORDER BY rowid").all(id)).map((r) => [r.credit_key, r.kind, r.scans, r.applied]);
const errorsFrom = async (frag) => (await db.prepare("SELECT source, message FROM error_events ORDER BY at").all()).filter((e) => e.source.includes(frag)).map((e) => e.message);
let payers = 0;
async function mkPayer(over = "") {
  const p = await createUser("Pay", `payer${++payers}@example.com`, "hunter22");
  await setStripeCustomer(p.id, `cus_pay${payers}`);
  await db.prepare(`UPDATE users SET plan_scans = 0${over} WHERE id = ?`).run(p.id);
  return { id: p.id, cus: `cus_pay${payers}` };
}
// The two invoice shapes Stripe sends: the older one (invoice.subscription, lines[].price) and the current one
// (parent.subscription_details, lines[].pricing.price_details).
const oldInvoice = (id, cus, sub, price, extra = {}) => ({
  id, customer: cus, status: "paid", billing_reason: "subscription_cycle", subscription: sub, amount_paid: 999,
  lines: { data: [{ price: { id: price }, amount: 999, proration: false }] }, ...extra,
});
const newInvoice = (id, cus, sub, price, extra = {}) => ({
  id, customer: cus, status: "paid", billing_reason: "subscription_cycle", amount_paid: 999,
  parent: { type: "subscription_details", subscription_details: { subscription: sub } },
  lines: { data: [{ pricing: { price_details: { price } }, amount: 999, parent: { type: "subscription_item_details", subscription_item_details: { proration: false, subscription: sub } } }] }, ...extra,
});
const paid = (inv) => ({ type: "invoice.paid", data: { object: inv } });

{
  const p = await mkPayer();
  check("invoice.paid (older shape) credits the plan's scans", [(await send(paid(oldInvoice("in_a1", p.cus, "sub_a", "price_std")))).status, await planScans(p.id)], [200, STD]);
  check("a retried event credits once", [(await send(paid(oldInvoice("in_a1", p.cus, "sub_a", "price_std")))).status, await planScans(p.id), (await ledgerOf(p.id)).length], [200, STD, 1]);
  check("the current invoice shape credits too, on the Pro price → Pro's scans (stacks: 250 + 750)",
    [(await send(paid(newInvoice("in_a2", p.cus, "sub_a", "price_pro")))).status, await planScans(p.id)], [200, STD + PRO]);
  check("the ledger keeps one row per invoice", await ledgerOf(p.id), [["in_a1", "payment", STD, STD], ["in_a2", "payment", PRO, PRO]]);
  const row = await findUserById(p.id);
  check("the latest payment is remembered for the carried-over line", [row.planCreditScans, typeof row.planCreditAt], [PRO, "number"]);
}

// --- any subscription of the customer is credited; the pin only mirrors status ---
{
  const p = await mkPayer();
  subscriptions.set("sub_pinned", { status: "active", items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_std" } }] } });
  await send({ type: "checkout.session.completed", data: { object: { client_reference_id: p.id, customer: p.cus, subscription: "sub_pinned" } } });
  check("setup: sub_pinned is pinned", await subId(p.id), "sub_pinned");
  await send(paid(newInvoice("in_b1", p.cus, "sub_second", "price_std")));
  check("an invoice for a NON-pinned subscription is still credited (money arrived)", await planScans(p.id), STD);
  check("…and a second live subscription paying is reported for a human to refund",
    (await errorsFrom("second subscription paid")).some((m) => m.includes("in_b1") && m.includes("sub_second")), true);
  check("the pin is untouched by an invoice", await subId(p.id), "sub_pinned");
}
{
  // Resubscribe where invoice.paid(B) lands before subscription.created(B) / checkout, with the pin still on canceled A.
  const p = await mkPayer();
  subscriptions.set("sub_ra", { status: "active", items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_std" } }] } });
  await send({ type: "checkout.session.completed", data: { object: { client_reference_id: p.id, customer: p.cus, subscription: "sub_ra" } } });
  await send({ type: "customer.subscription.deleted", data: { object: { id: "sub_ra", customer: p.cus, status: "canceled" } } });
  const alertsBefore = (await errorsFrom("second subscription paid")).length;
  await send(paid(newInvoice("in_c1", p.cus, "sub_rb", "price_std")));
  check("resubscribe, invoice.paid first: credited even though the pin is on the canceled subscription", await planScans(p.id), STD);
  check("…and a dead pinned subscription is not a second payer", (await errorsFrom("second subscription paid")).length, alertsBefore);
  subscriptions.set("sub_rb", { status: "active", items: { data: [{ current_period_end: 1_810_000_000, price: { id: "price_std" } }] } });
  await send({ type: "checkout.session.completed", data: { object: { client_reference_id: p.id, customer: p.cus, subscription: "sub_rb", invoice: "in_c1", payment_status: "paid" } } });
  check("then checkout for the same invoice: credited once", [await planScans(p.id), (await state(p.id)).status], [STD, "active"]);
}

// --- checkout + invoice.paid for the same invoice, either order, credit once ---
{
  const first = await mkPayer();
  subscriptions.set("sub_co1", { status: "active", items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_std" } }] } });
  const co = (p, sub, inv, extra = {}) => ({ type: "checkout.session.completed", data: { object: { client_reference_id: p.id, customer: p.cus, subscription: sub, invoice: inv, payment_status: "paid", ...extra } } });
  await send(co(first, "sub_co1", "in_d1"));
  check("checkout credits the first invoice early (the welcome page finds scans)", [await planScans(first.id), (await state(first.id)).status], [STD, "active"]);
  await send(paid(newInvoice("in_d1", first.cus, "sub_co1", "price_std", { billing_reason: "subscription_create" })));
  check("invoice.paid for the same invoice afterwards adds nothing", [await planScans(first.id), (await ledgerOf(first.id)).length], [STD, 1]);

  const second = await mkPayer();
  subscriptions.set("sub_co2", { status: "active", items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_std" } }] } });
  await send(paid(newInvoice("in_d2", second.cus, "sub_co2", "price_std", { billing_reason: "subscription_create" })));
  await send(co(second, "sub_co2", "in_d2"));
  check("invoice.paid first, then checkout: credited once", [await planScans(second.id), (await ledgerOf(second.id)).length], [STD, 1]);

  const unpaid = await mkPayer();
  subscriptions.set("sub_co3", { status: "incomplete", items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_std" } }] } });
  await send(co(unpaid, "sub_co3", "in_d3", { payment_status: "unpaid" }));
  check("an unpaid checkout credits nothing", await planScans(unpaid.id), 0);

  const early = await mkPayer();
  subscriptions.set("sub_co4", { status: "active", items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_std" } }] } });
  await send({ type: "customer.subscription.created", data: { object: { id: "sub_co4", customer: early.cus, status: "active", items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_std" } }] } } } });
  check("subscription.created first flips the status but credits no scans (only paid invoices do)", [(await state(early.id)).status, await planScans(early.id)], ["active", 0]);
  await send(co(early, "sub_co4", "in_d4"));
  check("…then checkout credits them", await planScans(early.id), STD);
}

// --- what is NOT credited ---
{
  const p = await mkPayer();
  await send(paid(oldInvoice("in_e1", p.cus, "sub_e", "price_std", { billing_reason: "manual" })));
  await send(paid(oldInvoice("in_e2", p.cus, "sub_e", "price_std", { status: "open" })));
  await send(paid({ ...oldInvoice("in_e3", p.cus, null, "price_std"), subscription: null }));
  await send(paid(oldInvoice("in_e4", "cus_ghost_pay", "sub_e", "price_std")));
  check("manual invoice, unpaid invoice, one-off (no subscription): nothing", await planScans(p.id), 0);
  check("an invoice for a customer nobody knows: 200, nothing credited, reported",
    [(await send(paid(oldInvoice("in_e5", "cus_ghost_pay", "sub_e", "price_std")))).status, (await errorsFrom("no account")).some((m) => m.includes("in_e4"))], [200, true]);
}

// --- price ids: retired ids credit what they were sold for; unknown ids credit nothing ---
{
  const p = await mkPayer();
  check("the archived $24.99 Pro price id still credits today's Pro amount", [(await send(paid(newInvoice("in_f1", p.cus, "sub_f", RETIRED_PRO)))).status, await planScans(p.id)], [200, PRO]);
  check("planForPrice knows the retired ids too", [planForPrice(RETIRED_PRO), planForPrice(LIVE_PRO)], ["pro", "pro"]);
  const unknown = await send(paid(newInvoice("in_f2", p.cus, "sub_f", "price_never_heard_of")));
  check("an unknown price id: 200, credits NOTHING (never guesses standard), lands on the Errors page",
    [unknown.status, await planScans(p.id), (await errorsFrom("unknown price id")).some((m) => m.includes("price_never_heard_of") && m.includes("in_f2"))], [200, PRO, true]);
  check("…and nothing was written to the ledger for it", (await ledgerOf(p.id)).map((r) => r[0]), ["in_f1"]);
  // Prices change often: the env can move to a new Pro price. The old TEST id is then unknown, the LIVE ids still known.
  const savedPro = process.env.STRIPE_PRO_PRICE_ID;
  process.env.STRIPE_PRO_PRICE_ID = "price_pro_2027";
  const q = await mkPayer();
  await send(paid(newInvoice("in_f3", q.cus, "sub_q", "price_pro_2027")));
  await send(paid(newInvoice("in_f4", q.cus, "sub_q", LIVE_PRO)));
  await send(paid(newInvoice("in_f5", q.cus, "sub_q", "price_pro")));
  check("after the env moves to a new Pro price: the new id and the live id credit 750, the dropped test id credits nothing (no default to standard)",
    (await ledgerOf(q.id)).map((r) => [r[0], r[3]]), [["in_f3", PRO], ["in_f4", PRO]]);
  process.env.STRIPE_PRO_PRICE_ID = savedPro;
  check("every id pricing.ts lists maps to a plan", Object.values(PRICE_IDS).every((e) => e.plan === "standard" || e.plan === "pro"), true);
}

// --- a NEW subscriber owes nothing from the old monthly counter, whichever event lands first; an old one renewing is seeded ---
{
  const { SEED_MONTH } = await import(at("lib/planSeed.ts"));
  const OCT_2 = Date.UTC(2026, 9, 2, 12);
  const atTime = async (ms, fn) => {
    const real = Date.now;
    Date.now = () => ms;
    try { return await fn(); } finally { Date.now = real; }
  };
  // plan_scans NULL like every account on deploy day (mkPayer writes 0).
  const mkNull = async (sql = "") => {
    const p = await createUser("New", `new${++payers}@example.com`, "hunter22");
    await setStripeCustomer(p.id, `cus_new${payers}`);
    // An account from before the flip (a real clock after Oct 1 would otherwise make every fixture a post-flip account, which owes no seed).
    await db.prepare(`UPDATE users SET created_at = ?${sql ? `, ${sql}` : ""} WHERE id = ?`).run(PAID_SWITCH_AT + 1, p.id);
    return { id: p.id, cus: `cus_new${payers}` };
  };
  const live = (id, sub, price = "price_std") => ({ id: sub, customer: id, status: "active", items: { data: [{ current_period_end: 1_900_000_000, price: { id: price } }] } });
  const create = (inv, cus, sub) => paid(newInvoice(inv, cus, sub, "price_std", { billing_reason: "subscription_create" }));

  const a = await mkNull();
  await atTime(OCT_2, async () => {
    await send({ type: "customer.subscription.created", data: { object: live(a.cus, "sub_n1") } });
    await send(create("in_n1", a.cus, "sub_n1"));
  });
  check("new subscriber, subscription.created first: the first payment is the whole balance (no old-counter seed on top)", await planScans(a.id), STD);

  const b = await mkNull();
  await atTime(OCT_2, async () => {
    await send({ type: "customer.subscription.updated", data: { object: live(b.cus, "sub_n2") } });
    await send(create("in_n2", b.cus, "sub_n2"));
  });
  check("…and when subscription.updated (no marker) is the first event: a first payment never seeds either", [(await state(b.id)).status, await planScans(b.id)], ["active", STD]);

  // subscription.updated first, and the seller scans BEFORE the payment's invoice lands: no old allowance appears out of nowhere.
  const d = await mkNull("scan_month = '2026-10', scans_used = 0");
  await atTime(OCT_2, () => send({ type: "customer.subscription.updated", data: { object: live(d.cus, "sub_n4") } }));
  const { scanQuota, spendsPlanScans } = await import(at("lib/server/users.ts"));
  const { reserveScan } = await import(at("lib/server/scanQuota.ts"));
  const du = await findUserById(d.id);
  check("subscription.updated first: before the payment is credited the balance is 0, not a seeded old allowance",
    [spendsPlanScans(du), scanQuota(du, OCT_2).plan, du.planScans], [true, 0, 0]);
  const tried = await atTime(OCT_2, () => reserveScan(du));
  check("…so a scan in between is refused, and nothing was seeded", [tried.taken, (await ledgerOf(d.id)).length], [0, 0]);
  await atTime(OCT_2, () => send(create("in_n4", d.cus, "sub_n4")));
  check("…then the first payment lands: exactly one allowance", await planScans(d.id), STD);

  const c = await mkNull();
  subscriptions.set("sub_n3", { status: "active", items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_std" } }] } });
  await atTime(OCT_2, () => send({ type: "checkout.session.completed", data: { object: { client_reference_id: c.id, customer: c.cus, subscription: "sub_n3", invoice: "in_n3", payment_status: "paid" } } }));
  check("new subscriber through checkout: exactly the first payment", await planScans(c.id), STD);

  // An old subscriber (6cd43f): 12 of 250 used in September, no balance yet; their renewal lands before the migration script runs.
  const old = await mkNull("sub_status = 'active', plan = 'standard', scan_month = '" + SEED_MONTH + "', scans_used = 12");
  await atTime(OCT_2, () => send(paid(oldInvoice("in_o1", old.cus, "sub_old", "price_std"))));
  check("an old subscriber's renewal before the migration: September's leftover is seeded first, then the payment adds (238 + 250)", await planScans(old.id), STD - 12 + STD);
  check("…the ledger shows the seed and the payment", (await ledgerOf(old.id)).map((r) => r[0].startsWith("migration:") ? "migration" : r[0]), ["migration", "in_o1"]);
  const late = await mkNull("sub_status = 'active', plan = 'standard', scan_month = '" + SEED_MONTH + "', scans_used = 12");
  await atTime(Date.UTC(2026, 10, 5), () => send(paid(oldInvoice("in_o2", late.cus, "sub_old2", "price_std"))));
  check("after the seed window there is no seed, only the payment", await planScans(late.id), STD);
}
// --- a $0 invoice (100% promo code) still credits; paid-by-credit-balance prorations do not ---
{
  const p = await mkPayer();
  await send(paid(newInvoice("in_g1", p.cus, "sub_g", "price_std", { billing_reason: "subscription_create", amount_paid: 0 })));
  check("a $0 subscription invoice (a 100% promo code) still credits its scans", await planScans(p.id), STD);
}

// --- Standard -> Pro under always_invoice: the proration invoice credits only the difference, once ---
{
  const p = await mkPayer();
  await send(paid(newInvoice("in_h1", p.cus, "sub_h", "price_std", { billing_reason: "subscription_create" })));
  // Halfway through the period: credit for the unused half of Standard, charge for the remaining half of Pro; net = half the price gap.
  const gap = cents("pro") - cents("standard");
  const line = (price, amount) => ({ pricing: { price_details: { price } }, amount, parent: { subscription_item_details: { proration: true } } });
  const upgrade = (id, amounts, extra = {}) => ({
    id, customer: p.cus, status: "paid", billing_reason: "subscription_update", amount_paid: amounts[0] + amounts[1],
    parent: { subscription_details: { subscription: "sub_h" } },
    lines: { data: [line("price_std", amounts[0]), line("price_pro", amounts[1])] }, ...extra,
  });
  await send(paid(upgrade("in_h2", [-Math.round(cents("standard") / 2), Math.round(cents("pro") / 2)])));
  const expected = Math.round((PRO - STD) * ((Math.round(cents("pro") / 2) - Math.round(cents("standard") / 2)) / gap));
  check("a paid upgrade proration credits the plan difference scaled to what was paid (half the period → about half of 500)",
    [await planScans(p.id), Math.abs(expected - (PRO - STD) / 2) <= 1], [STD + expected, true]);
  check("…recorded as a proration credit", (await ledgerOf(p.id)).map((r) => r[1]), ["payment", "proration"]);
  await send(paid(upgrade("in_h2", [-Math.round(cents("standard") / 2), Math.round(cents("pro") / 2)])));
  check("the proration invoice replayed credits nothing more", await planScans(p.id), STD + expected);
  await send(paid(newInvoice("in_h3", p.cus, "sub_h", "price_pro")));
  check("the next renewal (now on the Pro price) adds Pro's full 750: no double credit", await planScans(p.id), STD + expected + PRO);

  const free = await mkPayer();
  await send(paid(upgrade("in_h4", [-500, 1500], { customer: free.cus, amount_paid: 0 })));
  check("an upgrade proration that cost nothing (covered by a credit balance) credits nothing", await planScans(free.id), 0);
  const down = await mkPayer();
  await send(paid({ ...upgrade("in_h5", [-cents("pro"), cents("standard")]), customer: down.cus, lines: { data: [line("price_pro", -cents("pro")), line("price_std", cents("standard"))] }, amount_paid: 100 }));
  check("a downgrade's proration invoice credits nothing", await planScans(down.id), 0);
  const cancelled = await mkPayer();
  check("upgrade then cancel with no proration invoice paid: nothing was ever credited", await planScans(cancelled.id), 0);
  const unk = await mkPayer();
  await send(paid({ ...upgrade("in_h6", [-500, 1500]), customer: unk.cus, lines: { data: [line("price_std", -500), line("price_mystery", 1500)] } }));
  check("a proration on an unknown price credits nothing and is reported", [await planScans(unk.id), (await errorsFrom("unknown price id")).some((m) => m.includes("price_mystery"))], [0, true]);
}

// --- a customer on an admin override who still pays: banked, unusable, flagged ---
{
  const p = await mkPayer(", access_override = 'legacy'");
  await send(paid(newInvoice("in_i1", p.cus, "sub_i", "price_std")));
  check("a paying customer on an override: the money arrived so the scans are banked and a ledger row is written",
    [await planScans(p.id), (await ledgerOf(p.id)).length], [STD, 1]);
  check("…and it is flagged for a human", (await errorsFrom("paying customer on an override")).some((m) => m.includes("in_i1")), true);
}

// --- refunds and disputes take the credit back ---
{
  const p = await mkPayer();
  await send(paid(oldInvoice("in_r1", p.cus, "sub_r", "price_std", { charge: "ch_r1", payment_intent: "pi_r1" })));
  const calls0 = stripeCalls.length;
  const half = await send({ type: "charge.refunded", data: { object: { id: "ch_r1", customer: p.cus, amount: 999, amount_refunded: 500, payment_intent: "pi_r1" } } });
  check("a partial refund takes back its share of the credit (found by the charge id saved at credit time, no Stripe call)",
    [half.status, await planScans(p.id), stripeCalls.length - calls0], [200, STD - Math.round(STD * (500 / 999)), 0]);
  await send({ type: "charge.refunded", data: { object: { id: "ch_r1", customer: p.cus, amount: 999, amount_refunded: 500, payment_intent: "pi_r1" } } });
  check("the same refund event again takes nothing more", await planScans(p.id), STD - Math.round(STD * (500 / 999)));
  await send({ type: "charge.refunded", data: { object: { id: "ch_r1", customer: p.cus, amount: 999, amount_refunded: 999, payment_intent: "pi_r1" } } });
  check("the rest of the refund takes the rest, to zero, never below", await planScans(p.id), 0);
  check("the ledger explains it: the credit and two reversals",
    (await ledgerOf(p.id)).map((r) => [r[1], r[3]]), [["payment", STD], ["reversal", -Math.round(STD * (500 / 999))], ["reversal", -(STD - Math.round(STD * (500 / 999)))]]);
}
{
  // Scans already used: the reversal floors at zero and says so.
  const p = await mkPayer();
  await send(paid(oldInvoice("in_r2", p.cus, "sub_r2", "price_std", { charge: "ch_r2" })));
  await db.prepare("UPDATE users SET plan_scans = 10 WHERE id = ?").run(p.id);
  await send({ type: "charge.refunded", data: { object: { id: "ch_r2", customer: p.cus, amount: 999, amount_refunded: 999 } } });
  const last = (await ledgerOf(p.id)).at(-1);
  check("refund after the scans were used: floors at zero, the row keeps what was asked and what moved",
    [await planScans(p.id), last[1], last[2], last[3]], [0, "reversal", -STD, -10]);
  check("…and it is reported (some scans could not be taken back)", (await errorsFrom("refund on scans already used")).some((m) => m.includes("in_r2")), true);
}
{
  // The current API does not put the charge on the invoice: the refund finds its credit through Stripe.
  const p = await mkPayer();
  await send(paid(newInvoice("in_r3", p.cus, "sub_r3", "price_std")));
  charges.set("ch_r3", { id: "ch_r3", customer: p.cus, payment_intent: "pi_r3" });
  invoicePayments.set("pi_r3", "in_r3");
  const calls0 = stripeCalls.length;
  await send({ type: "charge.refunded", data: { object: { id: "ch_r3", customer: p.cus, amount: 999, amount_refunded: 999, payment_intent: "pi_r3" } } });
  check("refund with no charge on the invoice: resolved through the charge and its invoice payment, credit taken back",
    [await planScans(p.id), stripeCalls.slice(calls0).map((u) => u.replace("https://api.stripe.com/v1/", "").split("?")[0])], [0, ["invoice_payments"]]);
  // A second lookup is local now: the charge is remembered on the ledger row.
  const row = await db.prepare("SELECT charge_id FROM scan_credits WHERE credit_key = 'in_r3'").get();
  check("the charge is remembered so the next lookup needs no Stripe call", row.charge_id, "ch_r3");

  const q = await mkPayer();
  await send(paid(newInvoice("in_r4", q.cus, "sub_r4", "price_std")));
  charges.set("ch_r4", { id: "ch_r4", customer: q.cus, payment_intent: "pi_r4" });
  invoicePayments.set("pi_r4", "in_r4");
  const dispute = { type: "charge.dispute.created", data: { object: { id: "dp_r4", charge: "ch_r4", payment_intent: "pi_r4", amount: 999 } } };
  await send(dispute);
  check("a dispute takes the whole credit back", await planScans(q.id), 0);
  await send(dispute);
  check("…once", (await ledgerOf(q.id)).length, 2);

  const packBuyer = await mkPayer();
  charges.set("ch_pack", { id: "ch_pack", customer: packBuyer.cus, payment_intent: "pi_pack" });
  await db.prepare("UPDATE users SET plan_scans = 7 WHERE id = ?").run(packBuyer.id);
  const packRefund = await send({ type: "charge.refunded", data: { object: { id: "ch_pack", customer: packBuyer.cus, amount: 499, amount_refunded: 499, payment_intent: "pi_pack" } } });
  check("a refund that is not a subscription payment (a Scan Pack) is ignored", [packRefund.status, await planScans(packBuyer.id)], [200, 7]);

  const late = await mkPayer();
  charges.set("ch_late", { id: "ch_late", customer: late.cus, payment_intent: "pi_late" });
  invoicePayments.set("pi_late", "in_late");
  await send({ type: "charge.refunded", data: { object: { id: "ch_late", customer: late.cus, amount: 999, amount_refunded: 999, payment_intent: "pi_late" } } });
  await send(paid(newInvoice("in_late", late.cus, "sub_late", "price_std")));
  check("an invoice fully refunded BEFORE its credit arrived (a late webhook or reconcile) credits zero", await planScans(late.id), 0);
}

// --- a database error is a 500 and leaves no half credit ---
{
  const p = await mkPayer();
  const realTx = db.transaction.bind(db);
  db.transaction = (fn) => realTx((tx) => fn({ ...tx, prepare: (sql) => { if (/UPDATE users SET plan_scans = (MAX\(0, )?COALESCE/.test(sql)) throw new Error("db down"); return tx.prepare(sql); } }));
  const bad = await send(paid(oldInvoice("in_j1", p.cus, "sub_j", "price_std")));
  db.transaction = realTx;
  check("invoice.paid with a failing balance write → 500 (Stripe retries)", bad.status, 500);
  check("…and nothing is half done: no ledger row, no scans", [await planScans(p.id), (await ledgerOf(p.id)).length], [0, 0]);
  const retry = await send(paid(oldInvoice("in_j1", p.cus, "sub_j", "price_std")));
  check("the retry credits it exactly once", [retry.status, await planScans(p.id), (await ledgerOf(p.id)).length], [200, STD, 1]);
}
{
  // Checkout: the credit comes BEFORE the status flips, so a failure leaves the account unsubscribed and the retry
  // still sends the welcome edge (referral reward) instead of finding an active user with no scans.
  const referrer = await mkPayer();
  await setSubscription(referrer.id, "active", Date.now() + 86_400_000, "standard");
  const friend = await mkPayer();
  await db.prepare("UPDATE users SET referred_by = ? WHERE id = ?").run(referrer.id, friend.id);
  subscriptions.set("sub_j2", { status: "active", items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_std" } }] } });
  const checkoutEvent = { type: "checkout.session.completed", data: { object: { client_reference_id: friend.id, customer: friend.cus, subscription: "sub_j2", invoice: "in_j2", payment_status: "paid" } } };
  const realTx = db.transaction.bind(db);
  db.transaction = (fn) => realTx((tx) => fn({ ...tx, prepare: (sql) => { if (/UPDATE users SET plan_scans = (MAX\(0, )?COALESCE/.test(sql)) throw new Error("db down"); return tx.prepare(sql); } }));
  const bad = await send(checkoutEvent);
  db.transaction = realTx;
  const mid = await findUserById(friend.id);
  check("checkout whose credit throws: 500, the user is still not subscribed, nobody was rewarded", [bad.status, mid.subStatus, (await findUserById(referrer.id)).bonusScans, await planScans(friend.id)], [500, null, 0, 0]);
  const ok = await send(checkoutEvent);
  const REWARD = (await import(at("lib/server/referrals.ts"))).REFERRAL_BONUS_SCANS;
  check("the retry redoes everything: subscribed, scans credited once, referral reward paid once",
    [ok.status, (await findUserById(friend.id)).subStatus, await planScans(friend.id), (await findUserById(referrer.id)).bonusScans], [200, "active", STD, REWARD]);
}

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
