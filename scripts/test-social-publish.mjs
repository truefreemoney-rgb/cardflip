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
const { publishSocial, fitText, slotAt, eastern, LAST_POST_PREFIX, SLOT_PREFIX, KIND_PREFIX, SLOTS, VIDEO_SLOT } = await import(at("lib/server/socialPublish.ts"));
const { blueskyFacets, BLUESKY_MAX_CHARS } = await import(at("lib/server/sites/bluesky.ts"));
const { getSetting, setSetting } = await import(at("lib/server/settings.ts"));
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
await catalog("sv1-5", "Arcanine ex", "32"); await series("sv1-5", 30, 30); // flat: set spotlight only
await catalog("sv1-6", "Pawmot", "76"); await series("sv1-6", 12, 12); // flat: set spotlight only
await catalog("sv1-7", "Pawmi", "74"); await series("sv1-7", 12, 16); // +33%: third gainer

const fetched = [];
const fetchedHeaders = [];
const fetchImage = async (url, headers) => { fetched.push(url); fetchedHeaders.push(headers ?? null); return Buffer.from("png"); };
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

console.log("slot → kind mapping (09-27: the movers video moved from 7am to 1pm; morning is the set spotlight picture)");
check("morning=set, midday=movers (video), evening=all games (09-30)", [SLOTS.morning.kind, SLOTS.midday.kind, SLOTS.evening.kind], ["set", "movers", "games"]);
check("the video slot is midday", [VIDEO_SLOT, SLOTS[VIDEO_SLOT].kind], ["midday", "movers"]);
{
  // Day plans (lib/socialPlan.ts, Chris 09-30): one day's slots can post other kinds; every other day keeps SLOTS.
  const { slotKind } = await import(at("lib/server/socialPublish.ts"));
  const { dayPlan, listNames, otherGameNames } = await import(at("lib/socialPlan.ts"));
  check("09-30 plan: 7am set spotlight, 1pm movers (mixed), 7pm all games", ["morning", "midday", "evening"].map((s) => slotKind(s, "2026-09-30")), ["set", "movers", "games"]);
  check("a day with no plan keeps the standing mix", ["morning", "midday", "evening"].map((s) => slotKind(s, "2026-10-01")), ["set", "movers", "games"]);
  check("09-30 plan mixes Magic into the movers and names the other games", [dayPlan("2026-09-30").mixedMovers, dayPlan("2026-09-30").alsoScans], [true, true]);
  check("also-scans list names the games a Pokémon post leaves out", listNames(otherGameNames(["pokemon"])), "Magic, Lorcana, One Piece and Yu-Gi-Oh");
}

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
check("7am: set spotlight posted (morning=set since 09-27, the video moved to 1pm)", [r.sites[0].status, bsky.posts.length], ["posted", 1]);
// 10-01 sweep: the key rides the Authorization header; ?key= put CRON_SECRET in the request logs.
check("image fetched square, the cron key in a Bearer header and never in the URL", [fetched[0], fetchedHeaders[0]], [`http://x/api/social/image?kind=set&game=pokemon&day=${THU}&size=square`, { authorization: "Bearer cron-test" }]);
check("alt text set", bsky.posts[0].alt.startsWith("Set spotlight:"));
check("slot marked with the Eastern day", await getSetting(`${SLOT_PREFIX}bsky:morning`), THU);
check("last-post day kept for the strip", await getSetting(`${LAST_POST_PREFIX}bsky`), THU);
check("uris kept", JSON.parse(await getSetting(`${LAST_POST_PREFIX}bsky:uris`)), ["https://bsky/1"]);
// 10-02, the optimization loop: every landed post is logged with the slot and kind it went out as (a dry run logs nothing).
const logged = async (site) => (await db.prepare("SELECT url, day, slot, kind FROM social_post_log WHERE site = ? ORDER BY rowid").all(site)).map((l) => `${l.url} ${l.day} ${l.slot} ${l.kind}`);
check("the landed post is logged as what it went out as", await logged("bsky"), [`https://bsky/1 ${THU} morning set`]);

