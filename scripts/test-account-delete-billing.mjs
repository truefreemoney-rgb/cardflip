/**
 * Deleting an account stops its billing first (10-01 security sweep: a deleted
 * account kept its Stripe subscription, charged monthly with no login left to
 * cancel). Run: npm run test:deletebilling
 *
 * Pins cancelAllSubscriptions (lib/server/stripe.ts): every chargeable
 * subscription on the customer is DELETEd, plus a pinned one the list missed;
 * canceled ones are left alone; a vanished pinned id is not an error; a Stripe
 * failure throws (so the route refuses the delete). And both delete routes
 * call it before deleteUser. Stripe is a fetch stub, no network.
 */
import { readFileSync } from "node:fs";

process.env.STRIPE_SECRET_KEY = "sk_test_x";

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const calls = [];
let subs = [];
let pinned = {};
let failOn = null;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = init.method ?? "GET";
  calls.push(`${method} ${u.pathname.replace("/v1/", "")}`);
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (failOn && method === failOn) return reply(500, { error: { message: "boom" } });
  if (method === "GET" && u.pathname === "/v1/subscriptions") return reply(200, { data: subs.filter((s) => s.customer === u.searchParams.get("customer")) });
  if (method === "GET" && u.pathname.startsWith("/v1/subscriptions/")) {
    const id = decodeURIComponent(u.pathname.split("/").pop());
    return pinned[id] ? reply(200, pinned[id]) : reply(404, { error: { message: `No such subscription: '${id}'` } });
  }
  if (method === "DELETE") return reply(200, { id: u.pathname.split("/").pop(), status: "canceled" });
  return reply(404, { error: { message: "unexpected" } });
};

const { cancelAllSubscriptions } = await import("../src/lib/server/stripe.ts");

console.log("cancelAllSubscriptions");
subs = [
  { id: "sub_live", customer: "cus_1", status: "active" },
  { id: "sub_due", customer: "cus_1", status: "past_due" },
  { id: "sub_old", customer: "cus_1", status: "canceled" },
  { id: "sub_other", customer: "cus_2", status: "active" },
];
calls.length = 0;
check("cancels every chargeable subscription on the customer, not canceled ones or other customers'", [await cancelAllSubscriptions("cus_1", "sub_live"), calls.filter((c) => c.startsWith("DELETE"))], [2, ["DELETE subscriptions/sub_live", "DELETE subscriptions/sub_due"]]);

subs = [];
pinned = { sub_pin: { status: "trialing" } };
calls.length = 0;
check("a pinned subscription the customer list missed is still canceled", [await cancelAllSubscriptions("cus_9", "sub_pin"), calls.filter((c) => c.startsWith("DELETE"))], [1, ["DELETE subscriptions/sub_pin"]]);

pinned = {};
calls.length = 0;
check("a pinned id Stripe no longer has is not an error and cancels nothing", [await cancelAllSubscriptions(null, "sub_gone"), calls.filter((c) => c.startsWith("DELETE"))], [0, []]);

calls.length = 0;
check("no customer and no subscription: no Stripe call at all", [await cancelAllSubscriptions(null, null), calls], [0, []]);

subs = [{ id: "sub_live", customer: "cus_1", status: "active" }];
failOn = "DELETE";
let threw = false;
try { await cancelAllSubscriptions("cus_1", null); } catch { threw = true; }
check("a failed cancel throws, so the delete is refused", threw, true);
failOn = "GET";
threw = false;
try { await cancelAllSubscriptions("cus_1", null); } catch { threw = true; }
check("Stripe unreachable on the lookup throws too", threw, true);
failOn = null;

console.log("delete routes cancel before they delete");
for (const f of ["src/app/api/account/route.ts", "src/app/api/admin/users/[id]/route.ts"]) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const del = src.slice(src.indexOf("export async function DELETE"));
  const c = del.indexOf("cancelAllSubscriptions("), d = del.indexOf("deleteUser(");
  check(`${f}: cancelAllSubscriptions runs before deleteUser, and a failure returns 502`, [c > 0 && d > c, /status: 502/.test(del.slice(c, d))], [true, true]);
}

console.log("password re-checks are rate limited durably (10-01 sweep)");
for (const f of ["src/app/api/account/route.ts", "src/app/api/account/totp/route.ts"]) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  check(`${f}: db-backed limiter only, and an account-keyed one`, [/\blimitOrRespond\(/.test(src), src.includes("limitOrRespondAsync("), /acct:\$\{user\.id\}/.test(src)], [false, true, true]);
}

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);
