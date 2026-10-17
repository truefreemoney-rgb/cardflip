/**
 * "Price looks wrong?" reports (A-H #9, 10-17).
 * Run: npm run test:pricereports
 *
 * Pins: only card page paths, a sane printing and high/low are accepted; one vote per visitor per card (a second
 * click changes it, never stacks); the list groups by card, counts each way, newest price, most votes first;
 * rows past 90 days drop off; the admin label reads the card's name from its path.
 *
 * Throwaway db: chdir to a temp dir before any import.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-pricereports-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { parsePriceReport, addPriceReport, listPriceReports, reportLabel } = await import(at("lib/server/priceReports.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const zubat = "/cards/pokemon/supreme-victors/zubat--pl3-133";
check("a card page report parses", parsePriceReport({ path: zubat, variant: "reverseHolofoil", direction: "high", price: 5.969 }), { path: zubat, variant: "reverseHolofoil", direction: "high", price: 5.97 });
check("not a card page: refused", parsePriceReport({ path: "/admin/prices", variant: "normal", direction: "high", price: 1 }), null);
check("outside link: refused", parsePriceReport({ path: "https://evil.example/cards/a/b/c--d", variant: "normal", direction: "high", price: 1 }), null);
check("unknown direction: refused", parsePriceReport({ path: zubat, variant: "normal", direction: "sideways", price: 1 }), null);
check("odd printing text: refused", parsePriceReport({ path: zubat, variant: "<b>x</b>", direction: "low", price: 1 }), null);
check("junk price kept as no price", parsePriceReport({ path: zubat, variant: "normal", direction: "low", price: "9" })?.price, null);
check("empty body: refused", parsePriceReport(null), null);

const now = 1_800_000_000_000;
const r = (direction, price = 5.97) => ({ path: zubat, variant: "reverseHolofoil", direction, price });
await addPriceReport(r("high"), "visitor-a", now);
await addPriceReport(r("high"), "visitor-a", now + 1000); // same visitor again: no stacking
await addPriceReport(r("high"), "visitor-b", now + 2000);
await addPriceReport(r("low", 6.1), "visitor-c", now + 3000);
const other = "/cards/mtg/urzas-legacy/ring-of-gix--0b09dc9b";
await addPriceReport({ path: other, variant: "foil", direction: "low", price: 69.99 }, "visitor-a", now + 4000);

let list = await listPriceReports();
check("two cards listed, most votes first", list.map((x) => x.path), [zubat, other]);
check("one vote per visitor: 2 high + 1 low", [list[0].high, list[0].low], [2, 1]);
check("newest report's price", list[0].price, 6.1);
check("newest time", list[0].last, now + 3000);

await addPriceReport(r("low"), "visitor-a", now + 5000); // visitor-a changes their mind
list = await listPriceReports();
check("a second click changes the vote", [list[0].high, list[0].low], [1, 2]);

await addPriceReport({ path: other, variant: "foil", direction: "low", price: 69.99 }, "visitor-z", now + 91 * 86_400_000);
list = await listPriceReports();
check("reports older than 90 days drop off", list.map((x) => [x.path, x.high + x.low]), [[other, 1]]);

check("admin label from the path", reportLabel(zubat), { game: "pokemon", set: "supreme-victors", name: "Zubat" });
check("multi-word name", reportLabel("/cards/onepiece/op17/are-you-that-afraid-of-the-new-era--OP17-037_p1").name, "Are You That Afraid Of The New Era");

console.log(failures ? `\n${failures} price report check(s) FAILED` : "\nprice reports: all checks passed");
process.exitCode = failures ? 1 : 0;
