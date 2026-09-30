/**
 * The site price guard on the API routes and the saved-lookup history.
 * Run: npm run test:sitetrustroutes
 *
 * Pins, on a throwaway db: /api/search-card marks a flagged TCGplayer row
 * (`untrusted`) on a Magic card by id and leaves the rest of the payload as
 * before, /api/set-cards does the same for a Pokemon set (one price entry per
 * card) and a Magic set, /api/price-history carries a verdict per series,
 * price checks are annotated at read and never store a flagged number as the
 * lookup's price, and none of it is written into the stored payloads.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-sitetrustroutes-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { NextRequest } = await import("next/server");
const searchCard = await import(at("app/api/search-card/route.ts"));
const setCards = await import(at("app/api/set-cards/route.ts"));
const priceHistory = await import(at("app/api/price-history/route.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { logPriceCheck, listPriceChecks } = await import(at("lib/server/priceChecks.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { addDays, todayUtc } = await import(at("lib/priceSeries.ts"));
const { clearTrustMemo } = await import(at("lib/server/priceTrustSite.ts"));
const { liquidPrices, flatPrices, recordSeries } = await import("./lib/liquid-series.mjs");
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

let ip = 0;
const get = async (handler, url) => {
  const res = await handler.GET(new NextRequest(`http://test${url}`, { headers: { "x-forwarded-for": `10.0.0.${++ip}` } }));
  return { status: res.status, body: await res.json() };
};
const TODAY = todayUtc();

// --- catalog ------------------------------------------------------------------
await db.prepare(`INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, set_release_date, image_url, price_usd, price_usd_foil, price_eur, price_eur_foil, synced_at)
                  VALUES ('mtg-junk', 'Junk Bolt', 'tst', 'Test Set', '1', '2020-01-01', 'https://img/x/normal/front/a.jpg', 150, 150, 120, 20, 0)`).run();
await db.prepare(`INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, set_release_date, image_url, price_usd, price_eur, synced_at)
                  VALUES ('mtg-fine', 'Fine Bolt', 'tst', 'Test Set', '2', '2020-01-01', 'https://img/x/normal/front/b.jpg', 150, 120, 0)`).run();
await recordSeries(recordPoint, addDays, TODAY, "mtg-junk", "mtg", "nonfoil", liquidPrices(150));
await recordSeries(recordPoint, addDays, TODAY, "mtg-junk", "mtg", "foil", liquidPrices(150));
await recordSeries(recordPoint, addDays, TODAY, "mtg-fine", "mtg", "nonfoil", liquidPrices(150));
const seed = db.prepare(`INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url, synced_at) VALUES (?, ?, 'tst', 'Test Pokemon Set', ?, '2019-05-01', '', 0)`);
await seed.run("pk-junk", "Deoxys", "1");
await seed.run("pk-fine", "Umbreon", "2");
await recordSeries(recordPoint, addDays, TODAY, "pk-junk", "pokemon", "holofoil", flatPrices(500, 87));
await recordSeries(recordPoint, addDays, TODAY, "pk-fine", "pokemon", "holofoil", liquidPrices(300));
clearTrustMemo();

console.log("/api/search-card (Magic by id)");
{
  const junk = await get(searchCard, "/api/search-card?id=mtg-junk&game=mtg");
  const prices = junk.body.cards[0].prices;
  const row = (variant, source = "tcgplayer") => prices.find((p) => p.variant === variant && p.source === source);
  check("the foil TCGplayer row is flagged (its foil Cardmarket price is EUR 20)", row("foil").untrusted, { hard: true, reason: "cardmarket 6.8x" });
  check("the nonfoil row of the same card is not", row("nonfoil").untrusted === undefined);
  check("the Cardmarket EUR rows carry no flag", [row("foil", "cardmarket").untrusted, row("nonfoil", "cardmarket").untrusted], [undefined, undefined]);
  check("the market number is still in the payload (the page decides not to present it)", row("foil").market, 150);
  const fine = await get(searchCard, "/api/search-card?id=mtg-fine&game=mtg");
  check("a normal card comes back with no flag anywhere", fine.body.cards[0].prices.some((p) => p.untrusted), false);
}

console.log("/api/set-cards");
{
  const pk = await get(setCards, "/api/set-cards?set=Test%20Pokemon%20Set");
  const by = Object.fromEntries(pk.body.cards.map((c) => [c.id, c]));
  check("Pokemon set: the stuck $500 card carries the flag on its one price entry", [by["pk-junk"].prices.length, by["pk-junk"].prices[0].untrusted], [1, { hard: true, reason: "flat 87d" }]);
  check("... the normal card is priced as before", [by["pk-fine"].prices[0].market, by["pk-fine"].prices[0].untrusted], [300, undefined]);
  const mtg = await get(setCards, "/api/set-cards?game=mtg&set=tst");
  const foil = mtg.body.cards.find((c) => c.id === "mtg-junk").prices.find((p) => p.variant === "foil" && p.source === "tcgplayer");
  check("Magic set: same flag on the foil row", foil.untrusted?.hard, true);
}

console.log("/api/price-history");
{
  const h = await get(priceHistory, "/api/price-history?cardId=pk-junk");
  check("the stuck series carries the verdict, points and stats stay", [h.body.series[0].untrusted, h.body.series[0].points.length > 50, h.body.series[0].stats.current], [{ hard: true, reason: "flat 87d" }, true, 500]);
  const f = await get(priceHistory, "/api/price-history?cardId=pk-fine");
  check("a normal series has no verdict", f.body.series[0].untrusted === undefined);
  const m = await get(priceHistory, "/api/price-history?cardId=mtg-junk");
  check("Magic: only the foil line is flagged", m.body.series.map((s) => [s.variant, !!s.untrusted]).sort(), [["foil", true], ["nonfoil", false]]);
}

console.log("price checks (Recent lookups)");
{
  const u = await createUser("Checker", "check@example.com", "hunter22", "user");
  const card = (id, name, market) => ({ id, name, setName: "Test Pokemon Set", number: "1", setSeries: "", rarity: null, imageSmall: "", imageLarge: "", englishName: null, game: "pokemon",
    prices: [{ source: "tcgplayer", variant: "holofoil", label: "Holofoil", currency: "USD", market, low: null, high: null, untrusted: { hard: true, reason: "client-supplied, must be dropped" } }] });
  const junkEntry = await logPriceCheck(u.id, card("pk-junk", "Deoxys", 500), "en");
  const fineEntry = await logPriceCheck(u.id, card("pk-fine", "Umbreon", 300), "en");
  check("a flagged market is not stored as the lookup's price; a normal one is", [junkEntry.representativePrice, fineEntry.representativePrice], [null, 300]);
  const stored = await db.prepare("SELECT prices_json FROM price_checks WHERE card_id = 'pk-junk'").get();
  check("prices_json never carries a flag (annotated at read only)", stored.prices_json.includes("untrusted"), false);
  // A lookup saved before the guard: the junk number is the representative price.
  await db.prepare("UPDATE price_checks SET representative_price = 500 WHERE card_id = 'pk-junk'").run();
  const list = await listPriceChecks(u.id);
  const j = list.find((e) => e.cardId === "pk-junk");
  const f = list.find((e) => e.cardId === "pk-fine");
  check("history read: the saved junk row is flagged, and so is its price row", [j.flag, j.prices[0].untrusted], [{ hard: true, reason: "flat 87d" }, { hard: true, reason: "flat 87d" }]);
  check("history read: a normal row is untouched", [f.flag, f.prices[0].untrusted, f.representativePrice], [undefined, undefined, 300]);
  // A number saved at an older, different price is history, not today's junk.
  await db.prepare("UPDATE price_checks SET prices_json = ? WHERE card_id = 'pk-junk'").run(JSON.stringify([{ source: "tcgplayer", variant: "holofoil", label: "Holofoil", currency: "USD", market: 240, low: null, high: null }]));
  check("a stored price that is no longer the current one is not flagged", (await listPriceChecks(u.id)).find((e) => e.cardId === "pk-junk").prices[0].untrusted === undefined);
}

console.log(failures === 0 ? "\nAll site price-guard route checks passed." : `\n${failures} site price-guard route check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
