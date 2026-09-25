/**
 * Social autopilot publisher (lib/server/socialPublish.ts + sites/bluesky.ts).
 * Run: npm run test:socialpublish
 *
 * Pins: three Eastern slots (7am card, 1pm movers, 7pm drops); never twice per slot per
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
const { publishSocial, fitText, slotAt, eastern, LAST_POST_PREFIX, SLOT_PREFIX } = await import(at("lib/server/socialPublish.ts"));
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
  for (const back of [2, 1, 0]) await recordPoint(id, "pokemon", "normal", "tcgplayer", "USD", to, day(back));
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

console.log("slots (Eastern; 2026-09-10 is EDT = UTC-4)");
const clock = (h, m = 30) => Date.UTC(2026, 8, 10, h, m);
check("7am ET → morning", slotAt(clock(11)), "morning");
check("8am ET still morning (the EST-hour ping)", slotAt(clock(12)), "morning");
check("1pm ET → midday", slotAt(clock(17)), "midday");
check("7pm ET → evening", slotAt(clock(23)), "evening");
check("11am ET → no slot", slotAt(clock(15)), null);
check("Eastern day rolls at midnight ET, not UTC", eastern(Date.UTC(2026, 8, 11, 2)).day, THU);

console.log("publish");
const off = fakeSite("off", { connected: false });
let r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", sites: [off], fetchImage });
check("unconnected site is skipped", r.sites.map((s) => [s.status, s.reason]), [["skipped", "not connected"]]);

const bsky = fakeSite("bsky");
r = await publishSocial({ day: THU, now: clock(9), origin: "http://x", sites: [bsky], fetchImage });
check("5am: skipped, before the first window", r.sites[0].reason, "before the 7am window");
check("nothing fetched", fetched.length, 0);

r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", sites: [bsky], fetchImage, dry: true });
check("dry run reports one draft for the slot", [r.slot, r.sites[0].posts.length], ["morning", 1]);
check("dry run posts nothing", bsky.posts.length, 0);
check("dry run marks nothing", await getSetting(`${SLOT_PREFIX}bsky:morning`), null);

r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", sites: [bsky], fetchImage });
check("7am: card of the day posted", [r.sites[0].status, bsky.posts.length], ["posted", 1]);
check("image fetched with the cron key, square", fetched[0], `http://x/api/social/image?kind=card&game=pokemon&day=${THU}&size=square&key=cron-test`);
check("alt text set", bsky.posts[0].alt.startsWith("Card of the day:"));
check("slot marked with the Eastern day", await getSetting(`${SLOT_PREFIX}bsky:morning`), THU);
check("last-post day kept for the strip", await getSetting(`${LAST_POST_PREFIX}bsky`), THU);
check("uris kept", JSON.parse(await getSetting(`${LAST_POST_PREFIX}bsky:uris`)), ["https://bsky/1"]);

r = await publishSocial({ day: THU, now: clock(12), origin: "http://x", sites: [bsky], fetchImage });
check("8am ping: morning already posted", [r.sites[0].reason, bsky.posts.length], ["morning slot already posted today", 1]);
r = await publishSocial({ day: THU, now: clock(17), origin: "http://x", sites: [bsky], fetchImage });
check("1pm: movers posted", [r.slot, bsky.posts.length, bsky.posts[1].alt.startsWith("Pokémon movers of the week.")], ["midday", 2, true]);
r = await publishSocial({ day: THU, now: clock(23), origin: "http://x", sites: [bsky], fetchImage });
check("7pm: one drop only → no dips post, stays quiet rather than repeat", [r.slot, r.sites[0].status, r.sites[0].reason, bsky.posts.length], ["evening", "skipped", "nothing to post for the evening slot", 2]);
r = await publishSocial({ day: THU, now: clock(15), origin: "http://x", sites: [bsky], fetchImage, force: true });
check("Post now at 11am (only morning due, already done) → re-does morning", [r.slot, r.sites[0].status, r.sites[0].reason ?? null, bsky.posts.length], ["morning", "posted", null, 3]);
check("one image fetch per posting run", fetched.length, 3);

const late = fakeSite("late");
r = await publishSocial({ day: THU, now: clock(19), origin: "http://x", sites: [bsky, late], fetchImage });
check("a site connected at 3pm catches up on the 7am and 1pm posts in one run", [r.sites[1].status, r.sites[1].posts.map((p) => p.title.split(":")[0])], ["posted", ["Card of the day", "Pokémon movers of the week"]]);
check("both slots marked for it", [await getSetting(`${SLOT_PREFIX}late:morning`), await getSetting(`${SLOT_PREFIX}late:midday`)], [THU, THU]);
check("the site that already had them is left alone", [r.sites[0].status, bsky.posts.length], ["skipped", 3]);

const broken = fakeSite("broken", { fail: true });
r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", sites: [broken], fetchImage });
check("failing site → failed, slot not marked", [r.sites[0].status, await getSetting(`${SLOT_PREFIX}broken:morning`)], ["failed", null]);
check("errors carried per post", r.sites[0].posts.every((p) => p.error === "boom"));

console.log("board");
const { sections } = await loadBoard();
const completed = sections.find(isCompletedSection);
const notes = completed.items.filter((i) => i.text.startsWith("Social autopilot"));
check("one Completed line per run that posted or failed", notes.length, 5);
check("newest first, done, Claude's, names the slot", [notes[0].done, notes[0].owner, notes[0].text.includes("broken: nothing went out"), notes[0].text.includes("7am card of the day")], [true, "Claude", true, true]);
check("posted line carries the uri", notes[1].text.includes("https://late/2"));

console.log("text fitting");
const long = { caption: `${"x".repeat(280)}\n\ncardflip.io`, shortCaption: "Pokémon price moves this week\nA +5%\n\nScan a card, see what it's worth. cardflip.io", hashtags: ["PokemonTCG", "TCG"] };
check("fits: caption + tags when room", fitText({ caption: "hi cardflip.io", shortCaption: "hi", hashtags: ["A"] }, 300), "hi cardflip.io\n\n#A");
check("drops tags when the caption alone fits", fitText(long, 300), long.caption);
check("falls back to the short caption, tags kept when they fit", fitText(long, 290), `${long.shortCaption}

#PokemonTCG #TCG`);
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

console.log("x oauth 1.0a");
const { xAuthHeader, rfc3986, X_MAX_CHARS } = await import(at("lib/server/sites/x.ts"));
check("x limit leaves room for the t.co link", X_MAX_CHARS, 257);
check("rfc3986 escapes what encodeURIComponent skips", rfc3986("a b!*'()"), "a%20b%21%2A%27%28%29");
// The worked example from X's "Creating a signature" docs page.
const hdr = xAuthHeader(
  "POST",
  "https://api.twitter.com/1.1/statuses/update.json",
  { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
  {
    apiKey: "xvz1evFS4wEEPTGEFPHBog",
    apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  },
  "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
  "1318622958",
);
check("signature matches X's documented example", /oauth_signature="([^"]+)"/.exec(hdr)?.[1], rfc3986("hCtSmYh+iHYCEqBWrE7C7hYmtUk="));
check("header starts with OAuth and carries the token", [hdr.startsWith("OAuth "), hdr.includes('oauth_token="370773112-')], [true, true]);

const meta = await import(at("lib/server/sites/meta.ts"));
check("meta limits: threads 500, instagram 2200, facebook 5000", [meta.THREADS_MAX_CHARS, meta.INSTAGRAM_MAX_CHARS, meta.FACEBOOK_MAX_CHARS], [500, 2200, 5000]);
check("meta sites are off without tokens", [meta.facebook.connected(), meta.instagram.connected(), meta.threads.connected()], [false, false, false]);
check("meta post urls", [meta.metaPostUrl("facebook", "1_2"), meta.metaPostUrl("instagram", "ABC"), meta.metaPostUrl("threads", "9")], ["https://www.facebook.com/1_2", "https://www.instagram.com/p/ABC/", "https://www.threads.net/post/9"]);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
