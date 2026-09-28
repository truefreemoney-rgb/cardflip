/**
 * Phone notifications (Tier 2 #9). Run: npm run test:push
 *
 * Pins: the banner copy for each event (dip, target, spike, mixed, sold,
 * ticket reply) with the page each opens; the subscription store (save,
 * re-own an endpoint, bad input refused, remove, count); sendPushToUser
 * through a fake transport (one payload per device, dead 410/404
 * subscriptions dropped, other failures counted and never thrown,
 * unconfigured = no-op); the wishlist sweep fires the push alongside the
 * mail; a ticket reply pushes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-push-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { wishlistDipPush, cardAlertPush, soldPush, ticketReplyPush } = await import(at("lib/pushMessages.ts"));
const { savePushSubscription, removePushSubscription, countPushSubscriptions, sendPushToUser, isPushConfigured } = await import(at("lib/server/push.ts"));
const { sweepWishlistAlerts } = await import(at("lib/server/wishlistAlerts.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

console.log("copy");
check("one dip", wishlistDipPush([{ name: "Charizard", price: 400, target: 450 }]), { title: "Charizard dipped to $400.00", body: "Your alert was $450.00. Tap to see it on your watchlist.", url: "/app/wishlist", tag: "wishlist-dip" });
check("many dips, three named", wishlistDipPush([{ name: "A", price: 1, target: 2 }, { name: "B", price: 1, target: 2 }, { name: "C", price: 1, target: 2 }, { name: "D", price: 1, target: 2 }]).body, "A $1.00 · B $1.00 · C $1.00 · …");
check("target reached", cardAlertPush([{ name: "Umbreon ex", price: 1500, target: 1400, kind: "target" }]).title, "Umbreon ex reached $1500.00");
check("spike", cardAlertPush([{ name: "Pikachu", price: 12.5, target: 10, kind: "spike" }]), { title: "Pikachu is up 25% this week", body: "$12.50 today, $10.00 a week ago. Good time to sell.", url: "/app/collection", tag: "card-alert" });
check("mixed", cardAlertPush([{ name: "A", price: 2, target: 1, kind: "target" }, { name: "B", price: 2, target: 1, kind: "spike" }]).body, "1 reached your price · 1 spiked this week. Tap to see them.");
check("one sale", soldPush([{ name: "Charizard", soldPrice: 800 }]).title, "Charizard sold for $800.00");
check("many sales total", soldPush([{ name: "A", soldPrice: 10 }, { name: "B", soldPrice: null }]).title, "2 cards sold · $10.00");
check("ticket reply, trimmed", ticketReplyPush({ number: 7 }, "  Hi!   " + "x".repeat(200)), { title: "Support replied on ticket #7", body: ("Hi! " + "x".repeat(200)).slice(0, 117) + "…", url: "/app/help", tag: "ticket-7" });

console.log("\nstore");
const u = await createUser("Seller", "seller@example.com", "hunter22", "user");
const other = await createUser("Other", "other@example.com", "hunter22", "user");
const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "p" + n, auth: "a" + n } });
await savePushSubscription(u.id, sub(1), "iPhone");
await savePushSubscription(u.id, sub(2), null);
check("two devices", await countPushSubscriptions(u.id), 2);
await savePushSubscription(other.id, sub(2), null);
check("an endpoint re-owned moves, never duplicates", [await countPushSubscriptions(u.id), await countPushSubscriptions(other.id)], [1, 1]);
let threw = false;
try { await savePushSubscription(u.id, { endpoint: "http://insecure", keys: { p256dh: "p", auth: "a" } }); } catch { threw = true; }
check("http endpoint refused", threw, true);
check("remove by owner only", [await removePushSubscription(u.id, sub(2).endpoint), await removePushSubscription(other.id, sub(2).endpoint)], [false, true]);
await savePushSubscription(u.id, sub(2), null);
await savePushSubscription(u.id, sub(3), null);

console.log("\nsend");
check("unconfigured = no-op", [isPushConfigured(), await sendPushToUser(u.id, { title: "t", body: "b", url: "/app", tag: "x" })], [false, { sent: 0, dropped: 0, failed: 0 }]);
const gone = Object.assign(new Error("gone"), { statusCode: 410 });
const boom = Object.assign(new Error("boom"), { statusCode: 500 });
const calls = [];
const transport = async (s, payload) => {
  calls.push([s.endpoint, JSON.parse(payload).title]);
  if (s.endpoint.endsWith("/2")) throw gone;
  if (s.endpoint.endsWith("/3")) throw boom;
};
const r = await sendPushToUser(u.id, { title: "Hello", body: "b", url: "/app", tag: "x" }, transport);
check("one per device; 410 dropped; 500 counted, not thrown", [r, calls.length], [{ sent: 1, dropped: 1, failed: 1 }, 3]);
check("dead device is gone", await countPushSubscriptions(u.id), 2);
check("last_sent_at stamped on the live one", ((await db.prepare("SELECT last_sent_at FROM push_subscriptions WHERE endpoint = ?").get(sub(1).endpoint)).last_sent_at) > 0, true);
check("unknown user = nothing", await sendPushToUser("nobody", { title: "t", body: "b", url: "/", tag: "x" }, transport), { sent: 0, dropped: 0, failed: 0 });

console.log("\nsweeps push alongside the mail");
await db.prepare(
  `INSERT INTO wishlist_items (id, user_id, card_id, card_name, english_name, set_name, card_number, image_url, language, alert_price, added_at)
   VALUES ('w1', ?, 'base1-4', 'Charizard', NULL, 'Base Set', '4', '', 'en', 500, 1)`,
).run(u.id);
await recordPoint("base1-4", "pokemon", "holofoil", "tcgplayer", "USD", 450);
const pushed = [];
const res = await sweepWishlistAlerts(Date.now(), { configured: () => true, send: async () => {}, push: async (userId, m) => { pushed.push([userId, m.title]); return { sent: 1, dropped: 0, failed: 0 }; } });
check("dip mail sent and the banner followed", [res.sent, pushed], [1, [[u.id, "Charizard dipped to $450.00"]]]);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
