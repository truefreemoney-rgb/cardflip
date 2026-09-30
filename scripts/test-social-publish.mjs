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
check("image fetched with the cron key, square", fetched[0], `http://x/api/social/image?kind=set&game=pokemon&day=${THU}&size=square&key=cron-test`);
check("alt text set", bsky.posts[0].alt.startsWith("Set spotlight:"));
check("slot marked with the Eastern day", await getSetting(`${SLOT_PREFIX}bsky:morning`), THU);
check("last-post day kept for the strip", await getSetting(`${LAST_POST_PREFIX}bsky`), THU);
check("uris kept", JSON.parse(await getSetting(`${LAST_POST_PREFIX}bsky:uris`)), ["https://bsky/1"]);

r = await publishSocial({ day: THU, now: clock(12), origin: "http://x", sites: [bsky], fetchImage });
check("8am ping: morning already posted", [r.sites[0].reason, bsky.posts.length], ["morning slot already posted today", 1]);
r = await publishSocial({ day: THU, now: clock(17), origin: "http://x", sites: [bsky], fetchImage });
check("1pm: movers posted (midday=movers since 09-27)", [r.slot, bsky.posts.length, bsky.posts[1].alt.startsWith("Pokémon movers of the week.")], ["midday", 2, true]);
check("no-repeat: the landed gains post's cards are remembered for the kind", Object.keys(JSON.parse((await getSetting("social_featured:pokemon:movers")) ?? "{}")).sort(), ["sv1-2", "sv1-4", "sv1-7"]);
check("same Eastern day: uris add up (Chris 09-26: tile said 1 post after three)", JSON.parse(await getSetting(`${LAST_POST_PREFIX}bsky:uris`)).length, 2);
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

const ded2 = fakeSite("dedupe2");
// Both movers and set already posted today for this site, and this
// fixture has no dips draft (only one drop card; dips needs 3): every
// rotation candidate is exhausted, so the slot must still post — its own
// kind repeats rather than the slot being skipped.
await setSetting(`${KIND_PREFIX}dedupe2:movers`, THU);
await setSetting(`${KIND_PREFIX}dedupe2:set`, THU);
r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", sites: [ded2], fetchImage, force: true });
check("every rotation candidate already posted or unavailable → the slot still posts its own kind (set), never skipped", [r.sites[0].status, ded2.posts[0].alt.startsWith("Set spotlight:")], ["posted", true]);

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
  check("all-games tags: roomy sites (Facebook, TikTok) get every tag", fitText(games, 5000).split("#").length - 1, PLAN_TAGS.games.length);
  for (const [label, max] of [["X", 257], ["Bluesky", 300]]) {
    const out = fitText(games, max);
    check(`all-games tags: ${label} fits and still names all five games`, [out.length <= max, out.includes(firstFive)], [true, true]);
  }
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

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
