/**
 * Weekly collection digest (Tier 2 #8). Run: npm run test:digest
 *
 * Pins: value now vs a week ago from price_series through the condition
 * math; gainers/losers ranked by dollar change, a series younger than a week
 * counts as flat; sold this week and listed 30+ days lists; only Sunday ET
 * unless forced; one mail per user per week (digest_sent_week), a failed
 * send stamps nothing; users without cards are not queried; the unsubscribe
 * token flips digest_off and the sweep skips them; mail off → skipped.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-digest-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});
const realError = console.error;
console.error = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { buildDigest, sweepWeeklyDigest, unsubscribeDigest, isEasternSunday, easternDay } = await import(at("lib/server/digest.ts"));
const { createCard } = await import(at("lib/server/cards.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const DAY = 86_400_000;
const SUNDAY = Date.UTC(2026, 8, 27, 16, 0, 0); // Sunday 12:00 ET
const MONDAY = SUNDAY + DAY;
check("Sunday ET detected", [isEasternSunday(SUNDAY), isEasternSunday(MONDAY), easternDay(SUNDAY)], [true, false, "2026-09-27"]);

const u = await createUser("Seller", "seller@example.com", "hunter22", "user");
const empty = await createUser("Nobody", "nobody@example.com", "hunter22", "user");
const card = async (name, opts) => {
  const c = await createCard(u.id, { cardName: name, setName: "Base Set", cardNumber: "1", imageUrl: "", condition: "NM", price: opts.price ?? 10, catalogCardId: opts.catalogId ?? null });
  if (opts.sql) await db.prepare(opts.sql).run(...opts.args, c.id);
  return c;
};
await recordPoint("cat-up", "pokemon", "normal", "tcgplayer", "USD", 10, "2026-09-20");
await recordPoint("cat-up", "pokemon", "normal", "tcgplayer", "USD", 20, "2026-09-27");
await recordPoint("cat-down", "pokemon", "normal", "tcgplayer", "USD", 20, "2026-09-20");
await recordPoint("cat-down", "pokemon", "normal", "tcgplayer", "USD", 8, "2026-09-27");
await recordPoint("cat-new", "pokemon", "normal", "tcgplayer", "USD", 15, "2026-09-27");
await card("Up", { catalogId: "cat-up" });
await card("Down", { catalogId: "cat-down" });
await card("New", { catalogId: "cat-new" });
await card("Hand", { price: 5 });
await card("Sold", { catalogId: "cat-up", sql: "UPDATE cards SET status = 'sold', sold_price = 30, sold_at = ? WHERE id = ?", args: [SUNDAY - 2 * DAY] });
await card("Old sale", { catalogId: "cat-up", sql: "UPDATE cards SET status = 'sold', sold_price = 30, sold_at = ? WHERE id = ?", args: [SUNDAY - 20 * DAY] });
await card("Stale", { catalogId: "cat-new", price: 12, sql: "UPDATE cards SET status = 'listed', listed_at = ? WHERE id = ?", args: [SUNDAY - 40 * DAY] });
await card("Fresh listing", { catalogId: "cat-new", sql: "UPDATE cards SET status = 'listed', listed_at = ? WHERE id = ?", args: [SUNDAY - 3 * DAY] });

console.log("digest");
const d = await buildDigest(u.id, SUNDAY);
check("held count excludes sold", d.held, 6);
check("value moved by the net change (Up +10, Down -12, everything else flat)", d.valueNow < d.valueBefore, true);
check("gainers = Up only", d.gainers.map((c) => [c.name, c.change > 0, c.pct]), [["Up", true, 100]]);
// The digest compares ASKING prices (askingPriceFor), so the $8 end carries the
// $5–$10 fees + postage taper (09-30): $20 → $8.98 = -55.1%, not the raw -60%.
const { askingPriceFor } = await import(at("lib/listing.ts"));
const downPct = Math.round(((askingPriceFor(8, "NM") - askingPriceFor(20, "NM")) / askingPriceFor(20, "NM")) * 1000) / 10;
check("losers = Down only, % on the asking prices", d.losers.map((c) => [c.name, c.change < 0, c.pct]), [["Down", true, downPct]]);
check("the Down card's % is the tapered one (-55.1)", downPct, -55.1);
check("a series younger than a week is flat, not a gainer", d.gainers.concat(d.losers).some((c) => c.name === "New"), false);
check("sold this week only", d.sold.map((c) => [c.name, c.price]), [["Sold", 30]]);
check("listed 30+ days only", d.stale.map((c) => [c.name, c.days, c.price]), [["Stale", 40, 12]]);
check("no cards → null", await buildDigest(empty.id, SUNDAY), null);

console.log("the price guard (priceTrustSite)");
{
  const { flatPrices, liquidPrices, recordSeries } = await import("./lib/liquid-series.mjs");
  const { addDays } = await import(at("lib/priceSeries.ts"));
  const g = await createUser("Guard", "guard@example.com", "hunter22", "user");
  await recordSeries(recordPoint, addDays, "2026-09-27", "g-junk", "pokemon", "holofoil", flatPrices(500, 87)); // stuck round $500
  await recordSeries(recordPoint, addDays, "2026-09-27", "g-fine", "pokemon", "holofoil", [...liquidPrices(200, 50), 260]); // a real +30% week
  // The week-ago side is a junk plateau (flat $100 for 40 days) that then moved: no honest "before".
  await recordSeries(recordPoint, addDays, "2026-09-27", "g-old", "pokemon", "holofoil", [...flatPrices(100, 41), 110, 120, 130, 140, 145, 148, 150]);
  const mk = (name, catalogId) => createCard(g.id, { cardName: name, setName: "Base Set", cardNumber: "1", imageUrl: "", condition: "NM", price: 10, catalogCardId: catalogId });
  await mk("Junk", "g-junk");
  const typed = await mk("Typed", "g-junk");
  await db.prepare("UPDATE cards SET price_locked = 1 WHERE id = ?").run(typed.id);
  await mk("Fine", "g-fine");
  await mk("Old", "g-old");
  const gd = await buildDigest(g.id, SUNDAY);
  check("the flagged card is left out of the value and counted in leftOut", [gd.leftOut, gd.gainers.some((c) => c.name === "Junk"), gd.losers.some((c) => c.name === "Junk")], [1, false, false]);
  const { askingPriceFor: ask } = await import(at("lib/listing.ts"));
  check("the seller-typed price of the same junk market counts at the seller's price ($10), the junk market at nothing", [gd.held, Math.round(gd.valueNow * 100) / 100], [4, Math.round((ask(260, "NM") + ask(150, "NM") + 10) * 100) / 100]);
  check("the normal +30% mover is still a gainer", gd.gainers.map((c) => c.name).includes("Fine"), true);
  check("a junk week-ago price makes no honest mover: 'Old' counts as unchanged", gd.gainers.concat(gd.losers).some((c) => c.name === "Old"), false);
  check("a seller with nothing flagged has no leftOut key", "leftOut" in (await buildDigest(u.id, SUNDAY)), false);
  await db.prepare("DELETE FROM cards WHERE user_id = ?").run(g.id);
}

console.log("sweep");
const sent = [];
const send = async (to, digest, unsub) => { sent.push({ to, held: digest.held, unsub }); };
const on = () => true;
check("mail off → skipped", await sweepWeeklyDigest(SUNDAY, {}, { send, configured: () => false }), { skipped: "mail not configured", users: 0, sent: 0 });
check("Monday → skipped", await sweepWeeklyDigest(MONDAY, {}, { send, configured: on }), { skipped: "not Sunday", users: 0, sent: 0 });
check("Sunday → one mail, only the user with cards", [await sweepWeeklyDigest(SUNDAY, {}, { send, configured: on }), sent.length, sent[0]?.to], [{ users: 1, sent: 1 }, 1, "seller@example.com"]);
check("unsubscribe token minted and carried", [sent[0].unsub.userId === u.id, typeof sent[0].unsub.token === "string" && sent[0].unsub.token.length > 20], [true, true]);
check("same Sunday again → nothing", await sweepWeeklyDigest(SUNDAY + 3600_000, {}, { send, configured: on }), { users: 1, sent: 0 });
check("force re-sends", (await sweepWeeklyDigest(SUNDAY, { force: true }, { send, configured: on })).sent, 1);
const boom = async () => { throw new Error("smtp down"); };
await db.prepare("UPDATE users SET digest_sent_week = NULL WHERE id = ?").run(u.id);
check("failed send stamps nothing", [(await sweepWeeklyDigest(SUNDAY, {}, { send: boom, configured: on })).sent, (await db.prepare("SELECT digest_sent_week FROM users WHERE id = ?").get(u.id)).digest_sent_week], [0, null]);
check("next Sunday sends again", (await sweepWeeklyDigest(SUNDAY + 7 * DAY, {}, { send, configured: on })).sent, 1);

console.log("unsubscribe");
check("wrong token → false", await unsubscribeDigest(u.id, "nope"), false);
check("right token → true", await unsubscribeDigest(u.id, sent[0].unsub.token), true);
check("unsubscribed user is left out even when forced", await sweepWeeklyDigest(SUNDAY, { force: true }, { send, configured: on }), { users: 0, sent: 0 });

console.error = realError;
if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
