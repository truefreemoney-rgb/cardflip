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
const { liquidPrices, flatPrices, junkPrices, recordSeries } = await import("./lib/liquid-series.mjs");
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
const seed = db.prepare(`INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url, synced_at) VALUES (?, ?, 'tst', 'Test Pokemon Set', ?, '2019-05-01', '', 0)`);
await seed.run("pk-junk", "Deoxys", "1");
await seed.run("pk-fine", "Umbreon", "2");
await seed.run("pk-stale", "Deoxys stale", "3");
await recordSeries(recordPoint, addDays, TODAY, "pk-junk", "pokemon", "holofoil", junkPrices(500));
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
  check("the foil TCGplayer row is flagged (its foil Cardmarket price is EUR 12)", row("foil").untrusted, { hard: true, reason: "cardmarket 11.4x", fallback: 13.2, fallbackFrom: "cardmarket" });
  check("the nonfoil row of the same card is not", row("nonfoil").untrusted === undefined);
  check("the Cardmarket EUR rows carry no flag", [row("foil", "cardmarket").untrusted, row("nonfoil", "cardmarket").untrusted], [undefined, undefined]);
  check("the market number is still in the payload (the page decides not to present it)", row("foil").market, 150);
  const fine = await get(searchCard, "/api/search-card?id=mtg-fine&game=mtg");
  check("a normal card comes back with no flag anywhere", fine.body.cards[0].prices.some((p) => p.untrusted), false);
}