r = await publishSocial({ day: THU, now: clock(12), origin: "http://x", sites: [bsky], fetchImage });
check("8am ping: morning already posted", [r.sites[0].reason, bsky.posts.length], ["morning slot already posted today", 1]);
r = await publishSocial({ day: THU, now: clock(17), origin: "http://x", sites: [bsky], fetchImage });
check("1pm: movers posted (midday=movers since 09-27)", [r.slot, bsky.posts.length, bsky.posts[1].alt.startsWith("Pokémon movers of the week.")], ["midday", 2, true]);
check("no-repeat: the landed gains post's cards are remembered for the kind", Object.keys(JSON.parse((await getSetting("social_featured:pokemon:movers")) ?? "{}")).sort(), ["sv1-2", "sv1-4", "sv1-7"]);
check("same Eastern day: uris add up (Chris 09-26: tile said 1 post after three)", JSON.parse(await getSetting(`${LAST_POST_PREFIX}bsky:uris`)).length, 2);
check("the 1pm post is logged under its own slot and kind", (await logged("bsky"))[1], `https://bsky/2 ${THU} midday movers`);
r = await publishSocial({ day: THU, now: clock(23), origin: "http://x", sites: [bsky], fetchImage });
// 09-30 (Chris: "never skip posts, i dont care the excuse"): this test DB has no stage cards (no all-games
// picture) and one drop only, so the 7pm slot falls back instead of staying quiet — it still posts.
check("7pm: no all-games picture, one drop only → falls back and still posts", [r.slot, r.sites[0].status, r.sites[0].reason ?? null, bsky.posts.length], ["evening", "posted", null, 3]);
check("…with the day's set spotlight (every other kind already went out or has no draft)", bsky.posts[2].alt.split(":")[0], "Set spotlight");
r = await publishSocial({ day: THU, now: clock(15), origin: "http://x", sites: [bsky], fetchImage, force: true });
check("Post now at 11am (only morning due, already done) → re-does morning", [r.slot, r.sites[0].status, r.sites[0].reason ?? null, bsky.posts.length], ["morning", "posted", null, 4]);
check("one image fetch per posting run", fetched.length, 4);

const late = fakeSite("late");
r = await publishSocial({ day: THU, now: clock(19), origin: "http://x", sites: [bsky, late], fetchImage });
check("a site connected at 3pm catches up on the 7am and 1pm posts in one run", [r.sites[1].status, r.sites[1].posts.map((p) => p.title.split(":")[0])], ["posted", ["Set spotlight", "Pokémon movers of the week"]]);
check("both slots marked for it", [await getSetting(`${SLOT_PREFIX}late:morning`), await getSetting(`${SLOT_PREFIX}late:midday`)], [THU, THU]);
check("the site that already had them is left alone", [r.sites[0].status, bsky.posts.length], ["skipped", 4]);

const broken = fakeSite("broken", { fail: true });
r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", sites: [broken], fetchImage });
check("failing site → failed, slot not marked", [r.sites[0].status, await getSetting(`${SLOT_PREFIX}broken:morning`)], ["failed", null]);
check("errors carried per post", r.sites[0].posts.every((p) => p.error === "boom"));
r = await publishSocial({ day: THU, now: clock(11, 30), origin: "http://x", sites: [broken], fetchImage });
check("a later ping of the same slot retries it, but flags the repeat", [r.sites[0].status, r.sites[0].repeat], ["failed", true]);

console.log("board");
const { sections } = await loadBoard();
const completed = sections.find(isCompletedSection);
const notes = completed.items.filter((i) => i.text.startsWith("Social autopilot"));
check("one Completed line per run that posted or failed", notes.length, 6);
check("newest first, done, Claude's, names the slot", [notes[0].done, notes[0].owner, notes[0].text.includes("broken: nothing went out"), notes[0].text.includes("7am set spotlight")], [true, "Claude", true, true]);
check("posted line carries the uri", notes[1].text.includes("https://late/2"));

console.log("same-day dedupe by kind (09-26)");
const ded = fakeSite("dedupe");
// Simulate "set" already went out today for this site (e.g. under an old
// mapping, or an earlier run this day): the morning slot's own kind (set)
// collides, so it must rotate to the next kind in the rotation that has a
// draft and has not posted today — dips has no draft here, so movers.
await setSetting(`${KIND_PREFIX}dedupe:set`, THU);
r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", sites: [ded], fetchImage, force: true });
check("set already posted today → the morning slot posts the next kind with a draft (movers) instead", [r.sites[0].status, ded.posts[0].alt.startsWith("Pokémon movers of the week.")], ["posted", true]);
check("the slot is still marked done (a slot always posts something)", await getSetting(`${SLOT_PREFIX}dedupe:morning`), THU);
check("the kind actually posted (movers) is recorded, alongside the earlier set record", [await getSetting(`${KIND_PREFIX}dedupe:set`), await getSetting(`${KIND_PREFIX}dedupe:movers`)], [THU, THU]);
check("the log holds the kind that went out, not the slot's own, and a failing site logs nothing", [(await logged("dedupe")).map((l) => l.split(" ").slice(2).join(" ")), await logged("broken")], [["morning movers"], []]);

const ded2 = fakeSite("dedupe2");
// Both movers and set already posted today for this site, and this
// fixture has no dips draft (only one drop card; dips needs 3): every
// rotation candidate is exhausted, so the slot must still post — its own
// kind repeats rather than the slot being skipped.
await setSetting(`${KIND_PREFIX}dedupe2:movers`, THU);
await setSetting(`${KIND_PREFIX}dedupe2:set`, THU);
r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", sites: [ded2], fetchImage, force: true });
check("every rotation candidate already posted or unavailable → the slot still posts its own kind (set), never skipped", [r.sites[0].status, ded2.posts[0].alt.startsWith("Set spotlight:")], ["posted", true]);

