// Apple in-app purchase crediting (lib/server/appleIap.ts applyTransaction, 10-31), on the LOCAL database only:
// decoded transactions stand in for Apple-signed ones (the signature check is Apple's library, not ours).
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/test-apple-iap.mjs
import assert from "node:assert/strict";

if (process.env.TURSO_DATABASE_URL) throw new Error("refusing: TURSO_DATABASE_URL is set (this test writes rows)");
const { applyTransaction, appleKey } = await import("../src/lib/server/appleIap.ts");
const { createUser, deleteUser, findUserById, isSubscribed } = await import("../src/lib/server/users.ts");
const { db } = await import("../src/lib/db.ts");

const run = Date.now().toString(36);
const a = await createUser("IAP Test A", `iap-a-${run}@example.test`, "", "user");
const b = await createUser("IAP Test B", `iap-b-${run}@example.test`, "", "user");
const later = Date.now() + 30 * 86_400_000;
const keys = [];
const tx = (id, extra) => {
  keys.push(appleKey(`${run}-${id}`));
  return { transactionId: `${run}-${id}`, appAccountToken: a.id, price: 4990, ...extra };
};
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
try {
  // Booster: +100 once.
  const pack = tx("p1", { productId: "io.cardflip.app.booster100" });
  ok((await applyTransaction(a, pack, "app")).result === "credited", "pack credits");
  ok((await applyTransaction(a, pack, "notification")).result === "already", "pack credits once");
  let u = await findUserById(a.id);
  // 100 + the trial's 5 unused free scans, kept on a purchase (users.keepTrialScans, 10-31).
  ok(u.extraScans === 105, `extra_scans 105 (got ${u.extraScans})`);

  // CardFlip subscription: 250 plan scans, Apple-sourced active subscription.
  const sub1 = tx("s1", { productId: "io.cardflip.app.standard.monthly", originalTransactionId: `${run}-o1`, expiresDate: later, price: 9990 });
  ok((await applyTransaction(u, sub1, "app")).result === "credited", "subscription credits");
  u = await findUserById(a.id);
  ok(u.planScans === 250 && isSubscribed(u) && u.subSource === "apple" && u.plan === "standard", `subscribed via Apple with 250 (got ${u.planScans} ${u.subStatus} ${u.subSource} ${u.plan})`);
  ok(u.appleOriginalTransactionId === `${run}-o1`, "pinned to the original transaction");

  // Renewal: +250 more (rollover), same subscription.
  const sub2 = tx("s2", { productId: "io.cardflip.app.standard.monthly", originalTransactionId: `${run}-o1`, expiresDate: later + 30 * 86_400_000, price: 9990 });
  ok((await applyTransaction(u, sub2, "notification")).result === "credited", "renewal credits");
  u = await findUserById(a.id);
  ok(u.planScans === 500, `rollover 500 (got ${u.planScans})`);

  // Someone else presenting the same subscription gets nothing.
  const steal = tx("s3", { productId: "io.cardflip.app.standard.monthly", originalTransactionId: `${run}-o1`, expiresDate: later, appAccountToken: b.id });
  ok((await applyTransaction(b, steal, "app")).result === "other_account", "another account's subscription refused");

  // An upgraded-away transaction credits nothing; a $0 offer credits nothing; an unknown product is refused.
  ok((await applyTransaction(u, tx("s4", { productId: "io.cardflip.app.standard.monthly", originalTransactionId: `${run}-o1`, expiresDate: later, isUpgraded: true }), "notification")).result !== "credited", "upgraded-away credits nothing");
  ok((await applyTransaction(u, tx("s5", { productId: "io.cardflip.app.pro.monthly", originalTransactionId: `${run}-o1`, expiresDate: later, price: 0 }), "app")).result === "not_paid", "$0 offer credits nothing");
  ok((await applyTransaction(u, tx("x1", { productId: "io.cardflip.app.unknown" }), "app")).result === "unknown_product", "unknown product refused");
  u = await findUserById(a.id);
  ok(u.planScans === 500, `still 500 (got ${u.planScans})`);

  // Sandbox (TestFlight, App Review): credited like any purchase, under its own key that the sales numbers skip.
  const sandboxId = `${run}-sb1`;
  keys.push(appleKey(sandboxId, true));
  ok((await applyTransaction(u, { transactionId: sandboxId, appAccountToken: a.id, price: 4990, productId: "io.cardflip.app.booster100", environment: "Sandbox" }, "app")).result === "credited", "sandbox Booster credits");
  const sbRow = await db.prepare("SELECT session_id FROM scan_pack_purchases WHERE session_id = ?").get(appleKey(sandboxId, true));
  ok(sbRow?.session_id === `apple-sandbox:${sandboxId}`, `sandbox Booster keyed apple-sandbox: (got ${sbRow?.session_id})`);
  ok(appleKey(sandboxId) === `apple:${sandboxId}`, "production keys unchanged");
  console.log(`apple iap crediting: ${n} checks passed`);
} finally {
  for (const k of keys) {
    await db.prepare("DELETE FROM scan_credits WHERE credit_key = ?").run(k);
    await db.prepare("DELETE FROM scan_pack_purchases WHERE session_id = ?").run(k);
  }
  await deleteUser(a.id);
  await deleteUser(b.id);
}
