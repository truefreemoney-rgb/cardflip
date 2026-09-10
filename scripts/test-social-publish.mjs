/**
 * Social autopilot publisher (lib/server/socialPublish.ts + sites/bluesky.ts).
 * Run: npm run test:socialpublish
 *
 * Pins: posts only on Tue/Thu/Sat unless forced; never twice a day per
 * site; a site without env vars never posts; dry runs touch nothing; a
 * failed site does not mark the day; text is fitted to the site's limit
 * and still ends on cardflip.io; Bluesky facets land on the right bytes;
 * every run leaves one line on the board's Completed list.
 *
 * Fake site + fake image fetch; same throwaway-db trick as test-social.mjs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-social-publish-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});
process.env.CRON_SECRET = "cron-test";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { publishSocial, fitText, isPostDay, LAST_POST_PREFIX } = await import(at("lib/server/socialPublish.ts"));
const { blueskyFacets, BLUESKY_MAX_CHARS } = await import(at("lib/server/sites/bluesky.ts"));
const { getSetting } = await import(at("lib/server/settings.ts"));
const { loadBoard, isCompletedSection } = await import(at("lib/server/board.ts"));
const { addDays } = await import(at("lib/priceSeries.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const THU = "2026-09-10"; // a Thursday
const day = (back) => addDays(THU, -back);

async function catalog(id, name, num) {
  await db.prepare(
    "INSERT INTO en_cards (id, name, set_id, set_name, local_id, image_url, synced_at) VALUES (?, ?, 'sv1', 'Scarlet & Violet', ?, ?, 0)",
  ).run(id, name, num, `https://assets.tcgdex.net/en/sv/sv1/${num}/low.webp`);
}
async function series(id, from, to) {
  await recordPoint(id, "pokemon", "normal", "tcgplayer", "USD", from, day(7));
  await recordPoint(id, "pokemon", "normal", "tcgplayer", "USD", to, day(0));
}
await catalog("sv1-2", "Miraidon ex", "81"); await series("sv1-2", 10, 15);
await catalog("sv1-3", "Koraidon ex", "125"); await series("sv1-3", 40, 20);
await catalog("sv1-4", "Gardevoir ex", "86"); await series("sv1-4", 20, 24);

const fetched = [];
const fetchImage = async (url) => { fetched.push(url); return Buffer.from("png"); };
function fakeSite(id, { connected = true, fail = false, maxChars = 5000 } = {}) {
  const posts = [];
  return {
    id, label: id, maxChars, maxImageBytes: 1_000_000, posts,
    connected: () => connected,
    async post(p) { if (fail) throw new Error("boom"); posts.push(p); return { uri: `https://${id}/${posts.length}` }; },
  };
}

console.log("cadence");
check("Thu is a post day", isPostDay(THU));
check("Wed is not", isPostDay(day(1)), false);
check("Sat is", isPostDay(addDays(THU, 2)));

console.log("publish");
const off = fakeSite("off", { connected: false });
let r = await publishSocial({ day: THU, origin: "http://x", sites: [off], fetchImage });
check("unconnected site is skipped", r.sites.map((s) => [s.status, s.reason]), [["skipped", "not connected"]]);

const bsky = fakeSite("bsky");
r = await publishSocial({ day: day(1), origin: "http://x", sites: [bsky], fetchImage });
check("Wednesday: skipped, not a post day", r.sites[0].reason, "not a post day");
check("nothing fetched", fetched.length, 0);

r = await publishSocial({ day: THU, origin: "http://x", sites: [bsky], fetchImage, dry: true });
check("dry run reports the drafts", r.sites[0].posts.length, 2);
check("dry run posts nothing", bsky.posts.length, 0);
check("dry run marks nothing", await getSetting(`${LAST_POST_PREFIX}bsky`), null);

r = await publishSocial({ day: THU, origin: "http://x", sites: [bsky], fetchImage });
check("Thursday: posted both drafts", [r.sites[0].status, bsky.posts.length], ["posted", 2]);
check("image fetched with the cron key, square", fetched[0], `http://x/api/social/image?kind=movers&game=pokemon&day=${THU}&size=square&key=cron-test`);
check("alt text set", bsky.posts[0].alt.startsWith("Pokémon movers of the week."));
check("day marked", await getSetting(`${LAST_POST_PREFIX}bsky`), THU);
check("uris kept", JSON.parse(await getSetting(`${LAST_POST_PREFIX}bsky:uris`)), ["https://bsky/1", "https://bsky/2"]);

r = await publishSocial({ day: THU, origin: "http://x", sites: [bsky], fetchImage });
check("same day again: skipped", [r.sites[0].reason, bsky.posts.length], ["already posted today", 2]);
r = await publishSocial({ day: THU, origin: "http://x", sites: [bsky], fetchImage, force: true });
check("force re-posts", [r.sites[0].status, bsky.posts.length], ["posted", 4]);
check("image fetched once per draft per run (cache)", fetched.length, 4);

const broken = fakeSite("broken", { fail: true });
r = await publishSocial({ day: THU, origin: "http://x", sites: [broken], fetchImage });
check("failing site → failed, day not marked", [r.sites[0].status, await getSetting(`${LAST_POST_PREFIX}broken`)], ["failed", null]);
check("errors carried per post", r.sites[0].posts.every((p) => p.error === "boom"));

console.log("board");
const { sections } = await loadBoard();
const completed = sections.find(isCompletedSection);
const notes = completed.items.filter((i) => i.text.startsWith("Social autopilot"));
check("one Completed line per run that posted or failed", notes.length, 3);
check("newest first, done, Claude's", [notes[0].done, notes[0].owner, notes[0].text.includes("broken: nothing went out")], [true, "Claude", true]);
check("posted line carries the uri", notes[1].text.includes("https://bsky/3"));

console.log("text fitting");
const long = { caption: `${"x".repeat(280)}\n\ncardflip.io`, shortCaption: "Pokémon price moves this week\nA +5%\n\nScan a card, see what it's worth. cardflip.io", hashtags: ["PokemonTCG", "TCG"] };
check("fits: caption + tags when room", fitText({ caption: "hi cardflip.io", shortCaption: "hi", hashtags: ["A"] }, 300), "hi cardflip.io\n\n#A");
check("drops tags when the caption alone fits", fitText(long, 300), long.caption);
check("falls back to the short caption", fitText(long, 290), long.shortCaption);
const tiny = fitText(long, 40);
check("last resort still ends on cardflip.io", [tiny.length <= 40, tiny.endsWith("cardflip.io")], [true, true]);
check("bluesky limit constant", BLUESKY_MAX_CHARS, 300);

console.log("bluesky facets");
const text = "Pokémon moves. cardflip.io\n\n#PokemonTCG #TCG";
const facets = blueskyFacets(text);
const bytes = (s) => new TextEncoder().encode(s).length;
check("link facet on cardflip.io by byte offset", facets[0], {
  index: { byteStart: bytes("Pokémon moves. "), byteEnd: bytes("Pokémon moves. cardflip.io") },
  features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://cardflip.io" }],
});
check("tag facets", facets.slice(1).map((f) => f.features[0].tag), ["PokemonTCG", "TCG"]);
check("no facet on support@cardflip.io", blueskyFacets("mail support@cardflip.io").length, 0);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