console.log("tracked links never touch the words (09-30: the owner wants plain cardflip.io everywhere)");
{
  // Same run, four sites: every one gets the draft's campaign (Bluesky and Pinterest tag a hidden link with it) and the text is exactly what fitText gave before.
  const xs = fakeSite("x", { maxChars: 257 });
  const fb = fakeSite("facebook");
  const ig = fakeSite("instagram", { maxChars: 2200 });
  const bs = fakeSite("bluesky", { maxChars: 300 });
  r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", sites: [xs, fb, ig, bs], fetchImage });
  check("all four post the 7am set spotlight", r.sites.map((s) => s.status), ["posted", "posted", "posted", "posted"]);
  const ep = "pokemon-set-0910";
  check("the campaign is the draft id with the day as MMDD, handed to every site", [xs, fb, ig, bs].map((s) => s.posts[0].campaign), [ep, ep, ep, ep]);
  check("no site's text carries a path, a utm or Link in bio", [xs, fb, ig, bs].every((s) => !/cardflip\.io\/|utm_|Link in bio/.test(s.posts[0].text)), true);
  check("every site's text ends on the plain address and its tags, as before", [xs, fb, ig, bs].every((s) => /cardflip\.io\n\n(#\w+ ?)+$/.test(s.posts[0].text)), true);
  check("X and Bluesky still fit their limits", [xs.posts[0].text.length <= 257, bs.posts[0].text.length <= 300], [true, true]);
}
console.log("text fitting");
const long = { caption: `${"x".repeat(280)}\n\ncardflip.io`, shortCaption: "Pokémon price moves this week\nA +5%\n\nScan a card, see what it's worth. cardflip.io", hashtags: ["PokemonTCG", "TCG"] };
check("fits: caption + tags when room", fitText({ caption: "hi cardflip.io", shortCaption: "hi", hashtags: ["A"] }, 300), "hi cardflip.io\n\n#A");
// 09-30 (Chris: "make sure to use hashtags to tag all the posts"): tags
// outrank the long caption — the short caption WITH tags beats the long one without.
check("keeps the tags: short caption + tags beats the long caption alone", fitText(long, 300), `${long.shortCaption}\n\n#PokemonTCG #TCG`);
{
  const five = { caption: "c".repeat(200), shortCaption: "s".repeat(190), hashtags: ["AAAAAAAAAA", "BBBBBBBBBB", "CCCCCCCCCC", "DDDDDDDDDD", "EEEEEEEEEE"] };
  check("trims the tag list from the end before dropping it (more tags first, long or short caption)", fitText(five, 240), `${"s".repeat(190)}\n\n#AAAAAAAAAA #BBBBBBBBBB #CCCCCCCCCC #DDDDDDDDDD`);
  check("never fewer than two tags: untagged caption when even two do not fit", fitText({ ...five, shortCaption: "c".repeat(200) }, 215), "c".repeat(200));
  const also = { caption: "l".repeat(400), shortCaption: `${"s".repeat(160)}\n\nAlso scans Magic, Lorcana, One Piece and Yu-Gi-Oh. cardflip.io`, hashtags: ["PokemonTCG", "PokemonCards", "TCG", "TradingCards"] };
  check("cuts the sign-off to the address before it drops a tag", fitText(also, 240), `${"s".repeat(160)}\n\ncardflip.io\n\n#PokemonTCG #PokemonCards #TCG #TradingCards`);
  // The 7pm all-games tags (Chris 09-30: tags for every game, biggest reach):
  // one per game first, so a cut list still names all five.
  const { PLAN_TAGS } = await import(at("lib/socialPlan.ts"));
  const games = { caption: "One scanner, five card games.\n\nScan a card, see what it's worth. cardflip.io", hashtags: [...PLAN_TAGS.games] };
  const firstFive = "#PokemonTCG #MTG #DisneyLorcana #OPTCG #Yugioh";
  check("all-games tags: Instagram keeps exactly five, one per game", fitText(games, 2200, 5).endsWith(`\n\n${firstFive}`), true);
  check("all-games tags: an uncapped fit keeps every tag", fitText(games, 5000).split("#").length - 1, PLAN_TAGS.games.length);
  for (const [label, max] of [["X", 257], ["Bluesky", 300]]) {
    const out = fitText(games, max);
    check(`all-games tags: ${label} length fits and still names all five games uncapped`, [out.length <= max, out.includes(firstFive)], [true, true]);
  }
  // Per-site caps (10-01): each site takes the first N tags, never the 13-tag list.
  const sites = { ...(await import(at("lib/server/sites/meta.ts"))), ...(await import(at("lib/server/sites/bluesky.ts"))), ...(await import(at("lib/server/sites/x.ts"))), ...(await import(at("lib/server/sites/pinterest.ts"))) };
  const capped = (id) => fitText(games, sites[id].maxChars, sites[id].maxTags).split("\n\n").pop();
  check("site tag caps: Threads 1 (its topic), X 2, Facebook 2, Bluesky 3, Instagram 5, Pinterest 5", ["threads", "x", "facebook", "bluesky", "instagram", "pinterest"].map(capped), [
    "#PokemonTCG",
    "#PokemonTCG #MTG",
    "#PokemonTCG #MTG",
    "#PokemonTCG #MTG #DisneyLorcana",
    firstFive,
    firstFive,
  ]);
}
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

check("link facet can point at a tagged url while the text stays cardflip.io", blueskyFacets(text, "https://cardflip.io/?utm_source=bluesky&utm_medium=social&utm_campaign=pokemon-set-0910")[0], {
  index: { byteStart: bytes("Pokémon moves. "), byteEnd: bytes("Pokémon moves. cardflip.io") },
  features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://cardflip.io/?utm_source=bluesky&utm_medium=social&utm_campaign=pokemon-set-0910" }],
});
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

console.log("60-day token refresh (Instagram Login + Threads)");
const realFetch = globalThis.fetch;
const refreshCalls = [];
let refreshFail = false;
globalThis.fetch = async (url) => {
  refreshCalls.push(String(url));
  if (refreshFail) return new Response("boom", { status: 400 });
  const grant = new URL(String(url)).searchParams.get("grant_type");
  return new Response(JSON.stringify({ access_token: `fresh-${grant}`, token_type: "bearer", expires_in: 5_183_944 }), { status: 200 });
};
process.env.INSTAGRAM_TOKEN = "ig-seed";
process.env.THREADS_TOKEN = "th-seed";
const T0 = Date.UTC(2026, 8, 25, 12);
const DAY = 86_400_000;
let rr = await meta.refreshMetaTokens(T0);
check("first sighting starts the clock, calls nothing", [rr.map((r) => r.status), refreshCalls.length], [["skipped", "skipped"], 0]);
check("posts with the env token until then", [await meta.liveToken("instagram"), await meta.liveToken("threads")], ["ig-seed", "th-seed"]);
rr = await meta.refreshMetaTokens(T0 + 3 * DAY);
check("under a week → skipped", [rr.map((r) => r.status), refreshCalls.length], [["skipped", "skipped"], 0]);
rr = await meta.refreshMetaTokens(T0 + 8 * DAY);
check("a week later → both refreshed, 60 days", rr.map((r) => [r.status, r.expiresDays]), [["refreshed", 60], ["refreshed", 60]]);
check("right grant per site, old token sent", [refreshCalls[0].includes("graph.instagram.com") && refreshCalls[0].includes("grant_type=ig_refresh_token&access_token=ig-seed"), refreshCalls[1].includes("graph.threads.net") && refreshCalls[1].includes("grant_type=th_refresh_token&access_token=th-seed")], [true, true]);
check("stored tokens now used for posting", [await meta.liveToken("instagram"), await meta.liveToken("threads")], ["fresh-ig_refresh_token", "fresh-th_refresh_token"]);
refreshFail = true;
rr = await meta.refreshMetaTokens(T0 + 16 * DAY);
check("a failed refresh keeps the last good token", [rr[0].status, rr[0].reason?.startsWith("instagram refresh 400"), await meta.liveToken("instagram")], ["failed", true, "fresh-ig_refresh_token"]);
refreshFail = false;
rr = await meta.refreshMetaTokens(T0 + 16 * DAY + 1);
check("next run retries with the stored token", [rr[0].status, refreshCalls.at(-2).includes("access_token=fresh-ig_refresh_token")], ["refreshed", true]);
process.env.INSTAGRAM_TOKEN = "ig-seed-2";
rr = await meta.refreshMetaTokens(T0 + 30 * DAY);
check("a newly pasted env token wins and restarts its clock", [rr[0].status, await meta.liveToken("instagram"), rr[1].status], ["skipped", "ig-seed-2", "refreshed"]);
delete process.env.INSTAGRAM_TOKEN;
delete process.env.THREADS_TOKEN;
check("no env token → off", (await meta.refreshMetaTokens(T0)).map((r) => r.status), ["off", "off"]);
globalThis.fetch = realFetch;

console.log("Pinterest (pictures only, OAuth connect)");
const pin = await import(at("lib/server/sites/pinterest.ts"));
delete process.env.PINTEREST_APP_ID;
delete process.env.PINTEREST_APP_SECRET;
check("off without app creds, never video", [pin.pinterest.connected(), pin.pinterest.postsVideo ?? false, pin.pinterest.connectPath], [false, false, "/api/social/pinterest/connect"]);
process.env.PINTEREST_APP_ID = "app-1";
process.env.PINTEREST_APP_SECRET = "s3";
check("creds on but not yet connected in the browser", [pin.pinterest.connected(), await pin.pinterest.authorized()], [true, false]);
const authUrl = new URL(pin.pinterestAuthUrl("https://cardflip.io", "st4te"));
check("consent url carries id, callback, scopes, state", [authUrl.origin + authUrl.pathname, authUrl.searchParams.get("client_id"), authUrl.searchParams.get("redirect_uri"), authUrl.searchParams.get("scope"), authUrl.searchParams.get("state")], ["https://www.pinterest.com/oauth/", "app-1", "https://cardflip.io/api/social/pinterest/callback", "boards:read,boards:write,pins:read,pins:write", "st4te"]);
const f1 = pin.pinterestFields("Pokémon movers of the week\nCharizard ex +12%\ncardflip.io");
check("title = first line, description = whole caption", [f1.title, f1.description.endsWith("cardflip.io"), f1.description.includes("\n")], ["Pokémon movers of the week", true, true]);
const longTitle = "word ".repeat(40).trim();
const f2 = pin.pinterestFields(longTitle + "\n" + "x".repeat(600));
check("title cut at a word under 100, description capped at 500", [f2.title.length <= 100, f2.title.endsWith("…"), f2.title.includes("  "), f2.description.length], [true, true, false, 500]);
{
  // The pin's link field is hidden from the caption text, so it carries the campaign (lib/attribution.ts).
  const realFetch2 = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/oauth/token")) return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600, refresh_token_expires_in: 86400, scope: "pins:write" }), { status: 200 });
    if (u.endsWith("/v5/pins")) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "pin1" }), { status: 200 }); }
    return new Response("{}", { status: 404 });
  };
  await pin.pinterestExchangeCode("code", "https://cardflip.io");
  await setSetting(pin.PINTEREST_BOARD_KEY, "board-1");
  const base = { text: "Pokémon movers\ncardflip.io", image: Buffer.from("png"), mime: "image/png", width: 1, height: 1, alt: "a" };
  await pin.pinterest.post({ ...base, campaign: "pokemon-set-0910" });
  await pin.pinterest.post(base);
  check("pin link field carries the campaign's utm; the description is the caption untouched", [sent[0].link, sent[0].description], ["https://cardflip.io/?utm_source=pinterest&utm_medium=social&utm_campaign=pokemon-set-0910", "Pokémon movers\ncardflip.io"]);
  check("no campaign = the plain link, as before", sent[1].link, "https://cardflip.io/");
  globalThis.fetch = realFetch2;
}
check("empty caption still has a title", pin.pinterestFields("").title, "CardFlip");
delete process.env.PINTEREST_APP_ID;
delete process.env.PINTEREST_APP_SECRET;

