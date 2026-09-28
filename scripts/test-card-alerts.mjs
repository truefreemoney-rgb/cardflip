/**
 * Price alerts on owned cards (Tier 2 #7). Run: npm run test:cardalerts
 *
 * Pins: a target fires when the market-based asking price reaches it, once
 * per user per pass with every hit in one mail, and stamps alerted_at; below
 * target stays quiet; updateCard with a new target re-arms, same target does
 * not; a spike (25%+ and $5+ over a week) nudges once and then sits out the
 * 30-day cooldown; a series younger than a week never spikes; sold rows are
 * skipped; a failed send stamps nothing; mail off → nothing checked; the
 * PATCH route rule (>0 lands to the cent, else clears) via updateCard.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-cardalerts-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});
const realError = console.error;
console.error = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { sweepCardAlerts, SPIKE_COOLDOWN_DAYS } = await import(at("lib/server/cardAlerts.ts"));
const { createCard, updateCard, getCardForUser } = await import(at("lib/server/cards.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { askingPriceFor } = await import(at("lib/listing.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 27, 16, 0, 0);
const TODAY = "2026-09-27";
const WEEK_AGO = "2026-09-20";
const u = await createUser("Seller", "seller@example.com", "hunter22", "user");
const other = await createUser("Other", "other@example.com", "hunter22", "user");
const card = (uid, name, catalogId) =>
  createCard(uid, { cardName: name, setName: "Base Set", cardNumber: "1", imageUrl: "", condition: "NM", price: 10, catalogCardId: catalogId });

// Prices: flat 10 → 10 (no spike), 10 → 20 (spike: +100%, +$10 asking-wise), 10 → 12 (up but under $5), new-only 50.
await recordPoint("cat-flat", "pokemon", "normal", "tcgplayer", "USD", 10, WEEK_AGO);
await recordPoint("cat-flat", "pokemon", "normal", "tcgplayer", "USD", 10, TODAY);
await recordPoint("cat-spike", "pokemon", "normal", "tcgplayer", "USD", 10, WEEK_AGO);
await recordPoint("cat-spike", "pokemon", "normal", "tcgplayer", "USD", 20, TODAY);
await recordPoint("cat-small", "pokemon", "normal", "tcgplayer", "USD", 10, WEEK_AGO);
await recordPoint("cat-small", "pokemon", "normal", "tcgplayer", "USD", 12, TODAY);
await recordPoint("cat-new", "pokemon", "normal", "tcgplayer", "USD", 50, TODAY);
const askFlat = Math.round(askingPriceFor(10, "NM") * 100) / 100;

const flat = await card(u.id, "Flat", "cat-flat");
const spike = await card(u.id, "Spike", "cat-spike");
const small = await card(u.id, "Small", "cat-small");
const fresh = await card(u.id, "Fresh", "cat-new");
const soldOne = await card(u.id, "Sold", "cat-spike");
await db.prepare("UPDATE cards SET status = 'sold', sold_at = ? WHERE id = ?").run(NOW - DAY, soldOne.id);
const theirs = await card(other.id, "Theirs", "cat-flat");

const sent = [];
const send = async (to, hits) => { sent.push({ to, hits: hits.map((h) => [h.name, h.kind, h.price, h.target]) }); };
const on = () => true;

console.log("targets");
check("mail off → nothing checked", await sweepCardAlerts(NOW, { send, configured: () => false }), { checked: 0, sent: 0, nudged: 0 });
await updateCard(flat.id, u.id, { alertPrice: askFlat + 1 });
await updateCard(theirs.id, other.id, { alertPrice: askFlat });
let r = await sweepCardAlerts(NOW, { send, configured: on });
check("Flat is under its target; Theirs hits; Spike nudges — two mails", [r.sent, r.nudged, sent.length], [1, 1, 2]);
check("the other seller's mail names their card and target", sent.find((m) => m.to === "other@example.com").hits, [["Theirs", "target", askFlat, askFlat]]);
check("the seller's mail is the spike nudge, priced today vs a week ago", sent.find((m) => m.to === "seller@example.com").hits, [["Spike", "spike", Math.round(askingPriceFor(20, "NM") * 100) / 100, askFlat]]);
check("target stamped", (await getCardForUser(theirs.id, other.id)).alertedAt != null, true);
check("small move, fresh series and sold row stay quiet", sent.flatMap((m) => m.hits.map((h) => h[0])).sort(), ["Spike", "Theirs"]);

sent.length = 0;
r = await sweepCardAlerts(NOW + 3600_000, { send, configured: on });
check("next pass: nothing repeats (stamps + spike cooldown)", [r.sent, r.nudged, sent.length], [0, 0, 0]);

console.log("re-arm");
await updateCard(theirs.id, other.id, { alertPrice: askFlat });
check("same target keeps the stamp", (await getCardForUser(theirs.id, other.id)).alertedAt != null, true);
await updateCard(theirs.id, other.id, { alertPrice: askFlat - 1 });
check("new target clears the stamp", (await getCardForUser(theirs.id, other.id)).alertedAt, null);
r = await sweepCardAlerts(NOW + 2 * 3600_000, { send, configured: on });
check("re-armed target fires again", [r.sent, sent[0]?.hits[0][0]], [1, "Theirs"]);
await updateCard(theirs.id, other.id, { alertPrice: null });
check("null clears the target", (await getCardForUser(theirs.id, other.id)).alertPrice, null);

console.log("spike cooldown");
sent.length = 0;
r = await sweepCardAlerts(NOW + (SPIKE_COOLDOWN_DAYS - 1) * DAY, { send, configured: on });
check("day 29: still cooling", r.nudged, 0);
// Keep the spike alive on the later day (the series is day-indexed).
await recordPoint("cat-spike", "pokemon", "normal", "tcgplayer", "USD", 10, "2026-10-21");
await recordPoint("cat-spike", "pokemon", "normal", "tcgplayer", "USD", 20, "2026-10-28");
r = await sweepCardAlerts(Date.UTC(2026, 9, 28, 16), { send, configured: on });
check("day 31 with a fresh spike: nudges again", r.nudged, 1);

console.log("failed send");
await updateCard(flat.id, u.id, { alertPrice: askFlat });
const boom = async () => { throw new Error("smtp down"); };
r = await sweepCardAlerts(NOW, { send: boom, configured: on });
check("failed send stamps nothing", [r.sent, (await getCardForUser(flat.id, u.id)).alertedAt], [0, null]);
check("retry lands", (await sweepCardAlerts(NOW, { send, configured: on })).sent, 1);

console.error = realError;
if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
