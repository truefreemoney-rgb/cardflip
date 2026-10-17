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
const { liquidPrices, flatPrices, junkPrices, recordSeries, hideByAdmin } = await import("./lib/liquid-series.mjs");
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
                  VALUES ('mtg-junk', 'Junk Bolt', 'tst', 'Test Set', '1', '2020-01-01', 'https://img/x/normal/front/a.jpg', 150, 150, 120, 12, 0)`).run();
await db.prepare(`INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, set_release_date, image_url, price_usd, price_eur, synced_at)
                  VALUES ('mtg-fine', 'Fine Bolt', 'tst', 'Test Set', '2', '2020-01-01', 'https://img/x/normal/front/b.jpg', 150, 120, 0)`).run();
await recordSeries(recordPoint, addDays, TODAY, "mtg-junk", "mtg", "nonfoil", liquidPrices(150));
await recordSeries(recordPoint, addDays, TODAY, "mtg-junk", "mtg", "foil", liquidPrices(150));
await recordSeries(recordPoint, addDays, TODAY, "mtg-fine", "mtg", "nonfoil", liquidPrices(150));
// 10-17: a flag WITH a fallback prices the row (market = fallback, checked/checkedWas); one WITHOUT (an admin's "hide", no spike level) still carries untrusted.
await db.prepare(`INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, set_release_date, image_url, price_usd, price_eur, synced_at)
                  VALUES ('mtg-hid', 'Hidden Bolt', 'tst', 'Test Set', '3', '2020-01-01', 'https://img/x/normal/front/c.jpg', 150, 120, 0)`).run();
await recordSeries(recordPoint, addDays, TODAY, "mtg-hid", "mtg", "nonfoil", liquidPrices(150));
await hideByAdmin(db, addDays, TODAY, "mtg-hid", "mtg", "nonfoil", 150);
const seed = db.prepare(`INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url, synced_at) VALUES (?, ?, 'tst', 'Test Pokemon Set', ?, '2019-05-01', '', 0)`);
await seed.run("pk-junk", "Deoxys", "1");
await seed.run("pk-fine", "Umbreon", "2");
await seed.run("pk-stale", "Deoxys stale", "3");
await seed.run("pk-hid", "Deoxys hidden", "5");
await recordSeries(recordPoint, addDays, TODAY, "pk-junk", "pokemon", "holofoil", junkPrices(500));
await recordSeries(recordPoint, addDays, TODAY, "pk-hid", "pokemon", "holofoil", junkPrices(500));
await hideByAdmin(db, addDays, TODAY, "pk-hid", "pokemon", "holofoil", 500);
// Stale (10-02): a stuck $500 for 87 days is shown with a note, never hidden.
await recordSeries(recordPoint, addDays, TODAY, "pk-stale", "pokemon", "holofoil", flatPrices(500, 87));
await recordSeries(recordPoint, addDays, TODAY, "pk-fine", "pokemon", "holofoil", liquidPrices(300));
clearTrustMemo();

console.log("cached cards with no picture (10-02: card_cache rows older than a picture fill)");
{
  const { fillMissingPictures } = await import(at("lib/server/cardPictures.ts"));
  await seed.run("pk-pic", "Pictured", "4");
  await db.prepare("UPDATE en_cards SET image_url = 'https://img/pk-pic/low.webp' WHERE id = 'pk-pic'").run();
  const stub = (id, game) => ({ id, name: id, englishName: null, setName: "Test", number: "1", imageSmall: "", imageLarge: "", prices: [], ...(game ? { game } : {}) });
  const out = await fillMissingPictures([stub("pk-pic"), stub("pk-fine"), stub("mtg-fine", "mtg"), { ...stub("pk-junk"), imageSmall: "https://img/kept.webp", imageLarge: "https://img/kept-high.webp" }]);
  check("a Pokémon card with no picture gets the catalog's (small + high)", [out[0].imageSmall, out[0].imageLarge], ["https://img/pk-pic/low.webp", "https://img/pk-pic/high.webp"]);
  check("a card the catalog has no picture for stays empty", out[1].imageSmall, "");
  check("a Magic card asks the Magic mirror", out[2].imageSmall, "https://img/x/normal/front/b.jpg");
  check("a card with a picture is left alone", [out[3].imageSmall, out[3].imageLarge], ["https://img/kept.webp", "https://img/kept-high.webp"]);
}

console.log("/api/search-card (Magic by id)");
{
  const junk = await get(searchCard, "/api/search-card?id=mtg-junk&game=mtg");
  const prices = junk.body.cards[0].prices;
  const row = (variant, source = "tcgplayer") => prices.find((p) => p.variant === variant && p.source === source);
  check("the foil TCGplayer row (its foil Cardmarket price is EUR 12) is flagged WITH a fallback: priced at it, flag in checked, no untrusted", [row("foil").untrusted, row("foil").checked, row("foil").market, row("foil").checkedWas], [undefined, { hard: true, reason: "cardmarket 11.4x", fallback: 13.2, fallbackFrom: "cardmarket" }, 13.2, 150]);
  check("the nonfoil row of the same card is not", row("nonfoil").untrusted === undefined);
  check("the Cardmarket EUR rows carry no flag", [row("foil", "cardmarket").untrusted, row("nonfoil", "cardmarket").untrusted], [undefined, undefined]);
  const hid = (await get(searchCard, "/api/search-card?id=mtg-hid&game=mtg")).body.cards[0].prices.find((p) => p.variant === "nonfoil" && p.source === "tcgplayer");
  check("a flag with NO fallback (an admin's hide) is untrusted, the market number still in the payload (the page decides not to present it)", [hid.untrusted?.hard, hid.untrusted?.fallback, hid.checked, hid.market], [true, undefined, undefined, 150]);
  const fine = await get(searchCard, "/api/search-card?id=mtg-fine&game=mtg");
  check("a normal card comes back with no flag anywhere", fine.body.cards[0].prices.some((p) => p.untrusted), false);
}

console.log("/api/set-cards");
{
  const pk = await get(setCards, "/api/set-cards?set=Test%20Pokemon%20Set");
  const by = Object.fromEntries(pk.body.cards.map((c) => [c.id, c]));
  check("Pokemon set: a flag with NO fallback (hidden by an admin) carries it on the card's one price entry", [by["pk-hid"].prices.length, by["pk-hid"].prices[0].untrusted?.hard, by["pk-hid"].prices[0].untrusted?.reason.startsWith("checked against ebay sold"), by["pk-hid"].prices[0].checked], [1, true, true, undefined]);
  const fbRow = by["pk-junk"].prices[0];
  check("... the junk $500 spike has a fallback: its one price entry is priced at the level before the jump, flag in checked (the $500 in checkedWas), no untrusted", [by["pk-junk"].prices.length, fbRow.untrusted, fbRow.checked?.reason.startsWith("spike"), fbRow.checkedWas, fbRow.market > 90 && fbRow.market < 120, fbRow.market === fbRow.checked?.fallback], [1, undefined, true, 500, true, true]);
  check("... the stale $500 card carries the stale note, not a flag", [by["pk-stale"]?.prices[0].market, by["pk-stale"]?.prices[0].untrusted, by["pk-stale"]?.prices[0].stale], [500, undefined, { days: 87 }]);
  check("... the normal card is priced as before", [by["pk-fine"].prices[0].market, by["pk-fine"].prices[0].untrusted], [300, undefined]);
  const mtg = await get(setCards, "/api/set-cards?game=mtg&set=tst");
  const foil = mtg.body.cards.find((c) => c.id === "mtg-junk").prices.find((p) => p.variant === "foil" && p.source === "tcgplayer");
  check("Magic set: the foil row has a fallback (Cardmarket): priced at it, flag in checked", [foil.untrusted, foil.market, foil.checked?.hard], [undefined, 13.2, true]);
  const hidRow = mtg.body.cards.find((c) => c.id === "mtg-hid").prices.find((p) => p.variant === "nonfoil" && p.source === "tcgplayer");
  check("... and a hidden one with none keeps untrusted", [hidRow.untrusted?.hard, hidRow.checked], [true, undefined]);
}

console.log("/api/price-history");
{
  const h = await get(priceHistory, "/api/price-history?cardId=pk-junk");
  check("the junk series carries the verdict, points and stats stay", [h.body.series[0].untrusted?.hard, h.body.series[0].points.length > 50, h.body.series[0].stats.current], [true, true, 500]);
  const st = await get(priceHistory, "/api/price-history?cardId=pk-stale");
  check("the stale series carries the note, not a verdict", [st.body.series[0].untrusted, st.body.series[0].stale], [undefined, { days: 87 }]);
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
  const hidEntry = await logPriceCheck(u.id, card("pk-hid", "Deoxys hidden", 500), "en");
  const fineEntry = await logPriceCheck(u.id, card("pk-fine", "Umbreon", 300), "en");
  check("a flagged market with NO fallback is not stored as the lookup's price; a normal one is", [hidEntry.representativePrice, fineEntry.representativePrice], [null, 300]);
  check("... a flagged market WITH a fallback is stored as the fallback (the level before the jump), never the $500", [junkEntry.representativePrice > 90 && junkEntry.representativePrice < 120, junkEntry.representativePrice !== 500], [true, true]);
  const JUNK_FB = junkEntry.representativePrice;
  const stored = await db.prepare("SELECT prices_json FROM price_checks WHERE card_id = 'pk-hid'").get();
  check("prices_json never carries a flag (annotated at read only)", [stored.prices_json.includes("untrusted"), stored.prices_json.includes("checked")], [false, false]);
  // A lookup saved before the guard: the junk number is the representative price.
  await db.prepare("UPDATE price_checks SET representative_price = 500 WHERE card_id IN ('pk-hid', 'pk-junk')").run();
  const list = await listPriceChecks(u.id);
  const j = list.find((e) => e.cardId === "pk-hid");
  const jf = list.find((e) => e.cardId === "pk-junk");
  const f = list.find((e) => e.cardId === "pk-fine");
  check("history read: the saved junk row with NO fallback is flagged, and so is its price row", [j.flag?.hard, j.prices[0].untrusted?.hard], [true, true]);
  check("history read: the saved junk row WITH a fallback is priced from it (no flag): the row, the saved price and today's price all read the fallback", [jf.flag, jf.prices[0].untrusted, jf.prices[0].checked?.hard, jf.prices[0].market === JUNK_FB, jf.prices[0].checkedWas, jf.representativePrice === JUNK_FB, jf.currentPrice === JUNK_FB], [undefined, undefined, true, true, 500, true, true]);
  check("history read: a normal row is untouched", [f.flag, f.prices[0].untrusted, f.representativePrice], [undefined, undefined, 300]);
  // A number saved at an older, different price is history, not today's junk.
  await db.prepare("UPDATE price_checks SET representative_price = 240, prices_json = ? WHERE card_id IN ('pk-hid', 'pk-junk')").run(JSON.stringify([{ source: "tcgplayer", variant: "holofoil", label: "Holofoil", currency: "USD", market: 240, low: null, high: null }]));
  {
    const later = await listPriceChecks(u.id);
    check("a stored price that is no longer the current one is not flagged, nor repriced (hidden one and one with a fallback alike)", ["pk-hid", "pk-junk"].map((id) => { const p = later.find((e) => e.cardId === id).prices[0]; return [p.untrusted, p.checked, p.market]; }), [[undefined, undefined, 240], [undefined, undefined, 240]]);
  }

  // A lookup saved AFTER the guard: the live number the search showed (900 on a $300 card) is not the series' last
  // point, so it is judged as today's point, stored as no price, and the history still says why.
  const u2 = await createUser("Checker Two", "check2@example.com", "hunter22", "user");
  const spike = await logPriceCheck(u2.id, card("pk-hid", "Deoxys hidden", 500), "en");
  check("a flagged price with NO fallback is not stored", spike.representativePrice, null);
  const spiked = (await listPriceChecks(u2.id)).find((e) => e.cardId === "pk-hid");
  check("history read: a lookup saved unpriced because it was flagged shows the note (flag set), not a dash", [spiked.representativePrice, spiked.flag?.hard, spiked.prices[0].untrusted?.hard], [null, true, true]);
  const stored2 = await db.prepare("SELECT prices_json FROM price_checks WHERE user_id = ? AND card_id = 'pk-hid'").get(u2.id);
  check("... and still no flag inside prices_json", stored2.prices_json.includes("untrusted"), false);
  // 10-17: the same live 900 on a $300 card HAS a fallback (the level before the jump): stored and shown as that.
  const spikeFb = await logPriceCheck(u2.id, card("pk-fine", "Umbreon", 900), "en");
  check("a live price that is not the series' last point is judged as today's; with a fallback the fallback is stored", [spikeFb.representativePrice > 250 && spikeFb.representativePrice < 350, spikeFb.representativePrice !== 900], [true, true]);
  const spikedFb = (await listPriceChecks(u2.id)).find((e) => e.cardId === "pk-fine");
  check("history read: no flag; the row reads the fallback, the saved 900 rides along as checkedWas", [spikedFb.flag, spikedFb.prices[0].untrusted, spikedFb.prices[0].market === spikeFb.representativePrice, spikedFb.prices[0].checkedWas], [undefined, undefined, true, 900]);
  const bare = await logPriceCheck(u2.id, { ...card("pk-none", "Bare", 1), prices: [] }, "en");
  check("a lookup with no price at all has no flag either", [bare.representativePrice, (await listPriceChecks(u2.id)).find((e) => e.cardId === "pk-none").flag], [null, undefined]);
}

console.log(failures === 0 ? "\nAll site price-guard route checks passed." : `\n${failures} site price-guard route check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