console.log("/api/search-card (a name with no letter or digit never waits on pokemontcg.io, 10-21)");
{
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("pokemontcg.io")) { asked.push(String(url)); return Response.json({ data: [] }); }
    return realFetch(url, init);
  };
  try {
    const pct = await get(searchCard, "/api/search-card?name=%25&game=pokemon");
    const dash = await get(searchCard, "/api/search-card?name=-%20-&game=pokemon");
    check('"%" and "- -": no cards, no upstream call', [pct.status, pct.body.cards, dash.body.cards, asked.length], [200, [], [], 0]);
    await get(searchCard, "/api/search-card?name=Zzzmon&game=pokemon");
    check("a real name the mirror lacks still asks pokemontcg.io", asked.length > 0);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("/api/search-card quotes the card page's TCGplayer line over pokemontcg.io's (10-21, Kyogre ex4-3: $542.60 upstream, $290 line)");
{
  await seed.run("pk-up", "Kyogrex", "7");
  await recordSeries(recordPoint, addDays, TODAY, "pk-up", "pokemon", "holofoil", liquidPrices(290));
  await seed.run("pk-up-old", "Kyogrex", "8");
  await recordSeries(recordPoint, addDays, addDays(TODAY, -5), "pk-up-old", "pokemon", "holofoil", liquidPrices(110));
  clearTrustMemo();
  const realFetch = globalThis.fetch;
  const upstream = (number, prices) => ({ id: `up-${number}`, name: "Kyogrex", number, set: { name: "Test Pokemon Set", releaseDate: "2019/05/01" }, tcgplayer: { prices } });
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("pokemontcg.io")) {
      return Response.json({ data: [upstream("7", { holofoil: { market: 542.6, low: 200, high: 699.98 }, reverseHolofoil: { market: 70, low: 50, high: 90 } }), upstream("8", { holofoil: { market: 130, low: 100, high: 160 } })] });
    }
    return realFetch(url, init);
  };
  try {
    const row = (body, variant) => body.cards[0].prices.find((p) => p.variant === variant && p.source === "tcgplayer");
    const up = (await get(searchCard, "/api/search-card?id=pk-up")).body;
    check("a fresh stored line replaces the upstream market for its printing, no flag", [row(up, "holofoil").market, row(up, "holofoil").untrusted], [290, undefined]);
    check("... a printing with no line of its own keeps the upstream number", row(up, "reverseHolofoil").market, 70);
    const old = (await get(searchCard, "/api/search-card?id=pk-up-old")).body;
    check("... a line last written 5 days ago does not (upstream is today's number)", row(old, "holofoil").market, 130);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("lookups never write over a line the nightly tcgcsv refresh keeps (10-21: Kyogre $290 -> $542.60 after a name search)");
{
  const { recordPrices } = await import(at("lib/server/priceHistory.ts"));
  const { decodePrices } = await import(at("lib/priceSeries.ts"));
  await db.prepare("INSERT INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES (89788, 1, 'pk-up', 'pokemon')").run();
  const lastOf = async (id, variant, source = "tcgplayer") => {
    const r = await db.prepare("SELECT prices FROM price_series WHERE card_id = ? AND variant = ? AND source = ?").get(id, variant, source);
    const p = r ? decodePrices(r.prices) : [];
    return p.length ? p[p.length - 1] : null;
  };
  const card = (id, prices) => ({ id, name: "Kyogrex", englishName: null, setName: "Test Pokemon Set", number: "7", imageSmall: "", imageLarge: "", prices });
  const tcg = (variant, market) => ({ source: "tcgplayer", currency: "USD", variant, label: variant, market, low: null, high: null });
  const n = await recordPrices([
    card("pk-up", [tcg("holofoil", 542.6), tcg("reverseHolofoil", 70), { source: "cardmarket", currency: "EUR", variant: "average", label: "Average (EUR)", market: 4.46, low: null, high: null }]),
    card("pk-up-old", [tcg("holofoil", 130)]),
  ]);
  check("a mapped card's kept line keeps the refresh's number", await lastOf("pk-up", "holofoil"), 290);
  check("... a printing the refresh has no line for is recorded", await lastOf("pk-up", "reverseHolofoil"), 70);
  check("... the Cardmarket row is recorded", await lastOf("pk-up", "average", "cardmarket"), 4.46);
  check("... a card the refresh does not map is recorded as before", await lastOf("pk-up-old", "holofoil"), 130);
  check("... the count says what was written", n, 3);
}

console.log("set lists follow the card page's chain (10-21: Black Lotus Unlimited missing, Will-o'-the-Wisp 'looks off' vs $66.41)");
{
  const { loadSetCards } = await import(at("lib/server/cardPages.ts"));
  const { setSetting } = await import(at("lib/server/settings.ts"));
  const { addDays: add } = await import(at("lib/priceSeries.ts"));
  // 1 USD = 0.8 EUR -> 1.25 USD per euro; triedAt now = no network.
  await setSetting("fx_rates", JSON.stringify({ date: TODAY, fetchedAt: Date.now(), triedAt: Date.now(), rates: { EUR: 0.8 } }));
  const mtg = db.prepare(`INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, set_release_date, image_url, price_usd, price_usd_foil, price_eur, price_eur_foil, lang, synced_at)
                          VALUES (?, ?, 'tsl', 'Test List Set', ?, '2020-01-01', 'https://img/x/normal/front/l.jpg', ?, ?, ?, ?, 'en', 0)`);
  await mtg.run("sl-eur", "Euro Wisp", "1", null, 150, null, 12);
  await recordSeries(recordPoint, addDays, TODAY, "sl-eur", "mtg", "foil", liquidPrices(150));
  await mtg.run("sl-backup", "Backup Lotus", "2", null, null, 13967.64, null);
  await recordPoint("sl-backup", "mtg", "nonfoil", "cardmarket-converted", "USD", 17560.09, TODAY);
  await mtg.run("sl-none", "Unpriced Thing", "3", null, null, null, null);
  await mtg.run("sl-ok", "Plain Bolt", "4", 2, null, 1.5, null);
  await recordSeries(recordPoint, addDays, TODAY, "sl-ok", "mtg", "nonfoil", liquidPrices(2));
  // A tie inside one backup source (10-21, Enlightened Confidant pfra 5p: Card Kingdom foil $8.86 stored before nonfoil $7.65).
  await mtg.run("sl-tie", "Tied Confidant", "5", null, null, null, null);
  await recordPoint("sl-tie", "mtg", "foil", "cardkingdom", "USD", 8.86, TODAY);
  await recordPoint("sl-tie", "mtg", "nonfoil", "cardkingdom", "USD", 7.65, TODAY);
  clearTrustMemo();
  const list = await loadSetCards("mtg", { key: "tsl", name: "Test List Set" }, TODAY);
  const by = Object.fromEntries(list.map((c) => [c.key, c]));
  const { loadCardRecord, loadCardPage } = await import(at("lib/server/cardPages.ts"));
  const tiePage = await loadCardPage(await loadCardRecord("mtg", "tsl-5"), TODAY);
  check("one backup source, two printings: the nonfoil, on the list and the page", [by["tsl-5"]?.price, tiePage.headline?.price], [7.65, 7.65]);
  check("flagged, no stored backup: Cardmarket's euro figure, as on its page (12 x 1.25 x 1.12)", [by["tsl-1"]?.price, by["tsl-1"]?.flagged], [16.8, false]);
  check("no TCGplayer row, a stored backup: listed at the backup (was left off)", [by["tsl-2"]?.price, by["tsl-2"]?.flagged], [17560.09, false]);
  check("nothing at all: still off the list", by["tsl-3"] === undefined);
  check("a normal card unchanged; most valuable first", [by["tsl-4"]?.price, list.map((c) => c.key)], [2, ["tsl-2", "tsl-1", "tsl-5", "tsl-4"]]);

  // Pokémon, a stopped market: its page tries the stored backup before the last recorded price, so the list does too.
  const pk = db.prepare(`INSERT INTO en_cards (id, name, set_id, set_name, local_id, set_release_date, image_url, synced_at) VALUES (?, ?, 'tsp', 'Test Stopped Set', ?, '2019-05-01', 'https://img/p.webp', 0)`);
  await pk.run("sp-backup", "Stopped With Backup", "1");
  await recordSeries(recordPoint, addDays, add(TODAY, -30), "sp-backup", "pokemon", "holofoil", liquidPrices(40));
  await recordPoint("sp-backup", "pokemon", "holofoil", "cardtrader", "USD", 55, TODAY);
  await pk.run("sp-last", "Stopped Alone", "2");
  await recordSeries(recordPoint, addDays, add(TODAY, -30), "sp-last", "pokemon", "holofoil", liquidPrices(30));
  clearTrustMemo();
  const plist = await loadSetCards("pokemon", { key: "tsp", name: "Test Stopped Set" }, TODAY);
  const pby = Object.fromEntries(plist.map((c) => [c.key, c]));
  check("stopped + fresh backup: the backup, not the old price", [pby["sp-backup"]?.price, pby["sp-backup"]?.stale], [55, undefined]);
  check("stopped alone: the last recorded price, marked stale (as before)", [pby["sp-last"]?.price, pby["sp-last"]?.stale], [30, true]);
}

console.log("/api/set-cards");
{
  const pk = await get(setCards, "/api/set-cards?set=Test%20Pokemon%20Set");
  const by = Object.fromEntries(pk.body.cards.map((c) => [c.id, c]));
  check("Pokemon set: the junk $500 card carries the flag on its one price entry", [by["pk-junk"].prices.length, by["pk-junk"].prices[0].untrusted?.hard, by["pk-junk"].prices[0].untrusted?.reason.startsWith("spike")], [1, true, true]);
  check("... the stale $500 card carries the stale note, not a flag", [by["pk-stale"]?.prices[0].market, by["pk-stale"]?.prices[0].untrusted, by["pk-stale"]?.prices[0].stale], [500, undefined, { days: 87 }]);
  check("... the normal card is priced as before", [by["pk-fine"].prices[0].market, by["pk-fine"].prices[0].untrusted], [300, undefined]);
  const mtg = await get(setCards, "/api/set-cards?game=mtg&set=tst");
  const foil = mtg.body.cards.find((c) => c.id === "mtg-junk").prices.find((p) => p.variant === "foil" && p.source === "tcgplayer");
  check("Magic set: same flag on the foil row", foil.untrusted?.hard, true);
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
  const fineEntry = await logPriceCheck(u.id, card("pk-fine", "Umbreon", 300), "en");
  check("a flagged market is not stored as the lookup's price; a normal one is", [junkEntry.representativePrice, fineEntry.representativePrice], [null, 300]);
  const stored = await db.prepare("SELECT prices_json FROM price_checks WHERE card_id = 'pk-junk'").get();
  check("prices_json never carries a flag (annotated at read only)", stored.prices_json.includes("untrusted"), false);
  // A lookup saved before the guard: the junk number is the representative price.
  await db.prepare("UPDATE price_checks SET representative_price = 500 WHERE card_id = 'pk-junk'").run();
  const list = await listPriceChecks(u.id);
  const j = list.find((e) => e.cardId === "pk-junk");
  const f = list.find((e) => e.cardId === "pk-fine");
  check("history read: the saved junk row is flagged, and so is its price row", [j.flag?.hard, j.prices[0].untrusted?.hard], [true, true]);
  check("history read: a normal row is untouched", [f.flag, f.prices[0].untrusted, f.representativePrice], [undefined, undefined, 300]);
  // A number saved at an older, different price is history, not today's junk.
  await db.prepare("UPDATE price_checks SET prices_json = ? WHERE card_id = 'pk-junk'").run(JSON.stringify([{ source: "tcgplayer", variant: "holofoil", label: "Holofoil", currency: "USD", market: 240, low: null, high: null }]));
  check("a stored price that is no longer the current one is not flagged", (await listPriceChecks(u.id)).find((e) => e.cardId === "pk-junk").prices[0].untrusted === undefined);

  // A lookup saved AFTER the guard: the live number the search showed (900 on a $300 card) is not the series' last
  // point, so it is judged as today's point, stored as no price, and the history still says why.
  const u2 = await createUser("Checker Two", "check2@example.com", "hunter22", "user");
  const spike = await logPriceCheck(u2.id, card("pk-fine", "Umbreon", 900), "en");
  check("a live price that is not the series' last point is judged as today's and not stored", spike.representativePrice, null);
  const spiked = (await listPriceChecks(u2.id)).find((e) => e.cardId === "pk-fine");
  check("history read: a lookup saved unpriced because it was flagged shows the note (flag set), not a dash", [spiked.representativePrice, spiked.flag?.hard, spiked.prices[0].untrusted?.hard], [null, true, true]);
  const stored2 = await db.prepare("SELECT prices_json FROM price_checks WHERE user_id = ?").get(u2.id);
  check("... and still no flag inside prices_json", stored2.prices_json.includes("untrusted"), false);
  const bare = await logPriceCheck(u2.id, { ...card("pk-none", "Bare", 1), prices: [] }, "en");
  check("a lookup with no price at all has no flag either", [bare.representativePrice, (await listPriceChecks(u2.id)).find((e) => e.cardId === "pk-none").flag], [null, undefined]);
}

console.log(failures === 0 ? "\nAll site price-guard route checks passed." : `\n${failures} site price-guard route check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