// --- failure alert (09-29: Facebook's token died and nobody heard for a day) ---
{
  const { alertFailures } = await import(at("lib/server/socialPublish.ts"));
  const store = new Map([[`${LAST_POST_PREFIX}facebook`, "2026-09-28"]]);
  const sent = [];
  const deps = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), send: async (f) => void sent.push(f) };
  const rep = {
    etDay: "2026-09-29",
    sites: [
      { site: "facebook", label: "Facebook", status: "failed", posts: [{ id: "a", title: "A", error: "Session has expired" }] },
      { site: "pinterest", label: "Pinterest", status: "failed", posts: [{ id: "a", title: "A", error: "Trial access" }] },
      { site: "x", label: "X", status: "posted", posts: [{ id: "a", title: "A", uri: "u" }] },
    ],
  };
  check("alert: a site that used to post is mailed; never-posted Pinterest is not", await alertFailures(rep, deps), ["facebook"]);
  check("alert: the mail carries the error", sent[0]?.[0]?.error, "Session has expired");
  check("alert: once per site per day", await alertFailures(rep, deps), []);
  check("alert: again the next day", await alertFailures({ ...rep, etDay: "2026-09-30" }, deps), ["facebook"]);
}

// --- CI / prod-smoke alert (lib/server/opsAlert.ts, 09-29) — lives here for the harness ---
{
  const { opsAlert, OPS_ALERT_GAP_MS } = await import(at("lib/server/opsAlert.ts"));
  const store = new Map();
  const sent = [];
  const deps = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), send: async (a) => void sent.push(a.workflow) };
  const t = 1_800_000_000_000;
  check("ops alert: first failure mails", await opsAlert({ workflow: "CI" }, t, deps), "sent");
  check("ops alert: quiet inside the hour", await opsAlert({ workflow: "CI" }, t + 15 * 60_000, deps), "quiet");
  check("ops alert: other workflow still mails", await opsAlert({ workflow: "Production Smoke" }, t + 60_000, deps), "sent");
  check("ops alert: mails again after the hour", await opsAlert({ workflow: "CI" }, t + OPS_ALERT_GAP_MS, deps), "sent");
  check("ops alert: what went out", sent, ["CI", "Production Smoke", "CI"]);
}

