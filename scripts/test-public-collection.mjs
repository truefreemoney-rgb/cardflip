/**
 * Public collection page (Tier 2 #10). Run: npm run test:publiccollection
 *
 * Pins: handle rules (normalize, length, characters, reserved); the page is
 * null with no handle, null with the switch off, data with it on; sold rows
 * hidden; hand/refresh price shown, $0 rows priced from today's market by
 * condition, unpriced = null; Buy on eBay only on listed rows with a URL;
 * dearest first; value = priced sum; count/forSale; the 500 cap;
 * the @handle shows, never the account name; pictures from known hosts only;
 * updateUserProfile writes handle + switch; findUserByHandle.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-public-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { normalizeHandle, handleProblem } = await import(at("lib/handle.ts"));
const { publicCollection, publicImageUrl, PUBLIC_CARD_CAP } = await import(at("lib/server/publicCollection.ts"));
const { createCard } = await import(at("lib/server/cards.ts"));
const { createUser, updateUserProfile, findUserByHandle, findUserById } = await import(at("lib/server/users.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { askingPriceFor } = await import(at("lib/listing.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

console.log("handle rules");
check("normalize: case, spaces, underscores, junk", normalizeHandle("  Chris_The Collector! "), "chris-the-collector");
check("double and edge hyphens collapse", normalizeHandle("--a--b--"), "a-b");
check("too short", handleProblem("ab"), "At least 3 characters");
check("reserved", handleProblem("admin"), "That one is taken");
check("good", handleProblem("chris-1"), null);

console.log("\npage");
const u = await createUser("Chris", "chris@example.com", "hunter22", "user");
check("no handle → nothing", await publicCollection("chris"), null);
await updateUserProfile(u.id, { handle: "chris" });
check("handle but private → nothing", await publicCollection("chris"), null);
check("findUserByHandle", (await findUserByHandle("chris"))?.id, u.id);
await updateUserProfile(u.id, { handlePublic: true });
check("switch on → page, empty", (await publicCollection("chris"))?.cards, []);

const card = (name, extra = {}) => createCard(u.id, { cardName: name, setName: "Base Set", cardNumber: "4", imageUrl: "https://assets.tcgdex.net/en/base/base1/4/high.webp", condition: "Near Mint", price: 0, ...extra });
const charizard = await card("Charizard", { price: 800, catalogCardId: "base1-4" });
await db.prepare("UPDATE cards SET status = 'listed', listed_at = 1, ebay_listing_id = '1' WHERE id = ?").run(charizard.id);
const listedNoUrl = await card("Blastoise", { price: 100 });
await db.prepare("UPDATE cards SET status = 'listed', listed_at = 1 WHERE id = ?").run(listedNoUrl.id);
const sold = await card("Venusaur", { price: 90 });
await db.prepare("UPDATE cards SET status = 'sold', sold_at = 1, sold_price = 90 WHERE id = ?").run(sold.id);
await card("Pikachu", { catalogCardId: "base1-58", condition: "Lightly Played" }); // $0 → market
await recordPoint("base1-58", "pokemon", "normal", "tcgplayer", "USD", 10);
await card("Mystery", { catalogCardId: "nope" }); // $0, no market → unpriced
await card("Booster Box", { kind: "sealed", productType: "Booster Box", price: 150, condition: "Factory Sealed" });

const c = await publicCollection("chris");
check("sold hidden, dearest first, unpriced last", c.cards.map((x) => [x.name, x.price]), [["Charizard", 800], ["Booster Box", 150], ["Blastoise", 100], ["Pikachu", askingPriceFor(10, "Lightly Played")], ["Mystery", null]]);
check("Buy on eBay only with a live listing", c.cards.map((x) => (x.ebayUrl ? x.ebayUrl.includes("/itm/1") : null)), [true, null, null, null, null]);
check("value, count, for sale", [c.value, c.count, c.forSale, c.truncated], [Math.round((800 + 150 + 100 + askingPriceFor(10, "Lightly Played")) * 100) / 100, 5, 1, false]);
check("the handle shows, never the account name or email", [c.handle, Object.keys(c).includes("name"), Object.keys(c).includes("email"), JSON.stringify(c).includes("Chris")], ["chris", false, false, false]);
check("kind and condition ride along", c.cards.map((x) => x.kind)[1], "sealed");

console.log("\npictures: known hosts only");
check("a catalog host passes as is", c.cards[0].imageUrl, "https://assets.tcgdex.net/en/base/base1/4/high.webp");
check("every catalog source", ["https://images.pokemontcg.io/base1/4_hires.png", "https://cards.scryfall.io/large/front/a/b/x.jpg", "https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg", "https://cards.lorcast.io/card/digital/large/x.avif", "https://optcgapi.com/media/static/Card_Images/OP01-001.jpg"].map(publicImageUrl).every(Boolean), true);
check("our own Blob store passes, another store does not", [publicImageUrl("https://mlwovvakovcpakbr.public.blob.vercel-storage.com/a.jpg") !== "", publicImageUrl("https://someoneelse.public.blob.vercel-storage.com/a.jpg")], [true, ""]);
check("off-list host, look-alike host, http, data:, junk → empty", ["https://evil.example/x.png", "https://assets.tcgdex.net.evil.example/x.png", "http://assets.tcgdex.net/x.png", "data:image/png;base64,AAAA", "javascript:alert(1)", "not a url", ""].map(publicImageUrl), ["", "", "", "", "", "", ""]);
await card("Tracker", { imageUrl: "https://evil.example/pixel.png" });
check("a row with an off-list picture shows the empty tile", (await publicCollection("chris")).cards.find((x) => x.name === "Tracker")?.imageUrl, "");

console.log("\nthe price guard (priceTrustSite)");
{
  const { flatPrices, liquidPrices, recordSeries } = await import("./lib/liquid-series.mjs");
  const { addDays, todayUtc } = await import(at("lib/priceSeries.ts"));
  await recordSeries(recordPoint, addDays, todayUtc(), "g-junk", "pokemon", "holofoil", flatPrices(500, 87)); // a stuck round $500
  await card("Junk Draft", { price: 480, catalogCardId: "g-junk" });
  const typed = await card("Typed Draft", { price: 450, catalogCardId: "g-junk" });
  await db.prepare("UPDATE cards SET price_locked = 1 WHERE id = ?").run(typed.id);
  const live = await card("Live Ask", { price: 500, catalogCardId: "g-junk" });
  await db.prepare("UPDATE cards SET status = 'listed', listed_at = 1, ebay_listing_id = '2' WHERE id = ?").run(live.id);
  // A foil-held row at $0: the fallback price is the DEFAULT series' (junk $500 normal), so it is judged there, not on the healthy holofoil line.
  await recordSeries(recordPoint, addDays, todayUtc(), "g-mix", "pokemon", "normal", flatPrices(500, 87));
  await recordSeries(recordPoint, addDays, todayUtc(), "g-mix", "pokemon", "holofoil", liquidPrices(300));
  await card("Mixed Holo", { catalogCardId: "g-mix", variant: "holofoil" });
  const g = await publicCollection("chris");
  const by = Object.fromEntries(g.cards.map((x) => [x.name, x.price]));
  check("an unpriced row whose fallback comes from a flagged default series shows no price, whatever printing it is held as", by["Mixed Holo"], null);
  check("a draft priced off a flagged market shows no price", by["Junk Draft"], null);
  check("the seller's typed price and a live eBay ask still show", [by["Typed Draft"], by["Live Ask"]], [450, 500]);
  check("the junk draft adds nothing to the total", g.value, Math.round((800 + 150 + 100 + askingPriceFor(10, "Lightly Played") + 450 + 500) * 100) / 100);
}

console.log("\nswitching off");
await updateUserProfile(u.id, { handlePublic: false });
check("off again → nothing", await publicCollection("chris"), null);
await updateUserProfile(u.id, { handle: null, handlePublic: false });
check("cleared handle", (await findUserById(u.id)).handle, null);

console.log("\ncap");
const big = await createUser("Big", "big@example.com", "hunter22", "user");
await updateUserProfile(big.id, { handle: "big", handlePublic: true });
for (let i = 0; i < PUBLIC_CARD_CAP + 1; i++) await createCard(big.id, { cardName: `Card ${i}`, setName: "S", cardNumber: String(i), imageUrl: "", condition: "Near Mint", price: 5 });
const b = await publicCollection("big");
check("cap + truncated flag", [b.cards.length, b.count, b.truncated], [PUBLIC_CARD_CAP, PUBLIC_CARD_CAP, true]);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
