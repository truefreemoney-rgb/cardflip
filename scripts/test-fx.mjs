/**
 * Exchange rates (lib/server/fx.ts, A-H #16 10-17, Chris: "try to never leave a price unsure").
 * Run: npm run test:fx
 *
 * Pins: a fresh cache is served without a fetch; Frankfurter fills every currency; a currency
 * Frankfurter leaves out comes from the backup; Frankfurter down = all from the backup (jsDelivr,
 * then its mirror); everything down = the last good rates are KEPT (never null), the next try waits
 * 30 minutes, and a rate over 2 days old lands in error_events; a currency kept from an old refresh
 * keeps its own age, so a local eBay listing in that currency is refused while the others price.
 * Throwaway db (chdir before imports), fetch stubbed, no network.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-fx-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { getFxRates, usdPerEur, listingFxRate, FX_ALERT_AGE_MS } = await import(at("lib/server/fx.ts"));
const { getSetting, setSetting } = await import(at("lib/server/settings.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const ECB = { AUD: 1.437, CAD: 1.4161, EUR: 0.88865, GBP: 0.74989, NZD: 1.7656 };
const BACK = { aud: 1.4395, cad: 1.4174, eur: 0.88987, gbp: 0.75171, nzd: 1.76874 };
const world = { primary: "ok", primaryDrop: [], backup: "ok", mirror: "ok" };
const calls = [];
globalThis.fetch = async (input) => {
  const url = String(input);
  const host = new URL(url).host;
  calls.push(host);
  const json = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (host === "api.frankfurter.dev") {
    if (world.primary === "down") throw new TypeError("fetch failed");
    const rates = Object.fromEntries(Object.entries(ECB).filter(([c]) => !world.primaryDrop.includes(c)));
    return json({ base: "USD", date: "2026-10-16", rates });
  }
  if (host === "cdn.jsdelivr.net") {
    if (world.backup === "down") return new Response("nope", { status: 503 });
    return json({ date: "2026-10-17", usd: { ...BACK, btc: 0.00001 } });
  }
  if (host === "latest.currency-api.pages.dev") {
    if (world.mirror === "down") throw new TypeError("fetch failed");
    return json({ date: "2026-10-17", usd: BACK });
  }
  throw new Error("unexpected fetch " + url);
};

const H = 3600_000;
const T0 = Date.UTC(2026, 9, 17, 9, 0, 0);
const reset = async () => { await db.prepare("DELETE FROM settings WHERE key = 'fx_rates'").run(); calls.length = 0; };
const errors = async () => (await db.prepare("SELECT message FROM error_events WHERE source = 'fx'").all()).map((r) => r.message);

console.log("normal day");
await reset();
const a = await getFxRates(T0);
const sorted = (o) => Object.fromEntries(Object.entries(o).sort());
check("Frankfurter fills every currency, backup not asked", [sorted(a.rates), a.date, calls], [sorted(ECB), "2026-10-16", ["api.frankfurter.dev"]]);
calls.length = 0;
check("within 12 hours the saved rates are served with no fetch", [(await getFxRates(T0 + 11 * H)).rates.GBP, calls.length], [ECB.GBP, 0]);
check("after 12 hours it refreshes (the nightly price jobs ask daily)", [await getFxRates(T0 + 13 * H) !== null, calls], [true, ["api.frankfurter.dev"]]);
check("usdPerEur = 1 / EUR", Math.abs((await usdPerEur(T0 + 13 * H)) - 1 / ECB.EUR) < 1e-9, true);

console.log("one currency missing from Frankfurter (used to freeze them all)");
await reset();
world.primaryDrop = ["NZD"];
const b = await getFxRates(T0);
check("NZD comes from the backup, the rest from Frankfurter", [b.rates.NZD, b.rates.GBP, b.rates.EUR], [BACK.nzd, ECB.GBP, ECB.EUR]);
check("asked Frankfurter, then the backup", calls, ["api.frankfurter.dev", "cdn.jsdelivr.net"]);
world.primaryDrop = [];

console.log("Frankfurter down");
await reset();
world.primary = "down";
const c = await getFxRates(T0);
check("every currency from the backup, its date kept", [c.rates.EUR, c.rates.CAD, c.date], [BACK.eur, BACK.cad, "2026-10-17"]);
await reset();
world.backup = "down";
check("jsDelivr down too: the pages.dev mirror answers", [(await getFxRates(T0)).rates.GBP, calls], [BACK.gbp, ["api.frankfurter.dev", "cdn.jsdelivr.net", "latest.currency-api.pages.dev"]]);

console.log("everything down: keep the last good rates, never blank");
await reset();
world.primary = "ok"; world.backup = "ok";
await getFxRates(T0);
world.primary = "down"; world.backup = "down"; world.mirror = "down";
calls.length = 0;
const d = await getFxRates(T0 + 13 * H);
check("last good rates kept (prices still convert)", [d?.rates.EUR, (await usdPerEur(T0 + 13 * H)) !== null], [ECB.EUR, true]);
check("tried all three sources", calls.length, 3);
calls.length = 0;
await getFxRates(T0 + 13 * H + 10 * 60_000);
check("a page view 10 minutes later does NOT wait on the dead sources again", calls.length, 0);
await getFxRates(T0 + 13 * H + 31 * 60_000);
check("after 30 minutes it tries again", calls.length, 3);
check("under 2 days old: nothing in the error mail yet", (await errors()).length, 0);
const e = await getFxRates(T0 + FX_ALERT_AGE_MS + H);
check("over 2 days old: still the last good rate", e.rates.EUR, ECB.EUR);
check("...and the error mail hears about it", (await errors()).some((m) => m.includes("over 2 days old") && m.includes("EUR")), true);
check("a week down: still a price (Chris: never unsure)", (await getFxRates(T0 + 7 * 24 * H)).rates.GBP, ECB.GBP);

console.log("a kept currency keeps its own age (eBay listings)");
await reset();
world.primary = "ok"; world.backup = "ok"; world.mirror = "ok";
await getFxRates(T0);
world.primaryDrop = ["NZD"]; world.backup = "down"; world.mirror = "down";
const LATER = T0 + 4 * 24 * H;
const f = await getFxRates(LATER);
check("NZD kept from 4 days ago, the others fresh", [f.rates.NZD, f.rateAt.NZD, f.rateAt.GBP], [ECB.NZD, T0, LATER]);
check("a GBP listing prices", (await listingFxRate("GBP", "eBay UK", LATER)).rate, ECB.GBP);
check("an NZD listing is refused (its rate is 4 days old)", await listingFxRate("NZD", "eBay NZ", LATER).then(() => "priced", (err) => err.name), "FxUnavailableError");
world.primaryDrop = [];

console.log("nothing ever fetched and everything down");
await reset();
world.primary = "down"; world.backup = "down"; world.mirror = "down";
check("null (no rate exists yet)", await getFxRates(T0), null);
calls.length = 0;
check("and the next page view does not wait on it again", [await usdPerEur(T0 + 60_000), calls.length], [null, 0]);
check("old rows without rateAt still read (fetchedAt stands in)", await (async () => {
  await setSetting("fx_rates", JSON.stringify({ date: "2026-10-16", fetchedAt: T0, rates: ECB }));
  return (await listingFxRate("EUR", "eBay IE", T0 + H)).rate;
})(), ECB.EUR);
void getSetting;

console.log(failures ? `\n${failures} failure(s)` : "\nall fx checks passed");
process.exit(failures ? 1 : 0);