// ---- 10-01: the engagement question and the 7pm jumps bookkeeping ------------------------------------------------
console.log("engagement question: the lowest priority after the sign-off cut");
{
  const Q = "Which one would you hold?";
  const SIGN = "Scan a card, see what it's worth. cardflip.io";
  const q = {
    caption: `Pokémon price gains this week, from CardFlip's own price history.\n\nMiraidon ex (Scarlet & Violet 81) $10.00 → $15.00, +50%\n\n${Q}\n\n${SIGN}`,
    shortCaption: `Pokémon price gains this week\nMiraidon ex +50%\nGardevoir ex +20%\n\n${Q}\n\n${SIGN}`,
    question: Q,
    hashtags: ["PokemonTCG", "PokemonCards", "TCG"],
  };
  const tags = "#PokemonTCG #PokemonCards #TCG";
  check("a roomy site gets the full caption, the question after the card lines and before the sign-off, every tag", fitText(q, 5000), `${q.caption}\n\n${tags}`);
  const shortFull = `${q.shortCaption}\n\n${tags}`;
  // 5 characters under the short caption with everything: the sign-off goes to the bare address first, the question stays.
  const mid = fitText(q, shortFull.length - 5);
  check("tight: the sign-off is cut to the address FIRST, the question and every tag stay", [mid.includes(Q), mid.endsWith(`cardflip.io\n\n${tags}`) && !mid.includes("Scan a card"), mid.length <= shortFull.length - 5], [true, true, true]);
  // Below that the question goes, and still no hashtag and no card line does.
  const tinyQ = shortFull.length - (SIGN.length - "cardflip.io".length);
  const tight = fitText(q, tinyQ - 3);
  check("tighter: the question is the next thing cut, before a hashtag or a card line", [tight.includes(Q), tight.includes("Miraidon ex +50%"), tight.includes("Gardevoir ex +20%"), tight.endsWith(tags), tight.length <= tinyQ - 3], [false, true, true, true, true]);
  check("without a question nothing changes (older drafts, the card post)", fitText({ ...q, question: undefined, caption: q.caption.replace(`${Q}\n\n`, ""), shortCaption: q.shortCaption.replace(`${Q}\n\n`, "") }, 5000), `${q.caption.replace(`${Q}\n\n`, "")}\n\n${tags}`);
  // The real thing, on X's 257 and Bluesky's 300: the question only appears when it fits, and no site loses a tag for it.
  const real = (await (await import(at("lib/server/social.ts"))).socialDrafts("pokemon", THU)).find((d) => d.kind === "movers");
  check("a real draft carries its question in both captions", [Boolean(real.question), real.caption.includes(real.question), real.shortCaption.includes(real.question)], [true, true, true]);
  for (const [label, max] of [["X", 257], ["Bluesky", 300], ["Threads", 500], ["Instagram", 2200], ["Facebook", 5000]]) {
    const out = fitText(real, max, label === "Instagram" ? 5 : undefined);
    const tagCount = (out.match(/#\w+/g) ?? []).length;
    check(`${label}: fits ${max}, keeps every tag the draft has (${real.hashtags.length}), the address stays`, [out.length <= max, tagCount, out.includes("cardflip.io")], [true, real.hashtags.length, true]);
  }
  const realSet = (await (await import(at("lib/server/social.ts"))).socialDrafts("pokemon", THU)).find((d) => d.kind === "set");
  check("a set draft's question names its set; X (257) has no room for it: it is the first thing cut, the five card lines and all three tags stay", [realSet.question.includes("Scarlet & Violet") || realSet.question.includes("pull"), fitText(realSet, 257).includes(realSet.question), fitText(realSet, 257).split("\n").filter((l) => /\$\d/.test(l)).length, (fitText(realSet, 257).match(/#[A-Za-z]\w*/g) ?? []).length], [true, false, 5, 3]);
  check("…while Bluesky (300) still has room for it", fitText(realSet, 300).includes(realSet.question), true);
  check("Facebook (5000): the question is there", fitText(real, 5000).includes(real.question), true);
}

console.log("the 7pm jumps are filed for the no-repeat rule once they land (their own list)");
{
  const { planTag, slotKind } = await import(at("lib/server/socialPublish.ts"));
  const J = "2026-11-20";
  const jd = (back) => addDays(J, -back);
  await db.prepare("INSERT INTO en_cards (id, name, set_id, set_name, local_id, image_url, synced_at) VALUES ('jj1-1', 'Jump Card', 'jj1', 'Jump Set', '1', 'https://assets.tcgdex.net/en/jj1/1/low.webp', 0)").run();
  await recordPoint("jj1-1", "pokemon", "normal", "tcgplayer", "USD", 20, jd(7));
  for (const back of [3, 2, 1, 0]) await recordPoint("jj1-1", "pokemon", "normal", "tcgplayer", "USD", 30, jd(back));
  for (const key of ["magic_public", "lorcana_public", "onepiece_public", "yugioh_public"]) await setSetting(key, "1");
  const stg = (name, setName, number, price) => ({ name, setName, number, imageUrl: `https://img.example/${encodeURIComponent(name)}.png`, price, lead: true });
  for (const [key, c] of [["stage:v8:pokemon", stg("Charizard ex", "Obsidian Flames", "125", 48.5)], ["stage:v14:mtg", stg("Sol Ring", "Commander Masters", "410", 32.1)], ["stage:v14:lorcana", stg("Elsa", "The First Chapter", "42", 61)], ["stage:v14:onepiece", stg("Portgas.D.Ace", "Premium Booster", "P-055", 75)], ["stage:v14:yugioh", stg("Dark Magician", "Legend of Blue Eyes", "LOB-005", 55.25)]]) {
    await db.prepare("INSERT OR REPLACE INTO card_cache (key, payload, cached_at) VALUES (?, ?, ?)").run(key, JSON.stringify([c]), Date.now());
  }
  const seven = Date.UTC(2026, 10, 21, 0, 30); // 7:30pm EST on Nov 20
  check("the evening slot is the all-games post", slotKind("evening", J), "games");
  const failing = fakeSite("failing", { fail: true });
  await publishSocial({ day: J, now: seven, slot: "evening", origin: "http://x", sites: [failing], fetchImage });
  check("a failed post files nothing", await getSetting("social_featured:pokemon:jumps"), null);
  const ok = fakeSite("ok");
  const r2 = await publishSocial({ day: J, now: seven, slot: "evening", origin: "http://x", sites: [ok], fetchImage });
  check("the evening post is the jumps post, its caption names the card and its move", [r2.sites[0].status, ok.posts[0].alt.startsWith("Biggest price jumps this week."), ok.posts[0].text.includes("Pokémon: Jump Card (Jump Set #1): $30.00, +50% this week")], ["posted", true, true]);
  check("the card that led is filed under 'jumps' on the day it posted, and the 1pm gains list is untouched", [JSON.parse(await getSetting("social_featured:pokemon:jumps")), Object.keys(JSON.parse((await getSetting("social_featured:pokemon:movers")) ?? "{}")).includes("jj1-1")], [{ "jj1-1": J }, false]);
  const { recentlyFeatured } = await import(at("lib/server/social.ts"));
  check("tomorrow's 7pm post leaves it out; today's re-render does not", [(await recentlyFeatured("pokemon", "jumps", addDays(J, 1))).has("jj1-1"), (await recentlyFeatured("pokemon", "jumps", J)).has("jj1-1")], [true, false]);
  check("plan tags: the 7pm post is 'games+jumps' and the 7am set 'set+lead' from 10-01 (older videos are stale, the net remakes them); before that, as it was", [planTag("evening", "2026-09-30"), planTag("evening", "2026-10-01"), planTag("morning", "2026-10-01"), planTag("midday", "2026-10-01"), planTag("morning", "2026-09-30")], ["games", "games+jumps", "set+lead", "movers", "set+also+set=base4"]);
}

// 10-02, the optimization loop's switch: a standing schedule entry in settings changes what a slot posts from its
// day on (lib/server/socialSchedule.ts), and the daily job writes one to start a trial (lib/server/socialOptimize.ts).
{
  const { addScheduleEntry, loadSchedule, SCHEDULE_KEY } = await import(at("lib/server/socialSchedule.ts"));
  const { slotKind: kindOn, planTag: tagOn } = await import(at("lib/server/socialPublish.ts"));
  const { runSocialOptimize, optimizerStatus, OPT_TRIAL_KEY, OPT_OFF_KEY, OPT_LAST_KEY } = await import(at("lib/server/socialOptimize.ts"));
  await addScheduleEntry({ from: "2026-11-10", morning: "dips", evening: "games" });
  check(
    "from its day on 7am posts the new kind; the day before, 1pm and 7pm are as they were",
    [kindOn("morning", "2026-11-09"), kindOn("morning", "2026-11-10"), kindOn("morning", "2026-12-25"), kindOn("midday", "2026-11-10"), kindOn("evening", "2026-11-10")],
    ["set", "dips", "dips", "movers", "games"],
  );
  check("the plan tag follows the kind, so a video made under the old one is stale and gets remade", [tagOn("morning", "2026-11-09").split("+")[0], tagOn("morning", "2026-11-10").split("+")[0]], ["set", "dips"]);
  await addScheduleEntry({ from: "2026-11-20", morning: "set", evening: "games" });
  check("a later entry puts the old kind back from its own day", [kindOn("morning", "2026-11-19"), kindOn("morning", "2026-11-20")], ["dips", "set"]);
  await setSetting(SCHEDULE_KEY, "{not json");
  await loadSchedule();
  check("an unreadable schedule row = the standing schedule, never a crash", [kindOn("morning", "2026-11-10"), kindOn("evening", "2026-11-10")], ["set", "games"]);
  await setSetting(SCHEDULE_KEY, "");

  // The job, end to end: six days of posts where the benched kind (dips) clearly beat the 7am set spotlight.
  const now = Date.now();
  const today = eastern(now).day;
  const put = db.prepare("INSERT INTO social_posts (site, post_id, url, text, at, likes, comments, shares, views, first_seen_at, read_at, kind, slot) VALUES (?, ?, ?, '', ?, 0, 0, 0, ?, ?, ?, ?, ?)");
  for (let age = 3; age <= 8; age++) {
    for (const [kind, slot, views] of [["set", "morning", 100], ["movers", "midday", 300], ["games", "evening", 300], ["dips", "evening", 900]]) {
      for (const site of ["s1", "s2"]) await put.run(site, `${kind}-${age}`, `https://${site}/${kind}-${age}`, new Date(now - age * 86_400_000).toISOString(), views, now, now, kind, slot);
    }
  }
  await setSetting(OPT_OFF_KEY, "1");
  let rep = await runSocialOptimize(now);
  check("switched off: it scores and says so, and starts nothing", [rep.change, rep.why.startsWith("Switched off: nothing changes."), await getSetting(OPT_TRIAL_KEY), kindOn("morning", addDays(today, 2))], [null, true, null, "set"]);
  check("the page shows the switch and what the job last said", [(await optimizerStatus()).on, (await optimizerStatus()).day], [false, today]);
  check("once per Eastern day", await runSocialOptimize(now), null);
  await setSetting(OPT_OFF_KEY, "");
  await setSetting(OPT_LAST_KEY, "");
  rep = await runSocialOptimize(now);
  const start = addDays(today, 2);
  check("switched on: the lead starts a trial two days out", [rep.change, JSON.parse(await getSetting(OPT_TRIAL_KEY))], [{ slot: "morning", from: "set", to: "dips" }, { slot: "morning", from: "set", to: "dips", start }]);
  check("the schedule: tomorrow is untouched, the start day posts the trial kind at 7am and nothing else moved", [kindOn("morning", addDays(today, 1)), kindOn("morning", start), kindOn("midday", start), kindOn("evening", start)], ["set", "dips", "movers", "games"]);
  // Two lines that day: the hashtag trial's (written last, so on top) and the kind trial's under it.
  const [tagTop, top] = ((await loadBoard()).sections.find(isCompletedSection)?.items ?? []).map((i) => i.text ?? "");
  check("one board line says what starts when, and why", top.startsWith(`Social optimizer ${today} — trial: price drops takes 7am from set spotlight for a week, starting ${start}.`), true);
  // Hashtags ride the same run (lib/socialTags.ts): off = nothing, on = the first challenger's trial two days out, loaded into the plan fitText reads.
  const { TAGS_KEY, TAGS_WHY_KEY } = await import(at("lib/server/socialTags.ts"));
  const { TAG_CANDIDATES, tagsOn } = await import(at("lib/socialTags.ts"));
  check("hashtags: the same run starts the first challenger's trial, with its own board line", [JSON.parse(await getSetting(TAGS_KEY)), tagTop.startsWith(`Social optimizer ${today} — hashtag trial starts ${start}: #${TAG_CANDIDATES[0].in} in place of #${TAG_CANDIDATES[0].out}`)], [{ swaps: [], trial: { ...TAG_CANDIDATES[0], start } }, true]);
  check("hashtags: the trial tag posts on the start day and not the day after", [tagsOn([TAG_CANDIDATES[0].out], start), tagsOn([TAG_CANDIDATES[0].out], addDays(start, 1))], [[TAG_CANDIDATES[0].in], [TAG_CANDIDATES[0].out]]);
  await setSetting(OPT_LAST_KEY, "");
  rep = await runSocialOptimize(now + 1);
  check("the next run leaves a running trial alone", [rep.change, rep.why.startsWith("No change: trial running, price drops at 7am"), JSON.parse(await getSetting(OPT_TRIAL_KEY)).start], [null, true, start]);
  check("hashtags: the next run leaves the running trial alone", [JSON.parse(await getSetting(TAGS_KEY)).trial.start, (await getSetting(TAGS_WHY_KEY)).startsWith("Hashtag trial running")], [start, true]);
  await setSetting(SCHEDULE_KEY, "");
  await setSetting(TAGS_KEY, "");
  await loadSchedule();
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
