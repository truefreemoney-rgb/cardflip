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
const { costCoveredPrice } = await import(at("lib/fees.ts"));

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
// A signup still waiting on its email code gets no alert mail at an address
// nobody has proven (09-30); the alert waits, and fires once they are in.
const waitingUser = await createUser("Waiting", "waiting@example.com", "hunter22", "user", { emailPending: true });
const wp = await addToWishlist(waitingUser.id, pcard("cat-cheap", "Cheap"), "en", 8);
await setWishlistAlert(wp.id, waitingUser.id, 10);
mails.length = 0;
a = await sweepWishlistAlerts(NOW, { send, configured: on });
check("alerts: an unconfirmed signup is skipped", [a.sent, mails.length, Boolean((await listWishlist(waitingUser.id)).find((w) => w.id === wp.id).alertedAt)], [0, 0, false]);
await db.prepare("UPDATE users SET email_pending = 0 WHERE id = ?").run(waitingUser.id);
a = await sweepWishlistAlerts(NOW, { send, configured: on });
check("alerts: ...and fires once they are confirmed", [a.sent, mails[0]?.to], [1, "waiting@example.com"]);
// Lorcana / One Piece / Yu-Gi-Oh! have no price_series (09-30: their alerts
// could never fire) — the catalog's own price answers.
await db.prepare("INSERT INTO tcg_cards (id, game, name, subtitle, set_code, set_name, collector_number, image_url, price_usd, synced_at) VALUES (?, 'lorcana', 'Elsa', 'Spirit of Winter', '1', 'The First Chapter', '42', '', 3, 0)").run("tcg-elsa");
const w5 = await addToWishlist(uid, { ...pcard("tcg-elsa", "Elsa - Spirit of Winter"), game: "lorcana" }, "en", 3);
await setWishlistAlert(w5.id, uid, 4);
mails.length = 0;
a = await sweepWishlistAlerts(NOW, { send, configured: on });
check("alerts: Lorcana row fires off the catalog price", mails[0]?.hits, [["Elsa - Spirit of Winter", 3, 4]]);

// --- reprice nudges --------------------------------------------------------------
await recordPoint("cat-up", "pokemon", "normal", "tcgplayer", "USD", 20);
// Chris 10-08: fees + postage on every card (COSTS_ON_EVERY_CARD): every target is the market plus fees + postage, so the listings below are priced against costCoveredPrice(market).
await recordPoint("cat-down", "pokemon", "normal", "tcgplayer", "USD", 16);
await recordPoint("cat-flat", "pokemon", "normal", "tcgplayer", "USD", 10.5);
const up = await listedCard({ price: 10, catalogId: "cat-up", listedAt: NOW - 8 * DAY });
// $16 + costs is over the $20 envelope cap, so both targets below are USPS tracked; down is listed at $35 so the drop is still 15%+.
const down = await listedCard({ price: 35, catalogId: "cat-down", listedAt: NOW - 8 * DAY });
await listedCard({ price: costCoveredPrice(10.5), catalogId: "cat-flat", listedAt: NOW - 8 * DAY }); // already right: no drift
await listedCard({ price: 10, catalogId: "cat-up", listedAt: NOW - 2 * DAY });
await listedCard({ price: 10, catalogId: null, listedAt: NOW - 8 * DAY });
await listedCard({ price: 10, catalogId: "cat-none", listedAt: NOW - 8 * DAY });
const nudges = (await getRepriceNudges(uid, NOW)).sort((x, y) => x.drift - y.drift);
check("nudges: only 15%+ drift after 7 days with a series", nudges.map((x) => [x.cardId, x.market, x.target, x.listedPrice, x.drift]), [
  [down.id, 16, costCoveredPrice(16, "tracked"), 35, (costCoveredPrice(16, "tracked") - 35) / 35],
  [up.id, 20, costCoveredPrice(20, "tracked"), 10, (costCoveredPrice(20, "tracked") - 10) / 10],
]);
// 09-30: the nudge offers the scanner's price, not raw market. Under $5 that
// is value + fees + postage — a $1.30 card listed at $3.13 is already right
// (raw market nudged it to $1.30 = 8¢ net), and a $0.25 Spidops listed at
// $2.50 (the $1.79 minimum is only 7% off the new $1.92 target, under the 15% bar) is nudged down to $1.92, not to $0.25 (refused).
await recordPoint("cat-cheap", "pokemon", "normal", "tcgplayer", "USD", 1.3);
await recordPoint("cat-spidops", "pokemon", "normal", "tcgplayer", "USD", 0.25);
const cheapRight = await listedCard({ price: costCoveredPrice(1.3), catalogId: "cat-cheap", listedAt: NOW - 8 * DAY });
const oldFloor = await listedCard({ price: 2.5, catalogId: "cat-spidops", listedAt: NOW - 8 * DAY });
const cheapNudges = (await getRepriceNudges(uid, NOW)).filter((x) => [cheapRight.id, oldFloor.id].includes(x.cardId));
check("nudges: cheap cards target value + costs, not raw market", cheapNudges.map((x) => [x.cardId, x.market, x.target]), [
  [oldFloor.id, 0.25, 1.92],
]);

// --- the price guard (priceTrustSite): a flagged market never nudges, dips or becomes a baseline ---------
{
  const { liquidPrices, junkPrices, recordSeries } = await import("./lib/liquid-series.mjs");
  const { addDays, todayUtc } = await import(at("lib/priceSeries.ts"));
  const today = todayUtc();
  await recordSeries(recordPoint, addDays, today, "g-junk", "pokemon", "holofoil", junkPrices(500)); // a 5x spike that never came back (hidden)
  await recordSeries(recordPoint, addDays, today, "g-fine", "pokemon", "holofoil", liquidPrices(300));
  const junkListed = await listedCard({ price: 200, catalogId: "g-junk", listedAt: NOW - 8 * DAY });
  const fineListed = await listedCard({ price: 150, catalogId: "g-fine", listedAt: NOW - 8 * DAY });
  const gn = await getRepriceNudges(uid, NOW);
  check("guard: a listing whose market is flagged gets no reprice nudge", gn.some((x) => x.cardId === junkListed.id), false);
  check("guard: the normal $300 market still nudges the $150 listing", gn.find((x) => x.cardId === fineListed.id)?.target, costCoveredPrice(300, "tracked"));

  const wJunk = await addToWishlist(uid, pcard("g-junk", "GuardJunk"), "en", 500);
  const wFine = await addToWishlist(uid, pcard("g-fine", "GuardFine"), "en", 300);
  const wNull = await addToWishlist(uid, pcard("g-junk", "GuardJunkNoPrice"), "en", null);
  check("guard: a flagged price is not saved as the wishlist baseline (sent or looked up)", [wJunk.price, wNull.price], [null, null]);
  check("guard: a normal price is saved as before", wFine.price, 300);
  await setWishlistAlert(wJunk.id, uid, 600);
  await setWishlistAlert(wFine.id, uid, 400);
  mails.length = 0;
  await sweepWishlistAlerts(NOW, { send, configured: on });
  const dips = mails.flatMap((m) => m.hits.map((h) => h[0]));
  check("guard: no dip mail from a flagged price; the normal one still mails", [dips.includes("GuardJunk"), dips.includes("GuardFine")], [false, true]);
  const rows = await listWishlist(uid);
  check("guard: listing the wishlist does not backfill a flagged baseline either", rows.find((w) => w.id === wNull.id).price, null);
}

console.error = realError;
console.warn = realWarn;
globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
