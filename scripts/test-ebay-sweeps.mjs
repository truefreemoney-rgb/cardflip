/**
 * The daily-job sweeps that act on the ledger without a page load, over a
 * fetch stub: watcher offers (Negotiation API) + the opt-in auto-offer sweep,
 * wishlist dip alerts, and reprice nudges. Run: npm run test:ebaysweeps
 *
 * Pins — offers: no listing / bad percent / not connected refuse before any
 * call; a send posts the exact Negotiation body and stamps watcher_offer_at;
 * 403 → reconnect message; other eBay errors → eBay's seller message; the
 * eligible list pages by 200. Auto-offer sweep: only opted-in sellers, only
 * listings 14+ days old and never offered, only eBay-eligible ones, capped
 * at 10 per seller per run, skipped entirely when eBay can't answer.
 * Alerts: mail off → nothing checked; a price at/below target fires once per
 * user with every hit in one mail and stamps alerted_at; above target stays
 * quiet; a failed send stamps nothing (next pass retries); re-setting the
 * target re-arms. Nudges: 15%+ drift either way after 7 days, only for rows
 * with a catalog id and a USD series.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.EBAY_CLIENT_ID = "cid";
process.env.EBAY_CLIENT_SECRET = "csecret";
process.env.EBAY_RU_NAME = "ru";
process.env.EBAY_TOKEN_KEY = "test-token-key";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-sweeps-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

// --- fetch stub ---------------------------------------------------------------
const routes = { eligible: [], sendOffer: null };
const posts = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/identity/v1/oauth2/token")) {
    return json({ access_token: "tok-1", expires_in: 7200, refresh_token: "ref-1", refresh_token_expires_in: 47304000, token_type: "User" });
  }
  if (url.includes("/commerce/identity/")) return json({ userId: "ebay-u1", username: "seller1" });
  if (url.includes("/sell/negotiation/v1/find_eligible_items")) {
    const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
    const page = routes.eligible[offset / 200];
    if (page instanceof Response) return page;
    return json(page ?? { eligibleItems: [] });
  }
  if (url.includes("/sell/negotiation/v1/send_offer_to_interested_buyers")) {
    posts.push(JSON.parse(init.body));
    return routes.sendOffer ?? json({ offers: [{ offerId: "x" }] });
  }
  throw new Error(`unexpected fetch ${url}`);
};
const realError = console.error;
const realWarn = console.warn;
console.error = () => {};
console.warn = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { findEligibleListingIds, sendWatcherOffer, sweepAutoOffers } = await import(at("lib/server/ebayNegotiation.ts"));
const { sweepWishlistAlerts } = await import(at("lib/server/wishlistAlerts.ts"));
const { getRepriceNudges } = await import(at("lib/server/repriceNudges.ts"));
const { completeEbayConnect } = await import(at("lib/server/ebayAuth.ts"));
const { createCard, getCardForUser } = await import(at("lib/server/cards.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { addToWishlist, setWishlistAlert, listWishlist } = await import(at("lib/server/wishlist.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const NOW = Date.now();
const DAY = 86_400_000;
const seller = await createUser("Seller", "seller@example.com", "hunter22", "user");
const uid = seller.id;
let n = 0;
async function listedCard(opts = {}) {
  const card = await createCard(uid, { cardName: `Card ${++n}`, setName: "Base Set", cardNumber: String(n), imageUrl: "", condition: "NM", price: opts.price ?? 10, catalogCardId: opts.catalogId ?? null });
  await db
    .prepare("UPDATE cards SET status = 'listed', listed_at = ?, quantity = ?, ebay_listing_id = ?, watcher_offer_at = ? WHERE id = ?")
    .run(opts.listedAt ?? NOW, opts.quantity ?? 1, opts.listingId ?? null, opts.offeredAt ?? null, card.id);
  return getCardForUser(card.id, uid);
}

// --- watcher offer: refusals before any call --------------------------------
const unlisted = await listedCard({});
check("offer: no live listing → refused", (await sendWatcherOffer(uid, unlisted, 10)).ok, false);
const live = await listedCard({ listingId: "L-1", quantity: 2 });
check("offer: 4% → refused", (await sendWatcherOffer(uid, live, 4)).ok, false);
check("offer: 51% → refused", (await sendWatcherOffer(uid, live, 51)).ok, false);
check("offer: not connected → refused", (await sendWatcherOffer(uid, live, 10)).message, "Connect your eBay account first.");
check("offer: nothing posted so far", posts.length, 0);

await completeEbayConnect(uid, "code");

// --- watcher offer: the send ------------------------------------------------
let r = await sendWatcherOffer(uid, live, 12.4, "  Thanks for watching!  ");
check("offer: ok", r.ok, true);
check("offer: exact Negotiation body (rounded percent, quantity, trimmed message, no counters)", posts[0], {
  allowCounterOffer: false,
  message: "Thanks for watching!",
  offeredItems: [{ listingId: "L-1", quantity: "2", discountPercentage: "12" }],
});
check("offer: watcher_offer_at stamped", Boolean((await getCardForUser(live.id, uid)).watcherOfferAt), true);

routes.sendOffer = json({ errors: [{ errorId: 1 }] }, 403);
r = await sendWatcherOffer(uid, live, 10);
check("offer: 403 → reconnect message", r, { ok: false, message: "eBay declined — reconnect your eBay account and try again." });
routes.sendOffer = json({ errors: [{ errorId: 150009, message: "All interested buyers have already received an offer" }] }, 400);
r = await sendWatcherOffer(uid, live, 10);
check("offer: other eBay error → not ok with a seller message", [r.ok, typeof r.message === "string" && r.message.length > 0], [false, true]);
routes.sendOffer = null;

// --- eligible list -------------------------------------------------------------
routes.eligible = [
  { eligibleItems: Array.from({ length: 200 }, (_, i) => ({ listingId: `E-${i}` })), next: "more" },
  { eligibleItems: [{ listingId: "E-200" }, {}] },
];
let el = await findEligibleListingIds(uid);
check("eligible: pages by 200, skips blank rows", [el.listingIds.length, el.listingIds[200]], [201, "E-200"]);
routes.eligible = [json({}, 403)];
check("eligible: 403 → no_scope", (await findEligibleListingIds(uid)).skipped, "no_scope");
routes.eligible = [json({}, 500)];
check("eligible: 500 → error", (await findEligibleListingIds(uid)).skipped, "error");

// --- auto-offer sweep ----------------------------------------------------------
posts.length = 0;
routes.eligible = [{ eligibleItems: [] }];
check("sweep: nobody opted in → nothing", await sweepAutoOffers(NOW), { sellers: 0, sent: 0, failed: 0 });

await listedCard({ listingId: "A-old", listedAt: NOW - 20 * DAY });
const young = await listedCard({ listingId: "A-young", listedAt: NOW - 3 * DAY });
const done = await listedCard({ listingId: "A-done", listedAt: NOW - 30 * DAY, offeredAt: NOW - DAY });
const notEligible = await listedCard({ listingId: "A-noteligible", listedAt: NOW - 30 * DAY });
await db.prepare("UPDATE users SET auto_offer_percent = 15, auto_offer_message = 'Slow mover' WHERE id = ?").run(uid);
routes.eligible = [{ eligibleItems: [{ listingId: "A-old" }, { listingId: "A-young" }, { listingId: "A-done" }] }];
r = await sweepAutoOffers(NOW);
check("sweep: only the 14+ day, never-offered, eligible listing", [r, posts.map((p) => p.offeredItems[0].listingId)], [{ sellers: 1, sent: 1, failed: 0 }, ["A-old"]]);
check("sweep: uses the seller's percent + message", [posts[0].offeredItems[0].discountPercentage, posts[0].message], ["15", "Slow mover"]);
check("sweep: young / already-offered / ineligible untouched", [
  Boolean((await getCardForUser(young.id, uid)).watcherOfferAt),
  (await getCardForUser(done.id, uid)).watcherOfferAt === NOW - DAY,
  Boolean((await getCardForUser(notEligible.id, uid)).watcherOfferAt),
], [false, true, false]);
posts.length = 0;
r = await sweepAutoOffers(NOW);
check("sweep: second run sends nothing (stamped)", [r.sent, posts.length], [0, 0]);

// cap: 12 stale eligible listings → 10 sends
const ids = [];
for (let i = 0; i < 12; i++) ids.push((await listedCard({ listingId: `C-${i}`, listedAt: NOW - 40 * DAY })).id);
routes.eligible = [{ eligibleItems: ids.map((_, i) => ({ listingId: `C-${i}` })) }];
posts.length = 0;
r = await sweepAutoOffers(NOW);
check("sweep: capped at 10 per seller per run", [r.sent, posts.length], [10, 10]);

routes.eligible = [json({}, 500)];
posts.length = 0;
r = await sweepAutoOffers(NOW);
check("sweep: eBay down → seller skipped, nothing sent", [r.sent, r.failed, posts.length], [0, 0, 0]);

routes.eligible = [{ eligibleItems: [{ listingId: "C-11" }, { listingId: "C-10" }] }];
routes.sendOffer = json({ errors: [{ errorId: 1 }] }, 400);
r = await sweepAutoOffers(NOW);
check("sweep: send failures counted, run continues", r.failed, 2);
routes.sendOffer = null;

// --- wishlist alerts -----------------------------------------------------------
const mails = [];
const send = async (to, hits) => { mails.push({ to, hits: hits.map((h) => [h.name, h.price, h.target]) }); };
const off = () => false;
const on = () => true;
const pcard = (id, name) => ({ id, name, englishName: name, number: "1", setName: "Base Set", imageSmall: "", imageLarge: "", game: "pokemon" });
await recordPoint("cat-cheap", "pokemon", "normal", "tcgplayer", "USD", 8);
await recordPoint("cat-holo", "pokemon", "holofoil", "tcgplayer", "USD", 40);
await recordPoint("cat-holo", "pokemon", "normal", "tcgplayer", "USD", 12);
await recordPoint("cat-pricey", "pokemon", "normal", "tcgplayer", "USD", 100);
const w1 = await addToWishlist(uid, pcard("cat-cheap", "Cheap"), "en", 8);
const w2 = await addToWishlist(uid, pcard("cat-holo", "Holo"), "en", 12);
const w3 = await addToWishlist(uid, pcard("cat-pricey", "Pricey"), "en", 100);
const w4 = await addToWishlist(uid, pcard("cat-nodata", "NoData"), "en", null);
await setWishlistAlert(w1.id, uid, 10);   // 8 ≤ 10 → hit
await setWishlistAlert(w2.id, uid, 20);   // reference is "normal" (12) ≤ 20 → hit, not the holo 40
await setWishlistAlert(w3.id, uid, 50);   // 100 > 50 → quiet
await setWishlistAlert(w4.id, uid, 5);    // no series → quiet

check("alerts: mail off → nothing checked", await sweepWishlistAlerts(NOW, { send, configured: off }), { checked: 0, sent: 0 });
let a = await sweepWishlistAlerts(NOW, { send, configured: on });
check("alerts: two hits, one mail", [a, mails.length, mails[0].to], [{ checked: 4, sent: 2 }, 1, "seller@example.com"]);
check("alerts: hits carry price + target, holo uses the normal series", mails[0].hits.sort(), [["Cheap", 8, 10], ["Holo", 12, 20]]);
const stamped = (await listWishlist(uid)).filter((w) => w.alertedAt).map((w) => w.id).sort();
check("alerts: fired rows stamped, quiet rows not", stamped, [w1.id, w2.id].sort());
mails.length = 0;
a = await sweepWishlistAlerts(NOW, { send, configured: on });
check("alerts: second pass is silent", [a.sent, mails.length], [0, 0]);
await setWishlistAlert(w1.id, uid, 9);
const failing = async () => { throw new Error("SMTP down"); };
a = await sweepWishlistAlerts(NOW, { send: failing, configured: on });
check("alerts: re-armed target checked again; failed send stamps nothing", [a.sent, Boolean((await listWishlist(uid)).find((w) => w.id === w1.id).alertedAt)], [0, false]);
a = await sweepWishlistAlerts(NOW, { send, configured: on });
check("alerts: retried next pass", a.sent, 1);

// --- reprice nudges --------------------------------------------------------------
await recordPoint("cat-up", "pokemon", "normal", "tcgplayer", "USD", 20);
await recordPoint("cat-down", "pokemon", "normal", "tcgplayer", "USD", 8);
await recordPoint("cat-flat", "pokemon", "normal", "tcgplayer", "USD", 10.5);
const up = await listedCard({ price: 10, catalogId: "cat-up", listedAt: NOW - 8 * DAY });
const down = await listedCard({ price: 10, catalogId: "cat-down", listedAt: NOW - 8 * DAY });
await listedCard({ price: 10, catalogId: "cat-flat", listedAt: NOW - 8 * DAY });
await listedCard({ price: 10, catalogId: "cat-up", listedAt: NOW - 2 * DAY });
await listedCard({ price: 10, catalogId: null, listedAt: NOW - 8 * DAY });
await listedCard({ price: 10, catalogId: "cat-none", listedAt: NOW - 8 * DAY });
const nudges = (await getRepriceNudges(uid, NOW)).sort((x, y) => x.drift - y.drift);
check("nudges: only 15%+ drift after 7 days with a series", nudges.map((x) => [x.cardId, x.market, x.listedPrice, x.drift]), [
  [down.id, 8, 10, -0.2],
  [up.id, 20, 10, 1],
]);

console.error = realError;
console.warn = realWarn;
globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
